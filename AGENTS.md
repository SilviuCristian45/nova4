<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# RepLog (`nova4`) — Project Agent Guide

RepLog is a bilingual (`ro` / `en`) fitness, nutrition, and coaching PWA for tracking strength & cardio workouts, sets, personal records, plateaus, meals/macros, barcode foods, daily steps, body weight, daily & weekly check-ins, progress photos, coach programs, and meal plans, with offline queuing and automatic Google Drive backups.

## Communication & Language Conventions

- **User communication**: Respond to the user in **Romanian**.
- **Codebase**: Write code, identifiers, commit-ready strings, and comments in **English**.
- **UI copy**: All user-facing text must be bilingual (`ro` / `en`).
  - Server components/actions: `const { t, language, locale } = await getLanguage()` (`apps/web/app/language.ts`).
  - Client components: `useLanguage()` (`t(ro, en)`) or `<Text ro="..." en="..." />` (`apps/web/app/components/language-provider.tsx`).
  - Default language is `en`, mirrored in the `language` cookie.

## Stack & Monorepo Architecture (Zero Supabase Dependencies)

Npm workspaces monorepo (`package.json` workspaces: `apps/*`, `packages/*`), running on **Node.js 24+** (native `crypto.argon2` for password hashing + native TypeScript test execution):

- **Frontend (`apps/web`)**: Next.js 16 (App Router, `output: "standalone"`, `proxy.ts` instead of `middleware.ts`), React 19, TypeScript (`strict: true`, `@/*` alias), Tailwind CSS 4, `@ducanh2912/next-pwa`, Recharts, Lucide, `html5-qrcode`, `next-themes`.
  - Communicates **exclusively** with the NestJS API via `apps/web/lib/api/{client.ts,server.ts,cookies.ts,types.ts}` (zero `@supabase/*` packages or imports).
  - Server Components / Server Actions / `proxy.ts` call `${INTERNAL_API_URL || "http://localhost:4000"}/api/v1` forwarding the session cookies (`replog_access_token`, `replog_refresh_token`) and transparently refreshing expired access tokens.
  - Browser Client Components call same-origin `/api/v1/*` (routed by Caddy in production or Next.js `rewrites()` in dev).
