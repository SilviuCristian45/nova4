# Probleme Cunoscute, Capcane și Rezolvări (Troubleshooting)

Catalog de erori reale întâlnite în dezvoltarea, migrarea și rularea Docker a RepLog — cu cauza exactă și soluția verificată, ca să nu pierzi timp depanând aceleași probleme de două ori.

---

## 1. Runtime & Node.js

### `Error: Node.js 24+ crypto.argon2 is required`
- **Unde apare**: la `/api/v1/auth/register`, `/login` sau `/password`.
- **Cauză**: `PasswordService` folosește `crypto.argon2` nativ (disponibil din Node.js 24+, fără dependențe C++ native). Mesajul apare dacă rulezi local pe Node 20/22 sau dacă un Dockerfile folosește `node:22-alpine`.
- **Soluție**:
  - Local: instalează / activează **Node.js 24 LTS** (`node -v`).
  - Docker: ambele Dockerfile-uri (`Dockerfile` și `apps/api/Dockerfile`) trebuie să folosească `FROM node:24-alpine`.

---

## 2. Monorepo & Docker Build

### `Cannot find module '@nestjs/typeorm'` la pornirea containerului `api`
- **Cauză**: În npm workspaces, unele pachete (cum e `@nestjs/typeorm`) pot fi instalate în `apps/api/node_modules` în loc să fie hoisted în root `/app/node_modules`. Dacă `Dockerfile` copiază doar `/app/node_modules`, containerul pornește cu `MODULE_NOT_FOUND`.
- **Soluție**: `apps/api/Dockerfile` trebuie să creeze și să copieze și `apps/api/node_modules` + `packages/shared/node_modules` din stage-ul `prod-deps` în `runner`, iar `.dockerignore` trebuie să conțină `**/node_modules` (nu doar `node_modules`).

### `Cannot find module '@replog/shared'` sau tipuri vechi după editare
- **Cauză**: `apps/api` și `apps/web` rezolvă `@replog/shared` prin `packages/shared/dist/`.
- **Soluție**: Rulează `npm run build:shared` după orice modificare în `packages/shared/src/`.

### Contextul de build Docker e uriaș (30–500 MB) sau lent
- **Cauză**: `apps/api/node_modules`, `apps/web/.next` sau fișiere generate PWA au intrat în context.
- **Soluție**: Verifică `.dockerignore` să includă `**/node_modules`, `apps/web/.next`, `apps/api/dist`, `packages/shared/dist`. Cu `.dockerignore` corect, contextul are sub 1 MB.

---

## 3. Rețea locală, Porturi & Caddy

### `https://localhost` nu încarcă RepLog (dar `http://localhost` merge)
- **Cauză**: În `.env.docker.local`, `PUBLIC_SCHEME=http` face Caddy să asculte **strict pe portul 80 (HTTP)** (`SITE_ADDRESS=http://localhost`), ca să evite erori de certificat self-signed și blocaje la presigned URL-urile MinIO.
- **Soluție**:
  - Folosește **`http://localhost`** pe local.
  - Dacă browser-ul te redirecționează forțat pe `https://localhost` din HSTS vechi: șterge HSTS pentru `localhost` (în Chrome/Edge: `chrome://net-internals/#hsts` → Delete domain security policies → `localhost`).
  - Pe un domeniu real de producție (`PUBLIC_SCHEME=https`, `DOMAIN=replog.example.com`), Caddy ascultă pe 80 + 443 cu certificat Let's Encrypt valid.

### Port ocupat la pornire (`5432`, `80`, `9000`, `8081`)
- **Cauză**: Alt container sau serviciu local (ex: alt Postgres local pe `5432` sau alt proxy pe `80`) folosește portul.
- **Soluție**:
  - **Dev (`docker-compose.dev.yml`)**: setează `DEV_POSTGRES_PORT=5439` (și actualizează portul în `apps/api/.env` → `DATABASE_URL=...localhost:5439/replog`), `DEV_MINIO_PORT`, `DEV_ADMINER_PORT`.
  - **Full Docker local (`.env.docker.local`)**: schimbă `HTTP_PORT=8080` și `ADMINER_PORT=8082`. **Important:** dacă schimbi `HTTP_PORT` (nu e `80`), setează și `DOMAIN=localhost:8080` în `.env.docker.local` ca `CORS_ORIGINS` și `S3_PUBLIC_ENDPOINT` să includă portul!

