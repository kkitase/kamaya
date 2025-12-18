import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const ANALYSIS_PROMPT = `あなたは食材分析の専門家です。このPDFは「かま屋通信」というニュースレターです。PDFの内容を分析してください。

【分析内容】
1. **食材リスト**: PDFに登場する食材（野菜、肉、魚、穀物、調味料など）をすべて抽出してください
2. **メニュー/料理名リスト**: PDFに登場する料理名やメニュー名をすべて抽出してください
3. **調理法**: 登場する調理法（焼く、煮る、蒸すなど）を抽出してください
4. **季節/イベント**: 言及されている季節や食に関するイベントを抽出してください

【出力形式】
必ず以下のJSON形式で出力してください。他の説明文は不要です：
{
  "ingredients": ["食材1", "食材2", ...],
  "dishes": ["料理名1", "料理名2", ...],
  "cookingMethods": ["調理法1", "調理法2", ...],
  "seasons": ["季節/イベント1", ...]
}`;

// 単一PDFを分析するAPI
export async function POST(request: NextRequest) {
  try {
    const { pdf, apiKey } = await request.json() as { 
      pdf: { title: string; pdfBase64: string }; 
      apiKey: string 
    };

    if (!pdf || !pdf.pdfBase64) {
      return NextResponse.json(
        { success: false, error: 'PDF データが必要です' },
        { status: 400 }
      );
    }

    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: 'Gemini API キーが必要です' },
        { status: 400 }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    console.log(`Analyzing PDF: ${pdf.title}`);

    // Gemini APIにPDFを送信
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: 'application/pdf',
          data: pdf.pdfBase64,
        },
      },
      { text: ANALYSIS_PROMPT },
    ]);

    const response = await result.response;
    const responseText = response.text();

    // JSON部分を抽出
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({
        success: false,
        error: 'JSONを抽出できませんでした',
      });
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return NextResponse.json({
      success: true,
      title: pdf.title,
      data: {
        ingredients: parsed.ingredients || [],
        dishes: parsed.dishes || [],
        cookingMethods: parsed.cookingMethods || [],
        seasons: parsed.seasons || [],
      },
    });

  } catch (error) {
    console.error('Analyze error:', error);
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
