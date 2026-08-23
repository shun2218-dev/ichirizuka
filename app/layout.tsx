import type { Metadata, Viewport } from "next";
import "./tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "一里塚 — Running Log",
  description:
    "走った記録を積み上げて、本番までの道のりを見るための個人用ダッシュボード",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#e8eced",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /*
      明色に固定する。このアプリは紙を模した明色専用のデザインで、暗色の設計を持たない。
      これが無いと、OS が暗色設定の環境で tokens.css の
      prefers-color-scheme が効き、写像した変数だけが暗色へ飛んで生値と混ざる。
    */
    <html lang="ja" data-theme="light">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Noto+Sans+JP:wght@400;500&family=Roboto+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="shell">{children}</div>
      </body>
    </html>
  );
}
