"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { clientApiFetch } from "@/lib/api/client";
import { extractApiErrorMessage } from "@/lib/api/types";
import { localDate } from "@/lib/daily-metrics";
import type { OfflineDatabase, OfflineMutation, OfflinePayload, OfflineSnapshot } from "./types";
import { SyncError, classifyResponse, type SyncErrorKind } from "./errors";
import { validOfflinePayload } from "./model";
import { randomId } from "@/lib/random-id";
import {
  acknowledgeMutation,
  activateSnapshot,
  discardRejectedMutation,
  enableOfflineDownload,
  enqueueMutation,
  forgetOfflineAccount,
  lockOfflineAccount,
  readOfflineDatabase,
  rejectMutation,
  retryRejectedMutation,
  suspendOfflineAccount,
} from "./store";

const EVENT = "replog-offline-change";
let verifiedOwner: string | null = null;
function notify(queued = false) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { queued } }));
  // Broadcast only a timestamp, never private data, to other app tabs.
  try {
    localStorage.setItem(EVENT, String(Date.now()));
  } catch (error) {
    console.warn("Offline cross-tab notification unavailable:", error);
  }
}

type ResponseBody = { error?: unknown; message?: unknown; snapshot?: OfflineSnapshot; warning?: string | null };

async function request(path: string, options?: { method?: string; body?: unknown }): Promise<ResponseBody> {
  let response: Response;
  try {
    response = await clientApiFetch(path, {
      method: options?.method ?? "GET",
      body: options?.body,
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
  } catch (error) {
    const message = (error as { message?: unknown } | null)?.message;
    throw new SyncError("network", typeof message === "string" ? message : "Network error.");
  }
  let data: ResponseBody = {};
  try {
    data = (await response.json()) as ResponseBody;
  } catch {
    /* error pages (502, gateway timeouts) are not JSON */
  }
  if (!response.ok) {
    const classified = classifyResponse(response.status);
    const kind = classified === "rejected" && options?.method !== "POST" ? "server" : classified;
    if (kind === "session" || kind === "owner") {
      verifiedOwner = null;
      await suspendOfflineAccount();
      notify();
    }
    throw new SyncError(kind, extractApiErrorMessage(data, `Sync failed (${response.status}).`), response.status);
  }
  return data;
}

let running: Promise<void> | null = null;
async function synchronize() {
  const initial = await readOfflineDatabase();
  if (!initial.enabled) return;
  const bootstrap = await request("/offline/snapshot");
  const snapshot = bootstrap.snapshot;
  if (!snapshot?.ownerId) throw new Error("Offline data download failed.");
  await activateSnapshot(snapshot, initial.revision, Boolean(bootstrap.warning));
  verifiedOwner = snapshot.ownerId;
  notify();
  while (navigator.onLine) {
    const state = await readOfflineDatabase();
    if (state.activeOwner !== snapshot.ownerId || state.revision !== initial.revision) return;
    const mutation = state.accounts[snapshot.ownerId]?.queue.find((entry) => !entry.rejected);
    if (!mutation) break;
    try {
      await request("/offline/sync", {
        method: "POST",
        body: {
          id: mutation.id,
          ownerId: mutation.ownerId,
          createdAt: mutation.createdAt,
          payload: mutation.payload,
        },
      });
    } catch (error) {
      if (error instanceof SyncError && error.kind === "rejected") {
        await rejectMutation(snapshot.ownerId, mutation.id, error.message);
        notify();
        continue;
      }
      throw error;
    }
    await acknowledgeMutation(snapshot.ownerId, mutation.id);
    notify();
  }
  if (navigator.onLine) {
    const latest = await request("/offline/snapshot");
    if (!latest.snapshot || latest.snapshot.ownerId !== snapshot.ownerId) {
      await suspendOfflineAccount();
      throw new SyncError("owner", "Account changed. Reopen the app while online.");
    }
    await activateSnapshot(latest.snapshot, initial.revision, Boolean(latest.warning));
    if (latest.warning) throw new Error(latest.warning);
  }
}

export async function syncOffline(manual = false) {
  if (!navigator.onLine) return;
  if (running) {
    if (!manual) return running;
    await running.catch(() => {
      /* A manual retry follows the previous visible failure. */
    });
  }
  if (manual) await enableOfflineDownload();
  running = (async () => {
    try {
      if (navigator.locks) await navigator.locks.request("replog-offline-sync", synchronize);
      else await synchronize();
    } finally {
      running = null;
      notify();
    }
  })();
  return running;
}

export async function saveOfflineMutation(payload: OfflinePayload, expectedOwner: string): Promise<string> {
  if (!validOfflinePayload(payload, localDate())) throw new Error("Invalid offline entry. Check the date and values.");
  const state = await readOfflineDatabase();
  if (!state.activeOwner || state.activeOwner !== expectedOwner) {
    throw new Error("Account changed. Sign in online and download data before offline logging.");
  }
  const id = randomId();
  await enqueueMutation({ id, ownerId: state.activeOwner, createdAt: new Date().toISOString(), payload });
  notify(true);
  return id;
}

type OfflineContextValue = {
  ready: boolean;
  ownerId: string | null;
  online: boolean;
  syncing: boolean;
  pending: number;
  error: string | null;
  snapshot: OfflineSnapshot | null;
  errorKind: SyncErrorKind | null;
  rejected: OfflineMutation[];
  otherPending: number;
  sync: () => Promise<void>;
  forget: () => Promise<void>;
  retryRejected: (id: string) => Promise<void>;
  discardRejected: (id: string) => Promise<void>;
};

const Context = createContext<OfflineContextValue | null>(null);
export function useOffline() {
  const context = useContext(Context);
  if (!context) throw new Error("OfflineProvider is required.");
  return context;
}

export function OfflineProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<OfflineDatabase | null>(null);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<SyncErrorKind | null>(null);
  const [ready, setReady] = useState(false);
  const previousPath = useRef(pathname);

  const refresh = useCallback(async () => {
    try {
      const current = await readOfflineDatabase();
      if (!navigator.onLine) verifiedOwner = current.activeOwner;
      setState(current);
      setReady(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Offline storage unavailable.");
      setReady(true);
    }
  }, []);

  const sync = useCallback(
    async (manual = true) => {
      setSyncing(true);
      setError(null);
      setErrorKind(null);
      try {
        await syncOffline(manual);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Sync failed. Entries remain on this device.");
        setErrorKind(err instanceof SyncError ? err.kind : null);
      } finally {
        setSyncing(false);
        await refresh();
      }
    },
    [refresh],
  );

  const retryRejected = useCallback(
    async (id: string) => {
      const owner = (await readOfflineDatabase()).activeOwner;
      if (owner) await retryRejectedMutation(owner, id);
      notify(true);
      await refresh();
    },
    [refresh],
  );

  const discardRejected = useCallback(
    async (id: string) => {
      const owner = (await readOfflineDatabase()).activeOwner;
      if (owner) await discardRejectedMutation(owner, id);
      notify();
      await refresh();
    },
    [refresh],
  );

  const forget = useCallback(async () => {
    await forgetOfflineAccount();
    verifiedOwner = null;
    notify();
    await refresh();
  }, [refresh]);

  useEffect(() => {
    let disposed = false;
    async function start() {
      setOnline(navigator.onLine);
      if (navigator.onLine && !["/login", "/register"].includes(window.location.pathname)) {
        await sync(false);
      } else {
        await refresh();
      }
      if (disposed) return;
    }
    void start();
    const change = (event: Event) => {
      void refresh();
      if (event instanceof CustomEvent && event.detail?.queued && navigator.onLine) void sync(false);
    };
    const connected = () => {
      setOnline(true);
      void sync(false);
    };
    const disconnected = () => {
      setOnline(false);
    };
    const storage = (event: StorageEvent) => {
      if (event.key === EVENT) void refresh();
    };
    window.addEventListener(EVENT, change);
    window.addEventListener("storage", storage);
    window.addEventListener("online", connected);
    window.addEventListener("offline", disconnected);
    const timer = window.setInterval(() => {
      if (navigator.onLine && !["/login", "/register"].includes(window.location.pathname)) void sync(false);
    }, 60000);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener(EVENT, change);
      window.removeEventListener("storage", storage);
      window.removeEventListener("online", connected);
      window.removeEventListener("offline", disconnected);
    };
  }, [sync, refresh]);

  useEffect(() => {
    if (pathname === "/login" || pathname === "/register") {
      verifiedOwner = null;
      void lockOfflineAccount()
        .then(refresh)
        .catch((err) => setError(String(err)));
    } else if (previousPath.current === "/login" || previousPath.current === "/register") {
      void sync();
    }
    previousPath.current = pathname;
  }, [pathname, refresh, sync]);

  const owner =
    state?.activeOwner &&
    (!online || verifiedOwner === state.activeOwner) &&
    pathname !== "/login" &&
    pathname !== "/register"
      ? state.activeOwner
      : null;
  const account = owner ? state?.accounts[owner] : null;
  return (
    <Context.Provider
      value={{
        ready,
        ownerId: owner,
        online,
        syncing,
        error,
        snapshot: account?.snapshot ?? null,
        pending: account?.queue.filter((entry) => !entry.rejected).length ?? 0,
        errorKind,
        rejected: account?.queue.filter((entry) => entry.rejected) ?? [],
        otherPending: Object.entries(state?.accounts ?? {}).reduce(
          (sum, [id, other]) => (id === owner ? sum : sum + other.queue.length),
          0,
        ),
        sync,
        forget,
        retryRejected,
        discardRejected,
      }}
    >
      {children}
    </Context.Provider>
  );
}
