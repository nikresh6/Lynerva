import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Lynerva — NFL prediction-market research",
    template: "%s — Lynerva",
  },
  description:
    "Compare executable NFL prediction-market prices across Kalshi and Polymarket with disciplined probability estimates.",
  applicationName: "Lynerva",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0d" },
  ],
};

const themeScript = `
try {
  const stored = localStorage.getItem('lynerva-theme');
  const dark = stored === 'dark' || (!stored && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
} catch (_) {}
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script id="lynerva-theme" strategy="beforeInteractive">
          {themeScript}
        </Script>
        <SiteHeader />
        <main className="mx-auto w-full max-w-[1480px] px-4 pb-12 pt-8 sm:px-6 lg:px-8">
          {children}
        </main>
        <footer className="mx-auto max-w-[1480px] border-t px-4 py-6 text-xs text-muted sm:px-6 lg:px-8">
          Probabilities are model estimates, not guarantees. Lynerva does not place trades.
        </footer>
      </body>
    </html>
  );
}
