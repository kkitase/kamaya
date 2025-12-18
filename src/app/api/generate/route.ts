import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';

// ペルソナプロンプトの読み込み（サーバーサイドでのみ実行可能）
const getPersonaPrompt = () => {
  try {
    const promptPath = path.join(process.cwd(), '..', 'downloads', 'kamaya_persona_prompt.md');
    // 注意: process.cwd() は通常 nextアプリのルート(src/app等ではなくプロジェクトルート)を指すが、
    // 構成によっては調整が必要。ここでは README.md の構成に基づき ../downloads を参照します。
    // エラーハンドリングとして、ファイルがない場合はデフォルト値を返します。
    if (fs.existsSync(promptPath)) {
      return fs.readFileSync(promptPath, 'utf-8');
    }
  } catch (e) {
    console.error('Failed to load persona prompt:', e);
  }
  return 'あなたは「かま屋通信」のライターです。親しみやすいトーンで書いてください。';
};

export async function POST(request: NextRequest) {
  try {
    const { analysisData, pdfText, type, apiKey } = await request.json();

    if (!apiKey) {
      return NextResponse.json({ success: false, error: 'API Key is required' }, { status: 400 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const persona = getPersonaPrompt();
    let prompt = `${persona}\n\n`;

    // 入力情報のコンテキスト
    const context = `
【元記事の情報】
分析データ: ${JSON.stringify(analysisData)}
記事テキスト（抜粋）: ${pdfText ? pdfText.substring(0, 10000) : 'なし'}
`;

    // コンテンツタイプごとの指示
    switch (type) {
      case 'summary':
        prompt += `
上記の内容を元に、この記事の要約（サマリー）を作成してください。
- 300文字程度
- 箇条書きで主なトピックを3つ挙げる
`;
        break;

      case 'blog':
        prompt += `
上記の内容を元に、Webサイトに掲載するブログ記事のドラフトを作成してください。
- タイトル案を3つ
- 構成: 導入、本文（見出し付き）、まとめ
- 季節感を大切に
`;
        break;

      case 'sns':
        prompt += `
上記の内容を元に、X（旧Twitter）への投稿案を作成してください。
- 投稿案を3パターン（共感重視、情報重視、問いかけ）
- ハッシュタグを含める
- 140文字以内
`;
        break;
        
      case 'video_prompt':
        prompt += `
この記事を紹介するショート動画（60秒）を作成するための構成案と、動画生成AIへのプロンプトを作成してください。
- シーン構成
- ナレーション原稿
- AI画像生成/動画生成用プロンプト（英語）
`;
        break;

      default:
        return NextResponse.json({ success: false, error: 'Invalid type' }, { status: 400 });
    }

    prompt += context;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    return NextResponse.json({ success: true, content: text });

  } catch (error) {
    console.error('Generate error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
