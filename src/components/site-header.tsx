"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Database,
  Layers3,
  Radio,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AccountMenu } from "./account-menu";
import { ThemeToggle } from "./theme-toggle";
import {
  DesktopScoreTicker,
  MobileScoreTicker,
  useTickerGames,
} from "./score-ticker";

const links = [
  ["Markets", "/", BarChart3],
  ["Live", "/live", Radio],
  ["Builder", "/builder", Layers3],
  ["Sources", "/sources", Database],
  ["Tracker", "/tracker", Activity],
] as const;

export function SiteHeader() {
  const pathname = usePathname();
  const tickerGames = useTickerGames();

  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-[var(--header)] backdrop-blur-2xl">
        <div className="mx-auto max-w-[1480px] px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center gap-4">
          <Link
            href="/"
            className="group inline-flex items-center gap-2.5 text-[15px] font-semibold tracking-[0.14em]"
          >
            <span className="relative grid size-7 place-items-center rounded-[9px] border bg-surface shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]">
              <span className="absolute inset-[5px] rotate-45 rounded-[3px] border border-accent/45" />
              <span className="size-1.5 rounded-full bg-accent shadow-[0_0_10px_var(--accent-glow)]" />
            </span>
            LYNERVA
          </Link>

          <nav
            className="hidden shrink-0 items-center gap-1 sm:flex"
            aria-label="Primary navigation"
          >
            {links.map(([label, href]) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative rounded-lg px-3 py-1.5 text-[13px] transition-colors",
                    active
                      ? "bg-accent-bg text-accent"
                      : "text-muted hover:bg-surface hover:text-foreground",
                  )}
                >
                  {label}
                  {active ? (
                    <span className="absolute inset-x-3 -bottom-[9px] h-0.5 rounded-full bg-accent" />
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <DesktopScoreTicker games={tickerGames} />

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <ThemeToggle />
            <AccountMenu />
          </div>
          </div>

          <div className="border-t border-border/70 sm:hidden">
            <MobileScoreTicker games={tickerGames} />
          </div>
        </div>
      </header>

      <nav
        className="mobile-nav-shell fixed inset-x-0 bottom-0 z-50 grid min-h-[64px] grid-cols-5 border-t px-2 pt-1.5 pb-[max(6px,env(safe-area-inset-bottom))] sm:hidden"
        aria-label="Mobile navigation"
      >
        {links.map(([label, href, Icon]) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className="mobile-nav-item flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl text-[9px] font-medium text-muted"
            >
              <Icon className="size-[17px]" strokeWidth={active ? 2.3 : 1.8} />
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
