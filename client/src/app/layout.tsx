import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

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
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <Script id="flowback-theme" strategy="beforeInteractive">
          {`(function(){try{var m=window.matchMedia("(prefers-color-scheme: dark)");document.documentElement.setAttribute("data-theme",m.matches?"dark":"light");}catch(e){}})();`}
        </Script>
        {children}
      </body>
    </html>
  );
}
