"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { AccountMenu } from "./account-menu";
import { ThemeToggle } from "./theme-toggle";

const links = [["Markets", "/"], ["Live", "/live"], ["Builder", "/builder"], ["Sources", "/sources"], ["Tracker", "/tracker"]] as const;

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b bg-[var(--header)] backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1480px] items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="mr-2 text-[15px] font-semibold tracking-[0.14em]"
        >
          LYNERVA
        </Link>
        <nav
          className="scrollbar-subtle hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto sm:flex"
          aria-label="Primary navigation"
        >
          {links.map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
                pathname === href
                  ? "bg-surface text-foreground"
                  : "text-muted hover:bg-surface hover:text-foreground",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle />
          <AccountMenu />
        </div>
      </div>
      <nav
        className="grid h-11 grid-cols-5 border-t px-2 sm:hidden"
        aria-label="Primary navigation"
      >
        {links.map(([label, href]) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center justify-center rounded-md text-[13px] transition-colors",
              pathname === href
                ? "bg-surface text-foreground"
                : "text-muted hover:bg-surface hover:text-foreground",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