- **Backend (`apps/api`)**: NestJS 11 + TypeORM + PostgreSQL 17 + `@aws-sdk/client-s3` (MinIO / S3 / R2) + Swagger (`/api/docs`) + `@nestjs/schedule` + `helmet` + `@nestjs/throttler`.
  - Global prefix `/api/v1`, global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`), global `ThrottlerGuard`, and global `JwtAuthGuard` (routes opt out via `@Public()`).
  - Auth: Argon2id password hashing (with transparent `bcrypt` verification & auto-upgrade for accounts migrated from Supabase), short-lived JWT access token (`replog_access_token`) + rotating opaque refresh token (`replog_refresh_token`, reuse-detection by family) delivered in `HttpOnly; SameSite=Lax` cookies plus `Authorization: Bearer` support.
  - Authorization: explicit `userId` scoping + `CoachGuard` + `ActiveCoachAccessGuard` (replaces Postgres RLS).
  - Storage: `StorageService` auto-creates private `progress-photos` and `checkin-photos` buckets on startup and issues same-origin presigned PUT/GET URLs via `S3_PUBLIC_ENDPOINT`.
- **Shared Package (`packages/shared`)**: Pure domain logic, constants, validation, and types shared between `apps/api` and `apps/web` (`account-export`, `checkin`, `checkin-photos`, `coach/*`, `daily-metrics`, `drive-backup`, `energy`, `exercise-catalog`, `personal-record`, `photos`, `plateau`, `rest-timer`, `strength-progression`, `units`, `workout-*`).
- **Route Guard (`apps/web/proxy.ts`)**: Protects authenticated routes and redirects unauthenticated requests to `/login`. Public/bypassed paths: `/offline`, `/privacy`, `/plan/[token]`, `/api/*`, `/sw.js`, `/manifest.json`, workbox scripts; `/login` and `/register` are allowed unauthenticated.
- **Deployment Target**: Self-hosted VPS via a single [docker-compose.yml](file:///E:/learn/nova4/docker-compose.yml) with **5 services**: `postgres` (`postgres:17-alpine`), `minio`, `api` (`apps/api/Dockerfile`), `web` (`Dockerfile`), and `caddy` (`caddy:2-alpine`). Caddy serves `/api/v1/*` + `/api/docs*` → `api:4000`, `/progress-photos/*` + `/checkin-photos/*` → `minio:9000` (path & `Host` preserved for AWS SigV4), and `/*` → `web:3000`. See [docs/self-hosting.md](file:///E:/learn/nova4/docs/self-hosting.md).
- **Paused Scope**: The Python/FastAPI ML module is paused.

### Key Directories

- `apps/api/src/` — NestJS modules (`auth`, `profiles`, `workouts`, `metrics`, `foods`, `meals`, `photos`, `coach`, `meal-plans`, `notifications`, `offline`, `account`, `drive`, `health`), `database/` (entities, `data-source.ts`, `migrations/`), `storage/`, `common/`.
- `apps/web/app/` — App Router pages (`/`, `/insert`, `/edit/[id]`, `/history`, `/records`, `/stats`, `/meals/**`, `/photos`, `/checkin/weekly`, `/coach/**`, `/explore`, `/notifications`, `/plan/[token]`, `/settings`, `/offline`, `/privacy`, `/login`, `/register`) and Server Actions.
- `apps/web/app/components/ui/` — Design-system primitives (`Screen`, `Columns`, `Stack`, `Card`, `Inner`, `Button`, `IconButton`, `Input`, `Textarea`, `Select`, `Segmented`, `Badge`, `Message`, `ProgressBar`, `CtaCard`, `LinkList`, `BigNumber`, `Empty`, `TextLink`, `pageWidth`).
- `apps/web/app/components/workout-parts.tsx` — Shared workout set badges and session list used identically across `/insert`, `/offline`, and `/edit`.
- `apps/web/lib/api/` — Typed HTTP clients (`client.ts`, `server.ts`, `cookies.ts`, `types.ts`).
- `apps/web/lib/offline/` — IndexedDB store, offline provider, mutation model/validation, and sync helpers targeting `POST /api/v1/offline/sync`.
- `packages/shared/src/` — Pure domain logic and co-located `*.test.mjs` unit tests.
- `scripts/` — `gen-secrets.mjs` (stack secret generator), `migrate-from-supabase.ts` + `migrate-from-supabase.test.mjs` (one-shot idempotent Supabase DB + Storage migration).
- `supabase/` *(legacy/archived)* — Historical SQL migrations retained only as reference until production data migration from Supabase is complete. Do **not** add new features here; new schema changes go in `apps/api/src/database/migrations/`.

## Commands & Verification

- **Local backing services (Postgres + MinIO)**:
  - `docker compose -f docker-compose.dev.yml up -d` (ports configurable via `DEV_POSTGRES_PORT`, `DEV_MINIO_PORT`, `DEV_MINIO_CONSOLE_PORT`).
- **Dev / Build**:
  - `npm run dev:api` (NestJS watch mode on port `4000`, Swagger at `/api/docs`).
  - `npm run dev:web` (Next.js dev on port `3000`; service worker / PWA is disabled in dev).
  - `npm run build` (builds `@replog/shared`, `@replog/api`, and `@replog/web` — web uses `next build --webpack`, required by `@ducanh2912/next-pwa`).
- **Tests**:
  - `npm run test:shared` — pure domain unit tests (`node --test`).
  - `npm run test:web` — web unit tests (`node --test`).
  - `npm run test:api` — NestJS unit tests (`jest`).
  - `npm run test:api:e2e` — NestJS E2E integration tests (`phase1`, `phase2`, `phase3` against Postgres + MinIO).
  - `node --test scripts/migrate-from-supabase.test.mjs` — migration script unit tests.
- **Type check**: `npm run typecheck` (runs across `shared`, `api`, and `web`).
- **Lint**: `npx eslint <touched-files>` (or `npm run lint:web`).
  - Do **not** introduce new lint errors; compare counts against `HEAD` on every file you modify.

## Database & Migrations (TypeORM)

- **Schema & entities**: Defined in `apps/api/src/database/entities/` and `apps/api/src/database/migrations/` (`InitialSchema1764000000000` creates all 32 tables).
- **Auto-run**: `buildDataSourceOptions()` sets `migrationsRun: process.env.TYPEORM_MIGRATIONS_RUN !== "false"` and `synchronize: false`. New migrations run automatically when `api` starts, or manually via `npm run migration:run --workspace=@replog/api`.
- **Environment variables** (see `.env.example` and `apps/api/.env.example`):
  - Core: `DOMAIN`, `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` (generated via `node scripts/gen-secrets.mjs`).
  - Optional: `DISABLE_SIGNUP`, `COACH_SELF_SERVE`, `SWAGGER_ENABLED`, `USDA_API_KEY`.
  - Google Drive backup: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (`https://<DOMAIN>/api/v1/drive/callback`), `DRIVE_TOKEN_KEY` (32 bytes base64 for AES-GCM), `CRON_SECRET`, `DRIVE_CRON_ENABLED=true`. If any required Drive variable is missing, the Settings Drive card stays hidden.

## Design System (Tailwind CSS 4)

- **Tokens**: Defined in `apps/web/app/globals.css`. Default Tailwind colors are **disabled** (`--color-*: initial`) — standard classes like `zinc-*`, `slate-*`, `emerald-*` do not exist.
- **Color discipline**:
  - `lime` is the **only** accent for primary actions.
  - `coral`, `ice`, `lilac`, `gold`, `red` are strictly for data semantics (set types, macros, chart series, warnings/errors).
  - Separate surfaces by fill (`bg-background`, `bg-card`, `bg-inner`, `bg-control`), not borders.
- **Tailwind 4 override rule**: Do **not** override via `className` a utility already applied inside a UI primitive (padding, background, min-height) — in Tailwind 4, CSS order wins over attribute order. Add an explicit prop/variant on the component instead (e.g., `compact`, `small`, `large`, `inCard`).

## Domain Rules & Invariants

- **GDPR checklist for any new user-data table**:
  1. Foreign key to `public.users(id)` with `on delete cascade` + TypeORM migration & entity + explicit `userId` authorization checks in NestJS services.
  2. Included in JSON export (`apps/api/src/modules/account/account.service.ts`, `replog-export` v1 format — never export secrets/tokens).
  3. Included in `AccountService.importData()` and `AccountService.deleteAllData()`.
  4. Added to `EXPECTED_TABLES` in `apps/api/test/phase1.e2e-spec.ts` and `MIGRATION_TABLES` in `scripts/migrate-from-supabase.ts` (if applicable).
- **Progress & check-in photos (`apps/api/src/modules/photos/`, `apps/api/src/modules/coach/`)**:
  - Images live in private S3/MinIO buckets `progress-photos` and `checkin-photos` (`<user_id>/<id>.jpg`, browser-resized to 1600px JPEG, max 200 progress photos per user enforced in both service and DB trigger); Postgres stores metadata only.
  - Object storage files do **not** cascade on user deletion: `AccountService.deleteAllData()` and `AccountService.deleteAccount()` must purge both buckets (`StorageService.deleteUserPrefix`) **first** and abort if S3 deletion fails.
  - JSON export includes progress photo metadata only; import intentionally skips photo rows. Google Drive backup uploads images separately as `replog-photo-<id>.jpg` and restores them via `DriveService`. Online-only.
- **Shared barcode food catalog (`apps/api/src/modules/foods/`)**:
  - Barcode entries have `user_id = null` and are written server-side only from Open Food Facts — never trust client-submitted nutrition values for shared rows. User-created manual foods remain private.
- **Offline logging (`apps/web/lib/offline/*`, `/offline`, `apps/api/src/modules/offline/`)**:
  - When `useOffline().ownerId` exists, workout, steps, weight, and check-in saves queue into IndexedDB (`saveOfflineMutation`) and replay atomically via `POST /api/v1/offline/sync` (transactional + advisory lock + idempotent via `offline_sync_receipts`).
  - Keep validation limits identical across Postgres constraints, NestJS DTOs/services, and `apps/web/lib/offline/model.ts` (plus `/insert` and `/offline` forms).
  - Unreachable navigation falls back to `/offline`, so every offline-capable feature must also work on `/offline`. Local queues must stay isolated per account on sign-out or account switch.
- **Weight units**:
  - Always store weights in **kg** in Postgres. Format/parse through `@replog/shared` (`units`), `useUnits()` (client), and `getWeightUnit` / `getWeightFormatter` (`apps/web/app/units.ts`, server).
  - User choice is stored in `profiles.weight_unit` and mirrored to the `weight_unit` cookie (updated on profile save, login, and registration).
- **Energy recommendation & plateau detection**:
  - `packages/shared/src/energy.ts` (used in `/meals/progress/targets`): Mifflin-St Jeor × activity, or adaptive TDEE from mean calories (≥10 meal days) and weight regression (≥3 weigh-ins across ≥10 days — keep this threshold as decided by the user).
  - `packages/shared/src/plateau.ts`: flags a plateau after `PLATEAU_SESSIONS = 4` sessions without a new estimated 1RM; shown alongside all-time PRs in `/insert` (not in `/offline`).
