import { NextResponse, type NextRequest } from "next/server";
import { canAccessCoachRoute, isCoachRoute, parseUserRole } from "@/lib/coach/types";
import { AUTH_COOKIES, type ApiAuthUser } from "@/lib/api/types";
import { getInternalApiUrl, getSetCookiesFromResponse, parseSetCookieHeader } from "@/lib/api/cookies";

const PUBLIC_EXACT = new Set(["/offline", "/privacy", "/sw.js", "/manifest.json"]);

function buildRequestCookieHeader(request: NextRequest): string {
  return request.cookies
    .getAll()
    .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
    .join("; ");
}

function applySetCookiesToResponses(
  setCookies: string[],
  request: NextRequest,
  response: NextResponse,
): NextResponse {
  if (setCookies.length === 0) return response;

  for (const raw of setCookies) {
    const parsed = parseSetCookieHeader(raw);
    if (!parsed) continue;
    if (parsed.maxAge === 0 || (parsed.expires && parsed.expires.getTime() <= Date.now())) {
      request.cookies.delete(parsed.name);
    } else {
      request.cookies.set(parsed.name, parsed.value);
    }
  }

  const nextResponse = NextResponse.next({ request });
  for (const raw of setCookies) {
    const parsed = parseSetCookieHeader(raw);
    if (!parsed) continue;
    if (parsed.maxAge === 0 || (parsed.expires && parsed.expires.getTime() <= Date.now())) {
      nextResponse.cookies.delete(parsed.name);
    } else {
      nextResponse.cookies.set(parsed.name, parsed.value, {
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
  return nextResponse;
}

function copyCookiesOntoRedirect(setCookies: string[], redirectResponse: NextResponse): NextResponse {
  for (const raw of setCookies) {
    const parsed = parseSetCookieHeader(raw);
    if (!parsed) continue;
    if (parsed.maxAge === 0 || (parsed.expires && parsed.expires.getTime() <= Date.now())) {
      redirectResponse.cookies.delete(parsed.name);
    } else {
      redirectResponse.cookies.set(parsed.name, parsed.value, {
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
  return redirectResponse;
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  if (
    PUBLIC_EXACT.has(path) ||
    path.startsWith("/api/v1/") ||
    path.startsWith("/plan/") ||
    /^\/(?:workbox|worker|fallback)-[^/]+\.js$/.test(path)
  ) {
    return NextResponse.next();
  }

  const hasAccess = Boolean(request.cookies.get(AUTH_COOKIES.access)?.value);
  const hasRefresh = Boolean(request.cookies.get(AUTH_COOKIES.refresh)?.value);
  const apiBase = `${getInternalApiUrl()}/api/v1`;

  let user: ApiAuthUser | null = null;
  let refreshedSetCookies: string[] = [];

  if (hasAccess || hasRefresh) {
    const cookieHeader = buildRequestCookieHeader(request);
    try {
      if (hasAccess) {
        const meRes = await fetch(`${apiBase}/auth/me`, {
          headers: { cookie: cookieHeader },
          cache: "no-store",
        });
        if (meRes.ok) {
          user = (await meRes.json()) as ApiAuthUser;
        }
      }

      if (!user && hasRefresh) {
        const refreshRes = await fetch(`${apiBase}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json", cookie: cookieHeader },
          body: "{}",
          cache: "no-store",
        });
        if (refreshRes.ok) {
          refreshedSetCookies = getSetCookiesFromResponse(refreshRes);
          const session = (await refreshRes.json()) as { user?: ApiAuthUser };
          user = session.user ?? null;
        }
      }
    } catch {
      // API temporarily unreachable — fall through as unauthenticated for non-offline pages.
      user = null;
    }
  }

  const isAuthPage = path.startsWith("/login") || path.startsWith("/register");

  if (!user && !isAuthPage) {
    const url = request.nextUrl.clone();
    const nextPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    url.pathname = "/login";
    url.search = "";
    if (nextPath && nextPath !== "/" && nextPath.startsWith("/") && !nextPath.startsWith("//")) {
      url.searchParams.set("next", nextPath);
    }
    return NextResponse.redirect(url);
  }

  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return copyCookiesOntoRedirect(refreshedSetCookies, NextResponse.redirect(url));
  }

  if (user && (path === "/admin" || path.startsWith("/admin/"))) {
    if (!user.isSuperAdmin) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return copyCookiesOntoRedirect(refreshedSetCookies, NextResponse.redirect(url));
    }
  }

  if (user && isCoachRoute(path)) {
    const role = parseUserRole(user.profile?.role);
    if (!canAccessCoachRoute(role)) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return copyCookiesOntoRedirect(refreshedSetCookies, NextResponse.redirect(url));
    }
  }

  const response = NextResponse.next({ request });
  return applySetCookiesToResponses(refreshedSetCookies, request, response);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest\\.webmanifest|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