---

## 4. MinIO / S3 & Poze de Progres

### `SignatureDoesNotMatch` (HTTP 403) la upload (`PUT`) sau afișare (`GET`) poze prin Caddy
- **Cauză**: AWS SigV4 semnează **exact** `Host`-ul și path-ul din `S3_PUBLIC_ENDPOINT` (ex: `https://DOMAIN/progress-photos/<user>/<id>.jpg`). Dacă în `Caddyfile` folosești `handle_path /s3/*` (care taie prefixul) sau modifici header-ul `Host`, MinIO calculează o semnătură diferită și respinge cererea.
- **Soluție**:
  - Păstrează `S3_PUBLIC_ENDPOINT=${PUBLIC_SCHEME}://${DOMAIN}` (fără prefix `/s3`).
  - În `Caddyfile`, folosește obligatoriu `handle /progress-photos/*` și `handle /checkin-photos/*` (NU `handle_path`), fără suprascrierea header-ului `Host`.
  - Păstrează `S3_FORCE_PATH_STYLE=true`.

### `DELETE /api/v1/account` sau `DELETE /api/v1/account/data` eșuează când MinIO e oprit
- **Cauză**: **Comportament intenționat (invariant GDPR).** Obiectele din S3/MinIO nu se șterg prin SQL cascade; dacă ștergerea din S3 eșuează, `AccountService` anulează ștergerea din Postgres ca să nu rămână poze orfane pe disc.
- **Soluție**: Pornește MinIO / verifică conectivitatea `S3_ENDPOINT` + credențialele `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`, apoi reîncearcă ștergerea.

### Eroare la upload a 201-a poză de progres (`Photo limit reached`)
- **Cauză**: Limita de 200 poze/cont este impusă atât în `PhotosService`, cât și prin trigger-ul Postgres `progress_photos_limit` (cod SQL `23514`).
- **Soluție**: Șterge poze vechi din `/photos` înainte de a urca altele noi.

---

## 5. Autentificare, Cookie-uri & CORS

### Login-ul reușește (`200`), dar pagina sare imediat înapoi la `/login`
- **Cauze frecvente**:
  1. `COOKIE_SECURE=true` pe o conexiune `http://` (fără HTTPS) → browser-ul aruncă silențios cookie-urile `replog_access_token` și `replog_refresh_token`.
  2. `COOKIE_DOMAIN` setat greșit (nu corespunde domeniului din browser).
  3. `INTERNAL_API_URL` greșit în `web` → `proxy.ts` nu poate ajunge la `api:4000/api/v1/auth/me`.
- **Soluție**:
  - Pe HTTP local: `COOKIE_SECURE=false` și `COOKIE_DOMAIN=` (gol).
  - Pe HTTPS producție: `COOKIE_SECURE=true`.
  - Verifică log-urile `web` și `api` (`docker compose logs -f api web`).

### Rate-limit (`429 Too Many Requests`) fals în producție pentru toți utilizatorii
- **Cauză**: Express nu avea `trust proxy` activat în spatele Caddy, așa că toți utilizatorii apăreau cu același IP (al containerului Caddy).
- **Soluție**: Asigură-te că `TRUST_PROXY=true` (implicit activat în `apps/api/src/app.setup.ts` și `docker-compose.yml`).

---

## 6. Google Drive Backup

### Cardul „Automatic Google Drive backup” nu apare în `/settings`
- **Cauză**: `DriveService.isConfigured()` cere **toate 4** variabilele simultan: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` și `DRIVE_TOKEN_KEY`. Dacă una singură e goală, cardul rămâne ascuns.

### `Error 400: redirect_uri_mismatch` la conectarea Google Drive
- **Cauză**: În arhitectura veche (Next.js Route Handler), URI-ul era `/api/drive/callback`. În NestJS este **`/api/v1/drive/callback`**.
- **Soluție**: Adaugă exact `https://<DOMAIN>/api/v1/drive/callback` (și `http://localhost/api/v1/drive/callback` / `http://localhost:3000/api/v1/drive/callback` pentru local) în **Google Cloud Console → Credentials → OAuth Client → Authorized redirect URIs**.

