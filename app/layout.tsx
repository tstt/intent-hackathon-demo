import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import ContextProvider from "@/app/providers"; // 引入我们刚才写的 Provider
import { headers } from "next/headers"; // 修正这里

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Intent Solver Demo",
  description: "AI-Powered Cross-Chain Intents",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 获取 cookies 以支持服务端渲染 (SSR) 的钱包状态
  const headersObj = await headers(); // 修正：await headers()
  const cookies = headersObj.get('cookie')

  return (
    <html lang="en">
      <body className={inter.className}>
        <ContextProvider cookies={cookies}>
          {children}
        </ContextProvider>
      </body>
    </html>
  );
}