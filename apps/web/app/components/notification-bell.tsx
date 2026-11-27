"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { useLanguage } from "@/app/components/language-provider";

const HIDDEN_PATHS = ["/login", "/register", "/offline", "/privacy"];
export const NOTIFICATIONS_UPDATED_EVENT = "replog:notifications-updated";

export function NotificationBell({ initialUnread, compact = false }: { initialUnread: number; compact?: boolean }) {
  const { t } = useLanguage();
  const pathname = usePathname();
  const [unread, setUnread] = useState(initialUnread);

  const hidden = HIDDEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  useEffect(() => {
    if (hidden) return;
    let cancelled = false;

    async function refresh() {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      try {
        const response = await fetch("/api/v1/notifications/unread", { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) return;
        const body = (await response.json()) as { count?: number };
        if (!cancelled && typeof body.count === "number") {
          setUnread(body.count);
        }
      } catch {
        // Ignore transient offline errors.
      }
    }

    void refresh();

    const onFocus = () => { void refresh(); };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onCustom = () => { void refresh(); };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, onCustom);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, onCustom);
    };
  }, [pathname, hidden]);

  if (hidden) return null;

  const badgeText = unread > 99 ? "99+" : String(unread);
  const label = unread > 0
    ? t(`Notificări (${unread} necitite)`, `Notifications (${unread} unread)`)
    : t("Notificări", "Notifications");

  return (
    <Link
      href="/notifications"
      aria-label={label}
      title={label}
      className={
        compact
          ? "relative inline-flex size-9 shrink-0 items-center justify-center rounded-md text-soft transition-colors hover:bg-control hover:text-foreground"
          : "relative inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-control text-soft transition-colors hover:text-foreground active:opacity-60"
      }
    >
      <Bell className="size-[18px]" />
      {unread > 0 && (
        <span className="absolute right-0.5 top-0.5 flex min-w-[16px] items-center justify-center rounded-full bg-coral px-1 font-mono text-[9.5px] font-bold leading-[16px] text-on-solid tabular-nums">
          {badgeText}
        </span>
      )}
    </Link>
  );
}
