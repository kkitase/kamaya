import { NextRequest, NextResponse } from 'next/server';
import { readdir, readFile, stat } from 'fs/promises';
import path from 'path';

const DOWNLOAD_DIR = path.join(process.cwd(), 'downloads');

// GET: PDFファイル一覧を取得（メタデータのみ）
export async function GET() {
  try {
    // ダウンロードディレクトリの内容を取得
    let files: string[] = [];
    try {
      files = await readdir(DOWNLOAD_DIR);
    } catch {
      // ディレクトリが存在しない場合
      return NextResponse.json({
        success: true,
        count: 0,
        pdfs: [],
      });
    }

    const pdfFiles = files.filter(f => f.endsWith('.pdf'));

    const pdfs = [];

    for (const filename of pdfFiles) {
      const filepath = path.join(DOWNLOAD_DIR, filename);
      const fileStat = await stat(filepath);
      
      // ファイル名からタイトルを復元
      const title = filename.replace('.pdf', '').replace(/_/g, ' ');

      pdfs.push({
        title,
        filename,
        size: fileStat.size,
        filepath,
      });
    }

    return NextResponse.json({
      success: true,
      count: pdfs.length,
      pdfs,
    });
  } catch (error) {
    console.error('Load PDFs error:', error);
    return NextResponse.json({
      success: false,
      error: String(error),
      pdfs: [],
    });
  }
}

// POST: 指定されたPDFファイルの内容を取得
export async function POST(request: NextRequest) {
  try {
    const { filenames } = await request.json();

    if (!filenames || !Array.isArray(filenames)) {
      return NextResponse.json({
        success: false,
        error: 'filenames array is required',
      }, { status: 400 });
    }

    const pdfs = [];

    for (const filename of filenames) {
      try {
        const filepath = path.join(DOWNLOAD_DIR, filename);
        const buffer = await readFile(filepath);
        const base64 = buffer.toString('base64');
        const title = filename.replace('.pdf', '').replace(/_/g, ' ');

        pdfs.push({
          title,
          filename,
          pdfBase64: base64,
          size: buffer.length,
        });
      } catch (error) {
        console.error(`Failed to read ${filename}:`, error);
      }
    }

    return NextResponse.json({
      success: true,
      count: pdfs.length,
      pdfs,
    });
  } catch (error) {
    console.error('Load PDFs POST error:', error);
    return NextResponse.json({
      success: false,
      error: String(error),
    }, { status: 500 });
  }
}
