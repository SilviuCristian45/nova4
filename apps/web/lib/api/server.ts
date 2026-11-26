import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { getInternalApiUrl, getSetCookiesFromResponse, parseSetCookieHeader } from "./cookies";
import { AUTH_COOKIES, ApiError, extractApiErrorMessage, type ApiAuthUser } from "./types";

export { getInternalApiUrl, getSetCookiesFromResponse, parseSetCookieHeader };

async function applyResponseCookiesToNext(response: Response): Promise<void> {
  const setCookies = getSetCookiesFromResponse(response);
  if (setCookies.length === 0) return;
  try {
    const store = await cookies();
    for (const raw of setCookies) {
      const parsed = parseSetCookieHeader(raw);
      if (!parsed) continue;
      if (parsed.maxAge === 0 || (parsed.expires && parsed.expires.getTime() <= Date.now())) {
        store.delete(parsed.name);
      } else {
        store.set(parsed.name, parsed.value, {
          httpOnly: parsed.httpOnly,
          secure: parsed.secure,
          sameSite: parsed.sameSite,
          path: parsed.path ?? "/",
          domain: parsed.domain,
          maxAge: parsed.maxAge,
          expires: parsed.expires,
        });
      }
    }
  } catch {
    // In Server Components, cookies() is read-only; proxy.ts handles routine token refreshes.
  }
}

export interface ServerApiOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  forwardCookies?: boolean;
  applySetCookies?: boolean;
  skipAuthRefresh?: boolean;
}

async function buildCookieHeader(override?: Map<string, string>): Promise<string> {
  const store = await cookies();
  const map = new Map<string, string>();
  for (const c of store.getAll()) {
    map.set(c.name, c.value);
  }
  if (override) {
    for (const [k, v] of override) {
      map.set(k, v);
    }
  }
  return Array.from(map.entries())
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("; ");
}

export async function serverApiFetch(path: string, options: ServerApiOptions = {}): Promise<Response> {
  const {
    body,
    headers,
    forwardCookies = true,
    applySetCookies = false,
    skipAuthRefresh = false,
    ...rest
  } = options;

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${getInternalApiUrl()}/api/v1${normalizedPath}`;

  const makeInit = async (cookieOverride?: Map<string, string>): Promise<RequestInit> => {
    const initHeaders = new Headers(headers);
    if (forwardCookies) {
      const cookieHeader = await buildCookieHeader(cookieOverride);
      if (cookieHeader) initHeaders.set("cookie", cookieHeader);
    }
    let serializedBody: BodyInit | undefined;
    if (body !== undefined && body !== null) {
      if (typeof body === "string" || body instanceof FormData || body instanceof Blob) {
        serializedBody = body as BodyInit;
      } else {
        if (!initHeaders.has("Content-Type")) {
          initHeaders.set("Content-Type", "application/json");
        }
        serializedBody = JSON.stringify(body);
      }
    }
    return {
      ...rest,
      cache: rest.cache ?? "no-store",
      headers: initHeaders,
      body: serializedBody,
    };
  };

  let response = await fetch(url, await makeInit());

  if (
    response.status === 401 &&
    forwardCookies &&
    !skipAuthRefresh &&
    !normalizedPath.startsWith("/auth/")
  ) {
    const store = await cookies();
    if (store.get(AUTH_COOKIES.refresh)?.value) {
      const refreshRes = await fetch(`${getInternalApiUrl()}/api/v1/auth/refresh`, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          cookie: await buildCookieHeader(),
        },
        body: "{}",
      });
      if (refreshRes.ok) {
        await applyResponseCookiesToNext(refreshRes);
        const overrides = new Map<string, string>();
        for (const raw of getSetCookiesFromResponse(refreshRes)) {
          const parsed = parseSetCookieHeader(raw);
          if (parsed && parsed.value) overrides.set(parsed.name, parsed.value);
        }
        response = await fetch(url, await makeInit(overrides));
      }
    }
  }

  if (applySetCookies) {
    await applyResponseCookiesToNext(response);
  }

  return response;
}

export async function serverApi<T = unknown>(path: string, options: ServerApiOptions = {}): Promise<T> {
  const response = await serverApiFetch(path, options);
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

export const getSessionUser = cache(async (): Promise<ApiAuthUser | null> => {
  const store = await cookies();
  const hasToken =
    Boolean(store.get(AUTH_COOKIES.access)?.value) || Boolean(store.get(AUTH_COOKIES.refresh)?.value);
  if (!hasToken) return null;
  try {
    return await serverApi<ApiAuthUser>("/auth/me", { applySetCookies: true });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    return null;
  }
});
