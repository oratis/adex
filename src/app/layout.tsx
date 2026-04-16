import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Adex - Automated Ad Agent",
  description: "AI-powered automated ad placement across Google, Meta, and TikTok",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
