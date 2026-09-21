import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { MarketDataProvider } from "@/components/market-data-provider";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Huddlemark — NFL market intelligence",
    template: "%s — Huddlemark",
  },
  description:
    "Research executable Kalshi NFL prediction-market prices with disciplined probability estimates.",
  applicationName: "Huddlemark",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0e12" },
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
        <MarketDataProvider>
          <SiteHeader />
          <main className="mx-auto w-full max-w-[1480px] px-3 pb-24 pt-5 sm:px-6 sm:pb-12 sm:pt-8 lg:px-8">
            {children}
          </main>
        </MarketDataProvider>
        <footer className="mx-auto mb-20 max-w-[1480px] border-t px-4 py-6 text-xs text-muted sm:mb-0 sm:px-6 lg:px-8">
          Huddlemark is a research tool, not a sportsbook. Probabilities are model estimates, not guarantees.
        </footer>
      </body>
    </html>
  );
}
