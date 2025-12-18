import * as cheerio from 'cheerio';

const BASE_URL = 'https://foodhub.co.jp';
const CATEGORY_ENCODED = encodeURIComponent('かま屋通信');

interface ArticleInfo {
  title: string;
  url: string;
  date: string;
  pdfUrl?: string;
  pdfType?: 'google-drive' | 'direct';
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
      },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function fetchArticleDetails(url: string): Promise<ArticleInfo> {
  const article: ArticleInfo = {
    title: '',
    url,
    date: '',
  };

  try {
    const html = await fetchPage(url);
    if (!html) return article;

    const $ = cheerio.load(html);

    // タイトル取得
    const h1 = $('h1').first().text().trim();
    const titleTag = $('title').text().split('|')[0].trim();
    article.title = h1 || titleTag;

    // PDF リンク取得
    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (href && !article.pdfUrl) {
        if (href.includes('drive.google.com')) {
          article.pdfUrl = href;
          article.pdfType = 'google-drive';
          return false;
        }
        if (href.toLowerCase().endsWith('.pdf')) {
          article.pdfUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
          article.pdfType = 'direct';
          return false;
        }
        if (href.includes('wp-content/uploads') && href.includes('.pdf')) {
          article.pdfUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
          article.pdfType = 'direct';
          return false;
        }
      }
    });

    // 本文中の PDF リンク
    if (!article.pdfUrl) {
      const htmlContent = $.html();
      const driveMatch = htmlContent.match(/https?:\/\/drive\.google\.com\/[^\s"'<>]+/);
      if (driveMatch) {
        article.pdfUrl = driveMatch[0];
        article.pdfType = 'google-drive';
      }
      if (!article.pdfUrl) {
        const pdfMatch = htmlContent.match(/https?:\/\/[^\s"'<>]+\.pdf/i);
        if (pdfMatch) {
          article.pdfUrl = pdfMatch[0];
          article.pdfType = 'direct';
        }
      }
    }

    // 日付取得
    const dateMatch = html.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (dateMatch) {
      article.date = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;
    }
    const issueMatch = article.title.match(/(\d{4})年(\d{1,2})月号/);
    if (issueMatch && !article.date) {
      article.date = `${issueMatch[1]}-${issueMatch[2].padStart(2, '0')}-01`;
    }

  } catch {
    // ignore
  }

  return article;
}

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendMessage = (type: string, data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`));
      };

      try {
        sendMessage('log', { message: 'ページ一覧を取得中...' });

        // ページ1から記事URLを収集
        const allUrls = new Set<string>();
        
        for (let page = 1; page <= 15; page++) {
          const url = page === 1 
            ? `${BASE_URL}/daybook/?category=${CATEGORY_ENCODED}`
            : `${BASE_URL}/daybook/page/${page}/?category=${CATEGORY_ENCODED}`;
          
          const html = await fetchPage(url);
          if (!html) break;

          const $ = cheerio.load(html);
          let foundOnThisPage = 0;

          $('a[href*="/daybook/"]').each((_, el) => {
            const href = $(el).attr('href');
            if (href) {
              const match = href.match(/\/daybook\/(\d+)\/?$/);
              if (match && !href.includes('/page/')) {
                const articleUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
                const normalizedUrl = articleUrl.replace(/\/$/, '');
                if (!allUrls.has(normalizedUrl) && !allUrls.has(normalizedUrl + '/')) {
                  allUrls.add(normalizedUrl);
                  foundOnThisPage++;
                }
              }
            }
          });

          sendMessage('progress', { 
            message: `ページ ${page} を確認: ${foundOnThisPage} 件発見 (累計: ${allUrls.size} 件)`,
            current: allUrls.size 
          });

          if (foundOnThisPage === 0 && page > 1) break;
          await new Promise(resolve => setTimeout(resolve, 300));
        }

        sendMessage('log', { message: `${allUrls.size} 件の記事URLを発見。詳細を取得中...` });

        // 各記事の詳細を取得
        const urls = Array.from(allUrls);
        const detailedArticles: ArticleInfo[] = [];
        const batchSize = 3;

        for (let i = 0; i < urls.length; i += batchSize) {
          const batch = urls.slice(i, i + batchSize);
          const results = await Promise.all(batch.map(fetchArticleDetails));
          detailedArticles.push(...results);

          sendMessage('progress', { 
            message: `記事詳細を取得中: ${Math.min(i + batchSize, urls.length)}/${urls.length}`,
            current: Math.min(i + batchSize, urls.length),
            total: urls.length
          });

          if (i + batchSize < urls.length) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }

        // フィルタリング
        const kamayaArticles = detailedArticles.filter(a => 
          a.title && (a.title.includes('かま屋通信') || a.title.includes('かま屋 通信'))
        );
        kamayaArticles.sort((a, b) => b.date.localeCompare(a.date));
        const articlesWithPdf = kamayaArticles.filter(a => a.pdfUrl);

        sendMessage('complete', {
          success: true,
          total: kamayaArticles.length,
          withPdf: articlesWithPdf.length,
          articles: kamayaArticles,
        });

      } catch (error) {
        sendMessage('error', { error: String(error) });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
