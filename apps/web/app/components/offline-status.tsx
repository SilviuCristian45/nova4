"use client";

import Link from "next/link";
import { RefreshCw, WifiOff } from "lucide-react";
import { useOffline } from "@/lib/offline/client";
import { useLanguage } from "./language-provider";
import { pageWidth } from "./ui";

// Quiet by default when online & synced; surfaces a crisp telemetry strip only when
// offline, syncing, carrying queued mutations, or encountering a sync error.
export function OfflineStatus() {
  const { t } = useLanguage();
  const { ready, online, syncing, pending, error, sync } = useOffline();
  if (!ready) return null;

  const needsAttention = !online || syncing || pending > 0 || Boolean(error);
  if (!needsAttention) return null;

  return (
    <aside
      aria-label={t("Stare offline", "Offline status")}
      className={`${pageWidth} no-print px-4 pt-3 sm:px-6 lg:px-8`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-card-border bg-card px-3.5 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span
            aria-hidden="true"
            className={
              error
                ? "size-2 rounded-full bg-red"
                : !online
                  ? "size-2 rounded-full bg-gold"
                  : "size-2 animate-pulse rounded-full bg-lime"
            }
          />
          {!online && <WifiOff className="size-3.5 text-gold-text" />}
          <span role="status" className="font-medium text-foreground">
            {!online
              ? t("Mod offline activ", "Offline mode active")
              : syncing
                ? t("Se sincronizează...", "Syncing...")
                : t("Modificări locale în așteptare", "Local changes queued")}
          </span>
          {pending > 0 && (
            <span className="rounded-full bg-gold-soft px-2 py-0.5 font-mono text-[10.5px] font-semibold text-gold-text tabular-nums">
              {pending} {t("în așteptare", "pending")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {!online && (
            <Link href="/offline" className="font-semibold text-lime-text transition-opacity hover:opacity-80">
              {t("Jurnal offline", "Offline log")}
            </Link>
          )}
          {online && (
            <button
              type="button"
              disabled={syncing}
              onClick={() => void sync()}
              className="inline-flex items-center gap-1.5 font-semibold text-soft transition-colors hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={syncing ? "size-3 animate-spin" : "size-3"} />
              {t("Sincronizează", "Sync now")}
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="w-full font-medium text-red-text">
            {t(
              "Sincronizarea nu este completă. Datele locale rămân pe dispozitiv.",
              "Sync incomplete. Locally saved entries remain safe on this device.",
            )}{" "}
            {error}
          </p>
        )}
      </div>
    </aside>
  );
}
