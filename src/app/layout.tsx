import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { I18nProvider } from "@/components/i18n-provider";

export const metadata: Metadata = {
  title: "Adex - Automated Ad Agent",
  description: "AI-powered automated ad placement across Google, Meta, and TikTok",
};

// Runs before React hydrates — reads localStorage/theme preference and
// applies .dark to <html> to avoid a flash of the wrong theme.
const themeInitScript = `
(function() {
  try {
    var saved = localStorage.getItem('adex.theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var useDark = saved === 'dark' || (saved !== 'light' && prefersDark);
    if (useDark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="antialiased">
        <ThemeProvider>
          <I18nProvider>{children}</I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
