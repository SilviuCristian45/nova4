import { createHash, randomBytes } from "node:crypto";
import { AUTO_BACKUP_KEEP, filesToPrune, type DriveFile } from "@replog/shared";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const SCOPES = ["openid", "email", DRIVE_SCOPE].join(" ");
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export class GoogleAuthError extends Error {
  constructor(readonly code: string, description?: string) {
    super(description ? `${code}: ${description}` : code);
  }
}

export function startGoogleAuthorization(cfg: GoogleOAuthConfig) {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  return { state, verifier, url: `${AUTH_URL}?${params}` };
}

async function tokenRequest(body: Record<string, string>) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, string | undefined>;
  if (!response.ok) {
    throw new GoogleAuthError(data.error ?? `HTTP ${response.status}`, data.error_description);
  }
  return data;
}

export async function exchangeGoogleCode(cfg: GoogleOAuthConfig, code: string, verifier: string) {
  const data = await tokenRequest({
    code,
    code_verifier: verifier,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: "authorization_code",
  });
  let email: string | null = null;
  try {
    const payload = JSON.parse(
      Buffer.from((data.id_token ?? "").split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as { email?: unknown };
    if (typeof payload.email === "string") email = payload.email;
  } catch {
    email = null;
  }
  return {
    refreshToken: data.refresh_token ?? null,
    accessToken: data.access_token ?? null,
    scopes: (data.scope ?? "").split(" "),
    email,
  };
}

export async function refreshGoogleAccessToken(cfg: GoogleOAuthConfig, refreshToken: string): Promise<string> {
  const data = await tokenRequest({
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "refresh_token",
  });
  if (!data.access_token) throw new Error("Google did not return an access token");
  return data.access_token;
}

export async function revokeGoogleToken(token: string): Promise<void> {
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined);
}

export class GoogleDriveClient {
  private token: string | null = null;

  constructor(
    private readonly cfg: GoogleOAuthConfig,
    private readonly refreshToken: string,
  ) {}

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      if (!this.token) this.token = await refreshGoogleAccessToken(this.cfg, this.refreshToken);
      const response = await fetch(url, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${this.token}` },
      });
      if (response.status === 401 && attempt === 0) {
        this.token = null;
        continue;
      }
      if (!response.ok) {
        throw new Error(`Google Drive ${response.status}: ${(await response.text()).slice(0, 200)}`);
      }
      return response;
    }
  }

  private async upload(name: string, mimeType: string, content: Buffer): Promise<void> {
    const boundary = `replog${randomBytes(12).toString("hex")}`;
    const metadata = JSON.stringify({ name, parents: ["appDataFolder"], mimeType });
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      ),
      content,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    await this.request(`${UPLOAD_API}/files?uploadType=multipart`, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: new Uint8Array(body),
    });
  }

  async uploadBackup(name: string, text: string): Promise<void> {
    await this.upload(name, "application/json", Buffer.from(text, "utf8"));
  }

  async uploadPhoto(name: string, bytes: Buffer): Promise<void> {
    await this.upload(name, "image/jpeg", bytes);
  }

  async listBackups(): Promise<DriveFile[]> {
    const params = new URLSearchParams({
      spaces: "appDataFolder",
      orderBy: "createdTime desc",
      pageSize: "100",
      fields: "files(id,name,createdTime)",
      q: "not mimeType contains 'image/'",
    });
    const response = await this.request(`${API}/files?${params}`);
    return ((await response.json()) as { files?: DriveFile[] }).files ?? [];
  }

  async downloadBackup(id: string): Promise<string> {
    return (await this.request(`${API}/files/${encodeURIComponent(id)}?alt=media`)).text();
  }

  async listPhotos(): Promise<{ id: string; name: string }[]> {
    const files: { id: string; name: string }[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        spaces: "appDataFolder",
        pageSize: "1000",
        fields: "nextPageToken,files(id,name)",
        q: "mimeType = 'image/jpeg'",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const page = (await (await this.request(`${API}/files?${params}`)).json()) as {
        files?: { id: string; name: string }[];
        nextPageToken?: string;
      };
      files.push(...(page.files ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return files;
  }

  async downloadBytes(id: string): Promise<Buffer> {
    return Buffer.from(await (await this.request(`${API}/files/${encodeURIComponent(id)}?alt=media`)).arrayBuffer());
  }

  async deleteFile(id: string): Promise<void> {
    await this.request(`${API}/files/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async uploadAndPrune(name: string, text: string, keep = AUTO_BACKUP_KEEP): Promise<void> {
    await this.uploadBackup(name, text);
    try {
      for (const old of filesToPrune(await this.listBackups(), keep)) {
        await this.deleteFile(old.id);
      }
    } catch {
      // Best-effort pruning never fails a completed backup upload.
    }
  }
}
