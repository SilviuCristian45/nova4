@AGENTS.md

# RepLog (`nova4`) — context proiect

PWA bilingv (`ro` / `en`) de fitness, nutriție și coaching: antrenamente (seturi, cardio, progresie, PR-uri, plateau), mese și macronutrienți, pași, greutate corporală, check-in zilnic & săptămânal, poze de progres, programe și planuri alimentare de coach, mod offline și backup automat Google Drive.

Utilizatorul comunică în română; codul și comentariile sunt în engleză; textele din UI sunt bilingve.

## Stack și arhitectură (Monorepo fără Supabase)
- **Monorepo npm workspaces** pe **Node.js 24+**:
  - `packages/shared`: logică pură de domeniu, validări și tipuri partajate (`energy`, `plateau`, `personal-record`, `strength-progression`, `daily-metrics`, `checkin`, `photos`, `drive-backup`, `units`, `coach/*`).
  - `apps/api`: **NestJS 11 + TypeORM + PostgreSQL 17 + S3/MinIO (`@aws-sdk/client-s3`)**, prefix `/api/v1`, Swagger `/api/docs`, cron nativ `@nestjs/schedule` pentru Google Drive. Auth cu Argon2id (+ verificare/upgrade automat `bcrypt` din Supabase), JWT access + refresh token rotativ în cookie-uri `HttpOnly` și `Authorization: Bearer`. Autorizare explicită prin `JwtAuthGuard`, `CoachGuard`, `ActiveCoachAccessGuard`.
  - `apps/web`: **Next.js 16** (App Router, `output: "standalone"`, `proxy.ts`), React 19, Tailwind CSS 4, `@ducanh2912/next-pwa`. Zero dependențe `@supabase/*` — comunică exclusiv cu API-ul prin `apps/web/lib/api/{client.ts,server.ts,cookies.ts,types.ts}`.
- **Deploy self-hosted**: un singur `docker-compose.yml` cu **5 servicii** (`postgres`, `minio`, `api`, `web`, `caddy`). Caddy rutează `/api/v1/*` + `/api/docs*` → `api:4000`, `/progress-photos/*` + `/checkin-photos/*` → `minio:9000` (fără strip de path, pentru AWS SigV4 same-origin) și `/*` → `web:3000`. Vezi `docs/self-hosting.md`.
- **Modulul ML (Python/FastAPI)** e în pauză.

## Comenzi uzuale
- Servicii locale dev: `docker compose -f docker-compose.dev.yml up -d` (Postgres + MinIO).
- Dev: `npm run dev:api` (port 4000) + `npm run dev:web` (port 3000; PWA dezactivat în dev).
- Build: `npm run build` (`build:shared`, `build:api`, `build:web` cu `--webpack`).
- Verificări: `npm run typecheck`, `npm run test:shared`, `npm run test:web`, `npm run test:api`, `npm run test:api:e2e`, `node --test scripts/migrate-from-supabase.test.mjs`.
- Migrare date din Supabase: `node scripts/migrate-from-supabase.ts [--dry-run]` (detalii în `docs/self-hosting.md`).

## Baza de date și migrații
- Entitățile și migrațiile TypeORM sunt în `apps/api/src/database/`. `api` aplică automat migrațiile noi la pornire (`TYPEORM_MIGRATIONS_RUN=true`) și creează bucket-urile MinIO (`progress-photos`, `checkin-photos`).
- Folderul `supabase/` și `scripts/migrate.sh` / `verify-migrations.sh` sunt **legacy / arhivate** ca referință până după migrarea datelor de producție; orice schimbare nouă de schemă se face prin migrații TypeORM în `apps/api/src/database/migrations/`.
- Secrete de producție: `node scripts/gen-secrets.mjs` (`POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `DRIVE_TOKEN_KEY`, `CRON_SECRET`).

## Design (Tailwind CSS 4)
- Tokenii sunt în `apps/web/app/globals.css` (`lime` = singurul accent pentru acțiuni; `coral`/`ice`/`lilac`/`gold`/`red` doar pentru date; suprafețe `bg-background`/`bg-card`/`bg-inner`/`bg-control`, fără contururi). Paleta implicită Tailwind e dezactivată (`zinc-*`, `emerald-*` nu există).
- Nu suprascrie prin `className` o clasă deja setată de o primitivă UI (`apps/web/app/components/ui/*`); adaugă un prop explicit (`compact`, `small`, `inCard`).

## Reguli de domeniu esențiale
- **GDPR**: orice tabel nou cu date de utilizator trebuie să aibă FK `on delete cascade` spre `public.users(id)`, verificare explicită `userId`, includere în `AccountService` (`buildExport`, `importData`, `deleteAllData`), în `EXPECTED_TABLES` (`phase1.e2e-spec.ts`) și în `MIGRATION_TABLES` (`scripts/migrate-from-supabase.ts`).
- **Poze (`progress-photos`, `checkin-photos`)**: stocate în MinIO/S3 (`<user_id>/<id>.jpg`, max 200 poze progres per cont). `deleteAllData` / `deleteAccount` șterg **mai întâi** fișierele din S3/MinIO și anulează operația dacă ștergerea eșuează.
- **Catalog comun de alimente**: produsele cu cod de bare au `user_id = null` și se scriu doar pe server din Open Food Facts (`FoodsService`); alimentele manuale rămân private.
- **Offline**: mutațiile trec prin IndexedDB (`apps/web/lib/offline/*`) și se sincronizează atomic/idempotent la `POST /api/v1/offline/sync` (`offline_sync_receipts`). Limitele de validare trebuie păstrate identice între DB, NestJS DTO și `apps/web/lib/offline/model.ts`.
- **Unități & limbă**: greutățile se stochează mereu în `kg`; `profiles.weight_unit` e oglindit în cookie-ul `weight_unit`; textele UI folosesc `t(ro, en)` / `<Text ro en />`.
- **Energie & plateau**: `packages/shared/src/energy.ts` (prag adaptiv ≥10 zile cu mese și ≥3 cântăriri pe ≥10 zile — decizia utilizatorului); `packages/shared/src/plateau.ts` (`PLATEAU_SESSIONS = 4`).

## Idei amânate
- Poze de progres criptate end-to-end (ascunse și de administratori): analiza în `docs/idei/poze-criptate-e2ee.md`.
- Măsurători corporale (talie, piept etc.), rutine de antrenament, link direct spre recomandarea de calorii.
- Aplicație mobilă nativă (React Native / Flutter) — acum deblocată de API-ul REST/OpenAPI NestJS (`/api/v1` + `/api/docs`).
