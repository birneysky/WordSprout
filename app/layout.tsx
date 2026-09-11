import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://ziya-word-sprout.comet-clock-2500.chatgpt.site"),
  title: "字芽 · 一笔一画学汉字",
  description: "给小朋友的离线汉字笔顺练习应用",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.svg?v=2", shortcut: "/favicon.svg?v=2" },
  openGraph: {
    title: "字芽 · 一笔一画学汉字",
    description: "输入汉字，看笔顺动画，听语音提示，再亲手写一遍。",
    images: [{ url: "/og.png", width: 1733, height: 907, alt: "字芽汉字书写启蒙" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "字芽 · 一笔一画学汉字",
    description: "给小朋友的离线汉字笔顺练习应用",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = { themeColor: "#f8f4e9", colorScheme: "light" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
