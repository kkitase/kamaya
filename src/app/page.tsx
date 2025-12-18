'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

// --- Types ---
interface Article {
  title: string;
  url: string;
  date: string;
  pdfUrl?: string;
  pdfType?: 'google-drive' | 'direct';
}

interface PdfData {
  title: string;
  pdfBase64: string;
  size: number;
}

interface RankingItem {
  name: string;
  count: number;
}

interface AnalysisResults {
  ingredients: RankingItem[];
  dishes: RankingItem[];
  cookingMethods: RankingItem[];
  seasons: RankingItem[];
}

type Step = 'idle' | 'scraping' | 'extracting' | 'analyzing' | 'loading' | 'complete';

// --- Icons ---
const IconArrowRight = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M5 12H19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 5L19 12L12 19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const IconCheck = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const IconDownload = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M7 10L12 15L17 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 15V3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const IconAnalyze = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 12H22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M12 2C7.5 2 4 5.5 4 10V14C4 18.5 7.5 22 12 22C16.5 22 20 18.5 20 14V10C20 5.5 16.5 2 12 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M9 12V16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M15 12V16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);


// --- Main Component ---
export default function Home() {
  // State
  const [step, setStep] = useState<Step>('idle');
  const [articles, setArticles] = useState<Article[]>([]);
  const [pdfDataList, setPdfDataList] = useState<PdfData[]>([]);
  const [results, setResults] = useState<AnalysisResults | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [skippedCount, setSkippedCount] = useState(0);
  const [savedPdfCount, setSavedPdfCount] = useState(0);
  
  // キャンセル制御用
  const abortControllerRef = useRef<AbortController | null>(null);

  // 初回ロード
  useEffect(() => {
    checkSavedPdfs();
  }, []);

  const addLog = useCallback((message: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  }, []);

  const checkSavedPdfs = async () => {
    try {
      const response = await fetch('/api/load-pdfs');
      const data = await response.json();
      if (data.success) {
        setSavedPdfCount(data.count);
      }
    } catch { /* ignore */ }
  };

  // --- Handlers (Logic) ---
  const handleLoadSavedPdfs = async () => {
    setStep('loading');
    setError(null);
    addLog('保存済みPDFを確認中...');

    try {
      const metaResp = await fetch('/api/load-pdfs');
      const meta = await metaResp.json();
      if (!meta.success) throw new Error(meta.error);
      if (meta.pdfs.length === 0) {
        setStep('idle');
        return;
      }

      addLog(`${meta.count}件のPDFを検出。読み込みを開始します...`);

      const batchSize = 5;
      const allPdfs: PdfData[] = [];
      const filenames = meta.pdfs.map((p: any) => p.filename);

      for (let i = 0; i < filenames.length; i += batchSize) {
        // キャンセルチェック（必要なら実装）
        // if (abortControllerRef.current?.signal.aborted) break;

        const batch = filenames.slice(i, i + batchSize);
        const contentResp = await fetch('/api/load-pdfs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filenames: batch }),
        });
        const contentData = await contentResp.json();
        if (contentData.success && contentData.pdfs) {
          allPdfs.push(...contentData.pdfs);
        }
        // 少しWaitを入れるとUIが固まらない
        await new Promise(r => setTimeout(r, 100));
      }

      setPdfDataList(allPdfs);
      addLog(`${allPdfs.length}件のPDFをメモリに読み込みました。`);
      setStep('idle');
    } catch (err) {
      setError(String(err));
      setStep('idle');
    }
  };

  const handleScrape = async () => {
    setStep('scraping');
    setError(null);
    setLogs([]);
    setProgress({ current: 0, total: 0 });
    addLog('Webサイトから記事情報を収集中...');

    // AbortController for cancellation
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch('/api/scrape', { signal: controller.signal });
      
      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        if (controller.signal.aborted) {
          reader.cancel();
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        // SSE メッセージをパース
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || ''; // 最後の不完全なメッセージを保持

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === 'log') {
                addLog(data.message);
              } else if (data.type === 'progress') {
                addLog(data.message);
                if (data.total) {
                  setProgress({ current: data.current, total: data.total });
                }
              } else if (data.type === 'complete') {
                setArticles(data.articles);
                addLog(`${data.total}件の記事を発見しました。（うちPDFあり: ${data.withPdf}件）`);
              } else if (data.type === 'error') {
                setError(data.error);
              }
            } catch {
              // JSON parse error, ignore
            }
          }
        }
      }

      setStep('idle');
    } catch (err: unknown) {
      if (err instanceof Error && (err.name === 'AbortError' || err.message === 'Canceled')) {
        addLog('取得がキャンセルされました。');
      } else {
        setError(String(err));
      }
      setStep('idle');
    } finally {
      abortControllerRef.current = null;
    }
  };

  const handleExtract = async () => {
    const targets = articles.filter(a => a.pdfUrl);
    if (targets.length === 0) {
      setError('PDFリンクのある記事が見つかりません。');
      return;
    }

    // 新しいコントローラーを作成
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const { signal } = controller;

    setStep('extracting');
    setProgress({ current: 0, total: targets.length });
    setPdfDataList([]);
    setSkippedCount(0);
    
    addLog(`PDFのダウンロードを開始します... (対象: ${targets.length}件)`);
    
    const pdfs: PdfData[] = [];
    let cachedCount = 0;
    let downloadedCount = 0;
    let skippedCount = 0;

    try {
      for (let i = 0; i < targets.length; i++) {
          if (signal.aborted) throw new Error('Canceled');

          const article = targets[i];
          setProgress({ current: i + 1, total: targets.length });
          
          try {
              const res = await fetch('/api/extract', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                      pdfUrl: article.pdfUrl,
                      title: article.title,
                      pdfType: article.pdfType
                  }),
                  signal // fetchにシグナルを渡す
              });
              const data = await res.json();
              
              if (data.success) {
                  pdfs.push({ title: data.title, pdfBase64: data.pdfBase64, size: data.size });
                  if (data.cached) {
                    cachedCount++;
                    // キャッシュは静かに（ログ出さない）
                  } else {
                    downloadedCount++;
                    addLog(`新規ダウンロード: ${article.title.substring(0, 25)}...`);
                  }
              } else {
                  skippedCount++;
                  // スキップ理由があれば表示
                  if (data.error && !data.error.includes('Access denied')) {
                    addLog(`スキップ: ${article.title.substring(0, 20)}...`);
                  }
              }
          } catch (e: unknown) {
              if (e instanceof Error && e.name === 'AbortError') throw e;
              skippedCount++;
          }
          
          // キャンセル可能な待機 (キャッシュヒット時は短く)
          const waitTime = cachedCount > downloadedCount ? 100 : 500;
          await new Promise<void>((resolve, reject) => {
            if (signal.aborted) return reject(new Error('Canceled'));
            const timer = setTimeout(() => resolve(), waitTime);
            signal.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new Error('Canceled'));
            });
          });
      }

      // 正常終了時
      setPdfDataList(pdfs);
      setSkippedCount(skippedCount);
      addLog(`--- 完了 ---`);
      addLog(`  キャッシュから読込: ${cachedCount}件`);
      addLog(`  新規ダウンロード: ${downloadedCount}件`);
      addLog(`  スキップ（アクセス不可等）: ${skippedCount}件`);
      addLog(`  合計: ${pdfs.length}件`);
      await checkSavedPdfs();

    } catch (err: unknown) {
      if (err instanceof Error && (err.message === 'Canceled' || err.name === 'AbortError')) {
        addLog(`キャンセルされました`);
        addLog(`  キャッシュ: ${cachedCount}件, 新規: ${downloadedCount}件, スキップ: ${skippedCount}件`);
        // キャンセル時点のデータをセット
        setPdfDataList(pdfs);
        setSkippedCount(skippedCount);
        await checkSavedPdfs();
      } else {
        setError(String(err));
      }
    } finally {
      setStep('idle');
      abortControllerRef.current = null;
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      addLog('キャンセル要求を送信...');
    }
  };

  const handleAnalyze = async () => {
    if (!apiKey) {
      setError('Gemini APIキーを入力してください。');
      return;
    }
    if (pdfDataList.length === 0) {
      setError('分析対象のPDFがありません。');
      return;
    }

    // 新しいコントローラーを作成
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const { signal } = controller;

    setStep('analyzing');
    setProgress({ current: 0, total: pdfDataList.length });
    addLog(`Gemini AIによる分析を開始... (${pdfDataList.length}件)`);

    // 結果集計用
    const ingredientsMap = new Map<string, number>();
    const dishesMap = new Map<string, number>();
    const cookingMethodsMap = new Map<string, number>();
    const seasonsMap = new Map<string, number>();

    let successCount = 0;
    let errorCount = 0;

    // Mapを配列に変換してソート
    const sortMap = (map: Map<string, number>) =>
      Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count }));

    try {
      for (let i = 0; i < pdfDataList.length; i++) {
        // キャンセルチェック
        if (signal.aborted) throw new Error('Canceled');

        const pdf = pdfDataList[i];
        setProgress({ current: i + 1, total: pdfDataList.length });

        try {
          const res = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pdf, apiKey }),
            signal, // fetch にもシグナルを渡す
          });
          const data = await res.json();

          if (data.success && data.data) {
            // 結果を集計
            for (const item of data.data.ingredients || []) {
              const key = item.trim();
              if (key) ingredientsMap.set(key, (ingredientsMap.get(key) || 0) + 1);
            }
            for (const item of data.data.dishes || []) {
              const key = item.trim();
              if (key) dishesMap.set(key, (dishesMap.get(key) || 0) + 1);
            }
            for (const item of data.data.cookingMethods || []) {
              const key = item.trim();
              if (key) cookingMethodsMap.set(key, (cookingMethodsMap.get(key) || 0) + 1);
            }
            for (const item of data.data.seasons || []) {
              const key = item.trim();
              if (key) seasonsMap.set(key, (seasonsMap.get(key) || 0) + 1);
            }
            successCount++;
            addLog(`分析完了 (${i + 1}/${pdfDataList.length}): ${pdf.title.substring(0, 20)}...`);
          } else {
            errorCount++;
            addLog(`スキップ: ${pdf.title.substring(0, 20)}...`);
          }
        } catch (err: unknown) {
          if (err instanceof Error && (err.name === 'AbortError' || err.message === 'Canceled')) {
            throw err; // キャンセルはループを抜ける
          }
          errorCount++;
          addLog(`エラー: ${pdf.title.substring(0, 20)}...`);
        }

        // レート制限対策 (キャンセル可能な1秒待機)
        await new Promise<void>((resolve, reject) => {
          if (signal.aborted) return reject(new Error('Canceled'));
          const timer = setTimeout(() => resolve(), 1000);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Canceled'));
          });
        });
      }

      // 正常完了
      setResults({
        ingredients: sortMap(ingredientsMap),
        dishes: sortMap(dishesMap),
        cookingMethods: sortMap(cookingMethodsMap),
        seasons: sortMap(seasonsMap),
      });
      addLog(`分析完了: ${successCount}件成功, ${errorCount}件エラー`);
      setStep('complete');

    } catch (e: unknown) {
      // キャンセルまたはエラー時も途中結果を表示
      if (e instanceof Error && (e.message === 'Canceled' || e.name === 'AbortError')) {
        addLog(`中断しました: ${successCount}件分析済み`);
        setResults({
          ingredients: sortMap(ingredientsMap),
          dishes: sortMap(dishesMap),
          cookingMethods: sortMap(cookingMethodsMap),
          seasons: sortMap(seasonsMap),
        });
        setStep('complete');
      } else {
        setError(String(e));
        addLog(`分析エラー: ${e}`);
        setStep('idle');
      }
    } finally {
      abortControllerRef.current = null;
    }
  };

  // レポートをJSONでダウンロード
  const downloadReportAsJson = () => {
    if (!results) return;
    
    const data = {
      generatedAt: new Date().toISOString(),
      ingredients: results.ingredients,
      dishes: results.dishes,
      cookingMethods: results.cookingMethods,
      seasons: results.seasons,
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kamaya-report-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // レポートをCSVでダウンロード
  const downloadReportAsCsv = () => {
    if (!results) return;
    
    const lines: string[] = [];
    
    // 食材
    lines.push('カテゴリ,名前,出現回数');
    results.ingredients.forEach(item => {
      lines.push(`食材,"${item.name}",${item.count}`);
    });
    results.dishes.forEach(item => {
      lines.push(`料理,"${item.name}",${item.count}`);
    });
    results.cookingMethods.forEach(item => {
      lines.push(`調理法,"${item.name}",${item.count}`);
    });
    results.seasons.forEach(item => {
      lines.push(`季節/イベント,"${item.name}",${item.count}`);
    });
    
    // BOM付きUTF-8でExcel対応
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kamaya-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // レポートをJSONファイルから読み込み
  const loadReportFromJson = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        
        // データ形式を検証
        if (json.ingredients && json.dishes && json.cookingMethods && json.seasons) {
          setResults({
            ingredients: json.ingredients,
            dishes: json.dishes,
            cookingMethods: json.cookingMethods,
            seasons: json.seasons,
          });
          addLog(`レポートを読み込みました: ${file.name}`);
          if (json.generatedAt) {
            addLog(`  生成日時: ${new Date(json.generatedAt).toLocaleString('ja-JP')}`);
          }
          setStep('complete');
        } else {
          setError('無効なファイル形式です。kamaya-report-*.json ファイルを選択してください。');
        }
      } catch (err) {
        setError('JSONファイルの読み込みに失敗しました: ' + String(err));
      }
    };
    reader.readAsText(file);
    
    // 同じファイルを再選択できるようにリセット
    event.target.value = '';
  };


  // --- Render ---
  return (
    <div className="min-h-screen flex flex-col font-sans text-[#333333]">
      
      {/* Header */}
      <header className="fixed w-full top-0 z-50 bg-white/90 backdrop-blur-sm transition-all duration-300 border-b border-[#F0F0F0]">
        <div className="max-w-7xl mx-auto px-6 md:px-12 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w- 3 h-3 bg-[#FFE600] rounded-full inline-block"></span>
            <span className="font-bold tracking-widest text-sm uppercase">Kamaya Analysis</span>
          </div>
          <nav className="hidden md:flex gap-8 text-sm font-medium text-[#666] items-center">
            <a href="#hero" className="hover:text-[#333] transition-colors">About</a>
            <a href="#process" className="hover:text-[#333] transition-colors">Process</a>
            <a href="#report" className="hover:text-[#333] transition-colors">Report</a>
            <label className="cursor-pointer px-3 py-1.5 border border-[#E5E5E5] hover:border-[#FFE600] hover:bg-[#FFE600]/10 transition-all rounded">
              <span>📂 読み込む</span>
              <input 
                type="file" 
                accept=".json"
                onChange={loadReportFromJson}
                className="hidden"
              />
            </label>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section id="hero" className="pt-40 pb-20 px-6 md:px-12 max-w-7xl mx-auto w-full animate-fade-in-up scroll-mt-24">
        <h1 className="font-serif text-5xl md:text-7xl leading-tight mb-8">
          かま屋通信を、<br />
          <span className="marker-yellow">読み解く。</span>
        </h1>
        <p className="text-lg md:text-xl text-[#666] max-w-2xl leading-relaxed">
          手探りの日々、季節の移ろい、そして食への想い。<br />
          数年にわたる記録から、AIが「傾向」と「人気」を見つけ出します。
        </p>
      </section>

      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-6 md:px-12 pb-24">
        
        {/* Setup Section */}
        <section className="mb-20 animate-fade-in-up delay-100">
          <div className="grid md:grid-cols-12 gap-12">
            <div className="md:col-span-4">
               <h2 className="text-sm font-bold uppercase tracking-widest text-[#999] mb-4">00. Preparation</h2>
               <h3 className="text-2xl font-serif mb-4">まずは、鍵の準備を。</h3>
               <p className="text-[#666] text-sm leading-relaxed mb-6">
                 分析には Google Gemini Pro モデルを使用します。<br />
                 APIキーを入力しても、サーバーには保存されません。
               </p>
            </div>
            <div className="md:col-span-8 flex items-center">
               <input 
                 type="password" 
                 placeholder="Enter your Gemini API Key" 
                 value={apiKey}
                 onChange={(e) => setApiKey(e.target.value)}
                 className="w-full bg-[#FAFAFA] border-b border-[#E5E5E5] px-4 py-4 focus:outline-none focus:border-[#FFE600] transition-colors font-mono text-sm"
               />
            </div>
          </div>
        </section>

        {/* Process Steps */}
        <section id="process" className="mb-24 scroll-mt-24">
          <div className="grid md:grid-cols-3 gap-8 md:gap-12">
            
            {/* Step 1 */}
            <div className="group animate-fade-in-up delay-200">
              <div className="border border-[#E5E5E5] p-8 h-full flex flex-col hover:shadow-lg transition-shadow duration-500 bg-white">
                <div className="text-[#FFE600] text-4xl font-serif mb-6">01</div>
                <h3 className="text-xl font-bold mb-4 group-hover:text-[#666] transition-colors">記事を集める</h3>
                <p className="text-[#666] text-sm mb-8 flex-1">
                  公式サイトから過去の記事一覧を取得し、PDFリンクを抽出します。
                </p>
                
                <div className="mt-auto">
                    {articles.length > 0 ? (
                        <div className="flex items-center gap-2 text-sm font-bold text-[#333]">
                            <IconCheck />
                            <span>{articles.length} 件取得完了</span>
                        </div>
                    ) : step === 'scraping' ? (
                        <div>
                            {/* 不定形プログレスバー */}
                            <div className="w-full bg-[#F5F5F5] h-1 mb-2 overflow-hidden">
                                <div className="bg-[#FFE600] h-full w-1/3 animate-pulse"></div>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-xs text-[#999]">収集中...</span>
                                <button onClick={handleCancel} className="text-xs text-red-500 hover:underline">中止</button>
                            </div>
                        </div>
                    ) : (
                        <button 
                            onClick={handleScrape}
                            disabled={step !== 'idle'}
                            className="btn-secondary w-full text-sm block text-center"
                        >
                            取得を開始
                        </button>
                    )}
                </div>
              </div>
            </div>

            {/* Step 2 */}
            <div className="group animate-fade-in-up delay-300">
              <div className="border border-[#E5E5E5] p-8 h-full flex flex-col hover:shadow-lg transition-shadow duration-500 bg-white">
                <div className="text-[#FFE600] text-4xl font-serif mb-6">02</div>
                <h3 className="text-xl font-bold mb-4">PDFを手元に</h3>
                <p className="text-[#666] text-sm mb-8 flex-1">
                  抽出したリンクからPDFをダウンロードし、分析の準備を整えます。
                </p>

                <div className="mt-auto space-y-3">
                    {pdfDataList.length > 0 ? (
                         <div className="text-sm">
                            <div className="flex items-center gap-2 font-bold mb-1">
                                <IconCheck />
                                <span>{pdfDataList.length} 件ロード済み</span>
                            </div>
                            <p className="text-xs text-[#999]">準備完了</p>
                        </div>
                    ) : (
                        <>
                            {savedPdfCount > 0 && (
                                <button 
                                    onClick={handleLoadSavedPdfs}
                                    disabled={step !== 'idle'}
                                    className="w-full text-sm text-[#666] hover:text-[#333] hover:underline mb-2 py-2"
                                >
                                    保存済み ({savedPdfCount}件) を使う
                                </button>
                            )}
                            
                            {step === 'extracting' ? (
                                <div>
                                    <div className="w-full bg-[#F5F5F5] h-1 mb-2">
                                        <div 
                                            className="bg-[#FFE600] h-full transition-all duration-300"
                                            style={{width: `${(progress.current/progress.total)*100}%`}}
                                        ></div>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-xs text-[#999]">{progress.current}/{progress.total}</span>
                                        <button onClick={handleCancel} className="text-xs text-red-500 hover:underline">中止</button>
                                    </div>
                                </div>
                            ) : (
                                <button 
                                    onClick={handleExtract}
                                    disabled={step !== 'idle' || articles.length === 0}
                                    className="btn-secondary w-full text-sm block text-center disabled:opacity-30"
                                >
                                    ダウンロード開始
                                </button>
                            )}
                        </>
                    )}
                </div>
              </div>
            </div>

            {/* Step 3 */}
            <div className="group animate-fade-in-up delay-400">
              <div className="border border-[#E5E5E5] p-8 h-full flex flex-col hover:shadow-lg transition-shadow duration-500 bg-white">
                <div className="text-[#FFE600] text-4xl font-serif mb-6">03</div>
                <h3 className="text-xl font-bold mb-4">AIによる読解</h3>
                <p className="text-[#666] text-sm mb-8 flex-1">
                   Gemini 3.0 Pro が記事を読み込み、食材やメニューの傾向を分析します。
                </p>

                <div className="mt-auto">
                    {step === 'analyzing' ? (
                        <div>
                            <div className="w-full bg-[#F5F5F5] h-1 mb-2">
                                <div 
                                    className="bg-[#FFE600] h-full transition-all duration-300"
                                    style={{width: `${(progress.current/progress.total)*100}%`}}
                                ></div>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-xs text-[#999]">{progress.current}/{progress.total} 分析中...</span>
                                <button onClick={handleCancel} className="text-xs text-red-500 hover:underline">中断して結果を見る</button>
                            </div>
                        </div>
                    ) : (
                        <button 
                            onClick={handleAnalyze}
                            disabled={step !== 'idle' || pdfDataList.length === 0}
                            className="btn-primary w-full text-sm font-bold block text-center disabled:bg-[#E5E5E5] disabled:text-[#999]"
                        >
                            分析を実行
                        </button>
                    )}
                </div>
              </div>
            </div>

          </div>
        </section>

        {/* Console / Status Log */}
        {(logs.length > 0 || error) && (
            <section className="mb-24 bg-[#FAFAFA] p-6 text-xs font-mono text-[#666] border-l-4 border-[#E5E5E5]">
                {error && <div className="text-red-500 font-bold mb-2">Error: {error}</div>}
                <div className="max-h-40 overflow-y-auto space-y-1">
                    {logs.map((log, i) => (
                        <div key={i}>{log}</div>
                    ))}
                    {logs.length === 0 && !error && <div className="opacity-50">System ready.</div>}
                </div>
            </section>
        )}

        {/* Results Section */}
        {results && (
          <section id="report" className="animate-fade-in-up scroll-mt-24">
            <div className="flex flex-wrap items-end justify-between gap-6 mb-12 border-b border-[#333] pb-6">
                <div className="flex items-end gap-6">
                    <h2 className="text-4xl md:text-5xl font-serif">Analysis Report</h2>
                    <span className="text-sm mb-2">分析結果レポート</span>
                </div>
                <div className="flex gap-3">
                    <button 
                        onClick={downloadReportAsCsv}
                        className="text-sm px-4 py-2 border border-[#E5E5E5] hover:border-[#FFE600] hover:bg-[#FFE600]/10 transition-all"
                    >
                        CSV でダウンロード
                    </button>
                    <button 
                        onClick={downloadReportAsJson}
                        className="text-sm px-4 py-2 border border-[#E5E5E5] hover:border-[#FFE600] hover:bg-[#FFE600]/10 transition-all"
                    >
                        JSON でダウンロード
                    </button>
                </div>
            </div>

            <div className="grid md:grid-cols-2 gap-16">
                {/* Ingredients */}
                <div>
                    <h3 className="text-xl font-bold border-b border-[#E5E5E5] pb-4 mb-6 flex items-center justify-between">
                        <span>よく使われた食材</span>
                        <span className="text-[#FFE600] text-sm font-normal">TOP 20</span>
                    </h3>
                    <ul className="space-y-4">
                        {results.ingredients.slice(0, 20).map((item, idx) => (
                            <li key={idx} className="flex items-center gap-4 group">
                                <span className={`w-6 text-sm font-bold ${idx < 3 ? 'text-[#333]' : 'text-[#CCC]'}`}>
                                    {String(idx + 1).padStart(2, '0')}
                                </span>
                                <span className="flex-1 border-b border-[#F0F0F0] pb-1 group-hover:border-[#FFE600] transition-colors relative">
                                    {item.name}
                                    <span 
                                        className="absolute bottom-0 left-0 h-[2px] bg-[#FFE600] opacity-0 group-hover:opacity-100 transition-all duration-500"
                                        style={{ width: `${Math.min(100, (item.count / results.ingredients[0].count) * 100)}%` }}
                                    ></span>
                                </span>
                                <span className="text-sm text-[#999]">{item.count}回</span>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Dishes */}
                <div>
                    <h3 className="text-xl font-bold border-b border-[#E5E5E5] pb-4 mb-6 flex items-center justify-between">
                        <span>人気メニュー傾向</span>
                        <span className="text-[#FFE600] text-sm font-normal">TOP 20</span>
                    </h3>
                    <ul className="space-y-4">
                        {results.dishes.slice(0, 20).map((item, idx) => (
                            <li key={idx} className="flex items-center gap-4 group">
                                <span className={`w-6 text-sm font-bold ${idx < 3 ? 'text-[#333]' : 'text-[#CCC]'}`}>
                                    {String(idx + 1).padStart(2, '0')}
                                </span>
                                <span className="flex-1 border-b border-[#F0F0F0] pb-1 group-hover:border-[#FFE600] transition-colors relative">
                                    {item.name}
                                    <span 
                                        className="absolute bottom-0 left-0 h-[2px] bg-[#FFE600] opacity-0 group-hover:opacity-100 transition-all duration-500"
                                        style={{ width: `${Math.min(100, (item.count / (results.dishes[0]?.count || 1)) * 100)}%` }}
                                    ></span>
                                </span>
                                <span className="text-sm text-[#999]">{item.count}回</span>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            {/* Other Keywords */}
            <div className="mt-20">
                 <h3 className="text-xl font-bold mb-8">季節の言葉・調理法</h3>
                 <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-[#666] leading-relaxed">
                    {results.seasons.slice(0, 20).map((item, i) => (
                        <span key={i} className="hover:text-[#333] hover:underline decoration-[#FFE600] cursor-default transition-all">
                            #{item.name} <span className="text-[#CCC] text-xs">({item.count})</span>
                        </span>
                    ))}
                    {results.cookingMethods.slice(0, 15).map((item, i) => (
                        <span key={i} className="hover:text-[#333] hover:underline decoration-[#FFE600] cursor-default transition-all">
                            #{item.name} <span className="text-[#CCC] text-xs">({item.count})</span>
                        </span>
                    ))}
                 </div>
            </div>

          </section>
        )}

      </main>

      {/* Footer */}
      <footer className="bg-[#F9F9F9] py-12 px-6 border-t border-[#E5E5E5]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="text-xs text-[#999]">
                Created by Google Gemini API <br />
                Monosus Design Style Adaptation
            </div>
            <div className="text-xs text-[#CCC] uppercase tracking-widest">
                © 2025 Kamaya Analysis Tool
            </div>
        </div>
      </footer>
    </div>
  );
}
