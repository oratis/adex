import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { I18nProvider } from "@/components/i18n-provider";

export const metadata: Metadata = {
  title: "Adex - Automated Ad Agent",
  description: "AI-powered automated ad placement across Google, Meta, and TikTok",
};

// Runs before React hydrates — applies .dark to <html> to avoid a flash of
// the wrong theme. Adex is dark-first (loopback design language): dark unless
// the user has explicitly chosen light.
const themeInitScript = `
(function() {
  try {
    var saved = localStorage.getItem('adex.theme');
    var useDark = saved !== 'light';
    if (useDark) document.documentElement.classList.add('dark');
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
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
