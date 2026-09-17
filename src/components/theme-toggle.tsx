"use client";

import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  function toggleTheme() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("lynerva-theme", next ? "dark" : "light");
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="grid size-8 place-items-center rounded-md text-muted transition-colors hover:bg-surface hover:text-foreground"
      aria-label="Toggle color theme"
    >
      <Moon size={16} strokeWidth={1.7} className="dark:hidden" />
      <Sun size={16} strokeWidth={1.7} className="hidden dark:block" />
    </button>
  );
}
