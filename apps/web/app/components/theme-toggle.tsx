"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useLanguage } from "./language-provider";
import { iconButtonClass } from "./ui";

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { t } = useLanguage();
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label={t("Schimbă tema", "Toggle theme")}
      title={t("Schimbă tema", "Toggle theme")}
      className={
        compact
          ? "relative inline-flex size-9 shrink-0 items-center justify-center rounded-md text-soft transition-colors hover:bg-control hover:text-foreground"
          : iconButtonClass({ className: "relative" })
      }
    >
      <Sun className={compact ? "size-[18px] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" : "size-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0"} />
      <Moon className={compact ? "absolute size-[18px] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" : "absolute size-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100"} />
      <span className="sr-only">{t("Schimbă tema", "Toggle theme")}</span>
    </button>
  );
}
