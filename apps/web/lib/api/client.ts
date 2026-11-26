"use client";

import { ApiError, extractApiErrorMessage } from "./types";

const API_BASE = "/api/v1";

let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export interface ClientApiOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  skipAuthRefresh?: boolean;
}

export async function clientApiFetch(path: string, options: ClientApiOptions = {}): Promise<Response> {
  const { body, headers, skipAuthRefresh, ...rest } = options;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${API_BASE}${normalizedPath}`;

  const initHeaders = new Headers(headers);
  let serializedBody: BodyInit | undefined;
  if (body !== undefined && body !== null) {
    if (body instanceof FormData || body instanceof Blob || typeof body === "string" || body instanceof ArrayBuffer) {
      serializedBody = body as BodyInit;
    } else {
      if (!initHeaders.has("Content-Type")) {
        initHeaders.set("Content-Type", "application/json");
      }
      serializedBody = JSON.stringify(body);
    }
  }

  const doFetch = () =>
    fetch(url, {
      ...rest,
      credentials: "same-origin",
      cache: rest.cache ?? "no-store",
      headers: initHeaders,
      body: serializedBody,
    });

  let response = await doFetch();
  if (response.status === 401 && !skipAuthRefresh && !normalizedPath.startsWith("/auth/")) {
    const refreshed = await refreshSession();
    if (refreshed) {
      response = await doFetch();
    }
  }
  return response;
}

export async function clientApi<T = unknown>(path: string, options: ClientApiOptions = {}): Promise<T> {
  const response = await clientApiFetch(path, options);
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!response.ok) {
    throw new ApiError(
      response.status,
      extractApiErrorMessage(parsed, response.statusText || `HTTP ${response.status}`),
      parsed,
    );
  }
  return parsed as T;
}
