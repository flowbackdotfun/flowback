import type { Metadata } from "next";
import Script from "next/script";
import { SolanaWalletProvider } from "@/providers/wallet-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "FlowBack — MEV as cashback, on Solana",
  description:
    "FlowBack runs a sealed-bid auction before every swap; searchers compete to backrun you and most of the winning bid is rebated as SOL.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      suppressHydrationWarning
      className="h-full antialiased"
    >
      <body className="min-h-full" suppressHydrationWarning>
        <Script id="flowback-theme" strategy="beforeInteractive">
          {`(function(){try{var m=window.matchMedia("(prefers-color-scheme: dark)");document.documentElement.setAttribute("data-theme",m.matches?"dark":"light");}catch(e){}})();`}
        </Script>
        <SolanaWalletProvider>{children}</SolanaWalletProvider>
      </body>
    </html>
  );
}
