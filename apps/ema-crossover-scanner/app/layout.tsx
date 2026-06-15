import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EMA Crossover Scanner",
  description:
    "Rank stocks by how recently the 20 EMA crossed above the 50 EMA — blue chips and TradingView watchlists",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