### Backup-urile automate Google Drive se opresc după 7 zile
- **Cauză**: Aplicația OAuth din Google Cloud Console este în modul **Testing** (Google expiră refresh token-urile după 7 zile).
- **Soluție**: Publică OAuth Consent Screen în modul **In production** (scope-urile `openid`, `email`, `drive.appdata` sunt non-sensitive și nu necesită verificare Google).

### Eroare la decriptarea token-ului Drive după migrare / schimbare server
- **Cauză**: `DRIVE_TOKEN_KEY` a fost regenerat diferit față de serverul vechi.
- **Soluție**: Păstrează același `DRIVE_TOKEN_KEY` când migrezi tabela `google_drive_backups` (sau deconectează și reconectează Drive-ul din `/settings`).

---

## 7. Migrarea din Supabase (`scripts/migrate-from-supabase.ts`)

### `getaddrinfo ENOTFOUND db.<ref>.supabase.co`
- **Cauză**: Pe planul Free Supabase, conexiunea **Direct** este IPv6-only și nu se rezolvă pe rețele IPv4.
- **Soluție**: În Supabase Dashboard → **Connect** → tab **Direct (Connection string)** → alege **Session pooler** (`postgresql://postgres.<ref>:<PAROLA>@aws-0-<region>.pooler.supabase.com:5432/postgres`).

### `password authentication failed` sau eroare de parsare URL la migrare
- **Cauză**: Parola DB conține caractere speciale (`#`, spațiu, `@`, `?`, `%`) ne-codate URL (`#` trunchiază tot restul URL-ului!).
- **Soluție**: Fă URL-encode parolei (spațiu → `%20`, `#` → `%23`, `@` → `%40`) sau resetează parola DB din Supabase la o parolă alfanumerică.

### Contul migrat nu are datele vechi pe local
- **Cauză**: Ai creat anterior un cont de test local cu **același email**, generând un UUID nou care blochează prin `ON CONFLICT DO NOTHING` inserarea user-ului vechi din Supabase.
- **Soluție**: Golește baza țintă (`TRUNCATE TABLE public.users, public.foods RESTART IDENTITY CASCADE;`) înainte să rulezi `scripts/migrate-from-supabase.ts`.

---

## 8. Frontend: Tailwind CSS 4, Next.js 16 & PWA

### Clasele `zinc-*`, `slate-*`, `emerald-*` nu au niciun efect
- **Cauză**: `apps/web/app/globals.css` dezactivează intenționat paleta implicită Tailwind (`--color-*: initial`).
- **Soluție**: Folosește exclusiv tokenii de design ai proiectului (`bg-background`, `bg-card`, `bg-inner`, `bg-control`, `text-foreground`, `text-muted`, `lime`, `coral`, `ice`, `lilac`, `gold`, `red`).

### `className="p-2"` pe `<Card>` sau `<Button>` este ignorat
- **Cauză**: În Tailwind CSS 4 câștigă ordinea regulilor din stylesheet, nu ordinea din atributul `className`.
- **Soluție**: Nu suprascrie utilitare setate în primitivele `apps/web/app/components/ui/*` — folosește sau adaugă un prop explicit (`compact`, `small`, `large`, `inCard`).

### Service Worker / Offline nu se activează în `npm run dev:web`
- **Cauză**: `@ducanh2912/next-pwa` este dezactivat intenționat când `NODE_ENV=development` (`apps/web/next.config.ts`).
- **Soluție**: Testează comportamentul PWA / offline prin `npm run docker:local` (build de producție cu `--webpack`). După un deploy nou, închide toate tab-urile deschise ale aplicației și redeschide-o ca noul Service Worker să se activeze.

### `next build` eșuează fără `--webpack`
- **Cauză**: `@ducanh2912/next-pwa` necesită integrarea webpack (nu Turbopack). Scriptul `apps/web/package.json` folosește deja `next build --webpack`; nu îl elimina.
