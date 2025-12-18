import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, readFile, access } from 'fs/promises';
import path from 'path';

// ダウンロードディレクトリ
const DOWNLOAD_DIR = path.join(process.cwd(), 'downloads');

// ファイル名を安全な形式に変換
function sanitizeFilename(title: string): string {
  return title
    .replace(/[<>:"/\\|?*]/g, '') // 使えない文字を削除
    .replace(/\s+/g, '_')         // スペースをアンダースコアに
    .substring(0, 100);            // 長さ制限
}

// ファイルが存在するかチェック
async function fileExists(filepath: string): Promise<boolean> {
  try {
    await access(filepath);
    return true;
  } catch {
    return false;
  }
}

// Google DriveのビューURLからダウンロードURLに変換
function getGoogleDriveDownloadUrl(viewUrl: string): string {
  // パターン1: /file/d/FILE_ID/view
  let match = viewUrl.match(/\/file\/d\/([^/]+)/);
  if (match) {
    return `https://drive.google.com/uc?export=download&id=${match[1]}`;
  }
  
  // パターン2: /open?id=FILE_ID
  match = viewUrl.match(/[?&]id=([^&]+)/);
  if (match) {
    return `https://drive.google.com/uc?export=download&id=${match[1]}`;
  }
  
  return viewUrl;
}

export async function POST(request: NextRequest) {
  try {
    const { pdfUrl, title, pdfType } = await request.json();

    if (!pdfUrl) {
      return NextResponse.json(
        { success: false, error: 'PDF URL is required' },
        { status: 400 }
      );
    }

    // ファイル名を生成
    const filename = sanitizeFilename(title) + '.pdf';
    const filepath = path.join(DOWNLOAD_DIR, filename);

    // 既にダウンロード済みかチェック
    if (await fileExists(filepath)) {
      console.log(`Already exists: ${filename}`);
      try {
        const buffer = await readFile(filepath);
        const base64 = buffer.toString('base64');
        return NextResponse.json({
          success: true,
          title,
          pdfBase64: base64,
          size: buffer.length,
          savedPath: filepath,
          filename,
          cached: true, // キャッシュから読み込んだことを示す
        });
      } catch (readError) {
        console.error('Failed to read cached file:', readError);
        // 読み込みに失敗した場合は再ダウンロード
      }
    }

    let downloadUrl = pdfUrl;
    
    // Google Drive の場合はダウンロードURLに変換
    if (pdfType === 'google-drive' || pdfUrl.includes('drive.google.com')) {
      downloadUrl = getGoogleDriveDownloadUrl(pdfUrl);
      console.log(`Google Drive URL: ${pdfUrl}`);
      console.log(`Download URL: ${downloadUrl}`);
    } else {
      console.log(`Direct PDF URL: ${downloadUrl}`);
    }

    // PDFをダウンロード
    const response = await fetch(downloadUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return NextResponse.json({
        success: false,
        error: `Failed to download PDF: ${response.status}`,
        skipped: true,
      });
    }

    // Content-Typeチェック
    const contentType = response.headers.get('content-type') || '';
    
    // HTMLページが返ってきた場合（アクセス制限など）
    if (contentType.includes('text/html')) {
      const html = await response.text();
      
      // アクセス権限エラーのチェック
      if (html.includes('Request access') || html.includes('アクセス権') || 
          html.includes('Access denied') || html.includes('Sign in') ||
          html.includes('You need permission') || html.includes('ログイン')) {
        return NextResponse.json({
          success: false,
          error: 'Access denied - no permission to view this PDF',
          skipped: true,
        });
      }

      // Google Driveの確認ページ（ウイルススキャン）を検出
      const confirmMatch = html.match(/href="([^"]*confirm=[^"]*)"/);
      if (confirmMatch) {
        let confirmUrl = confirmMatch[1].replace(/&amp;/g, '&');
        if (!confirmUrl.startsWith('http')) {
          confirmUrl = 'https://drive.google.com' + confirmUrl;
        }
        console.log(`Following confirm link: ${confirmUrl}`);
        
        const confirmResponse = await fetch(confirmUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          },
        });

        if (confirmResponse.ok) {
          const confirmContentType = confirmResponse.headers.get('content-type') || '';
          if (confirmContentType.includes('application/pdf') || confirmContentType.includes('octet-stream')) {
            const buffer = await confirmResponse.arrayBuffer();
            return await savePdfAndRespond(Buffer.from(buffer), title, filename, filepath);
          }
        }
      }

      return NextResponse.json({
        success: false,
        error: 'Received HTML instead of PDF (access restriction)',
        skipped: true,
      });
    }

    // PDFデータを取得して保存
    const buffer = await response.arrayBuffer();
    return await savePdfAndRespond(Buffer.from(buffer), title, filename, filepath);

  } catch (error) {
    console.error('Extract error:', error);
    return NextResponse.json({
      success: false,
      error: String(error),
      skipped: true,
    });
  }
}

async function savePdfAndRespond(buffer: Buffer, title: string, filename: string, filepath: string) {
  try {
    // ダウンロードディレクトリを作成（存在しない場合）
    await mkdir(DOWNLOAD_DIR, { recursive: true });

    // PDFを保存
    await writeFile(filepath, buffer);
    console.log(`PDF saved to: ${filepath} (${Math.round(buffer.length / 1024)} KB)`);

    // Base64にも変換（分析用）
    const base64 = buffer.toString('base64');

    return NextResponse.json({
      success: true,
      title,
      pdfBase64: base64,
      size: buffer.length,
      savedPath: filepath,
      filename,
      cached: false,
    });
  } catch (error) {
    console.error('Save PDF error:', error);
    return NextResponse.json({
      success: false,
      error: `Failed to save PDF: ${error}`,
      skipped: true,
    });
  }
}
