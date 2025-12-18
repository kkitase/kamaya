import type { Metadata } from 'next';
import { Noto_Sans_JP, Shippori_Mincho } from 'next/font/google';
import './globals.css';

const notoSans = Noto_Sans_JP({ 
  subsets: ['latin'],
  variable: '--font-noto-sans',
});

const shipporiMincho = Shippori_Mincho({ 
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-shippori-mincho',
});

export const metadata: Metadata = {
  title: 'かま屋通信を、読み解く。',
  description: 'AIによるトレンド分析ツール',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className={`${notoSans.variable} ${shipporiMincho.variable} font-sans text-[#333333] bg-white antialiased`}>
        {children}
      </body>
    </html>
  );
}
