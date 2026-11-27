"use client";

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export type Language = "en" | "ro";
type LanguageContextValue = {
  language: Language;
  locale: string;
  t: (ro: string, en: string) => string;
  setLanguage: (language: Language) => void;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ initialLanguage, children }: { initialLanguage: Language; children: ReactNode }) {
  const [language, updateLanguage] = useState(initialLanguage);
  const router = useRouter();
  useEffect(() => {
    async function restoreOfflineLanguage() {
      const saved = document.cookie.split("; ").find((entry) => entry.startsWith("language="))?.split("=")[1];
      if (saved === "en" || saved === "ro") {
        updateLanguage(saved);
        document.documentElement.lang = saved;
      }
    }
    void restoreOfflineLanguage();
  }, []);
  const t = useCallback((ro: string, en: string) => language === "ro" ? ro : en, [language]);
  const setLanguage = (next: Language) => {
    document.cookie = `language=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    document.documentElement.lang = next;
    updateLanguage(next);
    if (navigator.onLine) router.refresh();
  };

  return <LanguageContext.Provider value={{ language, locale: language === "ro" ? "ro-RO" : "en-US", t, setLanguage }}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider");
  return context;
}

export function Text({ ro, en }: { ro: string; en: string }) {
  return useLanguage().t(ro, en);
}

export function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const { language, setLanguage, t } = useLanguage();
  if (compact) {
    const next: Language = language === "ro" ? "en" : "ro";
    return (
      <button
        type="button"
        onClick={() => setLanguage(next)}
        aria-label={t("Schimbă limba în engleză", "Switch language to Romanian")}
        title={t("Limbă: Română (click pentru EN)", "Language: English (click for RO)")}
        className="inline-flex h-9 items-center justify-center rounded-md px-2 font-mono text-[11px] font-semibold uppercase tracking-[0.04em] text-soft transition-colors hover:bg-control hover:text-foreground"
      >
        {language}
      </button>
    );
  }
  return (
    <select
      aria-label={t("Limba interfeței", "Interface language")}
      value={language}
      onChange={(event) => setLanguage(event.target.value as Language)}
      className="h-10 appearance-none rounded-md border border-card-border bg-control px-3.5 text-sm font-semibold text-soft transition-colors hover:text-foreground"
    >
      <option value="en">English</option>
      <option value="ro">Română</option>
    </select>
  );
}
