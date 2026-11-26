# RepLog

Bilingual (`ro` / `en`) fitness, nutrition, and coaching PWA built as a self-hosted monorepo:

- **`apps/web`** — Next.js 16 (App Router, standalone, PWA + IndexedDB offline logging, Tailwind CSS 4)
- **`apps/api`** — NestJS 11 + TypeORM + PostgreSQL 17 + S3/MinIO + OpenAPI/Swagger (`/api/docs`) + built-in hourly Google Drive backup cron
- **`packages/shared`** — Pure domain logic, validation, and shared TypeScript types (strength progression, PR & plateau detection, adaptive TDEE energy targets, coaching analytics, meal plans, units)

## Features

- **Strength & Cardio Workouts**: log sets, RIR, warm-up/working/drop sets, cardio sessions, drafts, rest timer, all-time exercise PRs, 4-session plateau hints, interactive charts, and UTF-8 CSV export.
- **Nutrition & Macros**: daily meal logging, custom & shared Open Food Facts / USDA barcode food search, reusable meal templates, adaptive calorie targets (Mifflin-St Jeor or regression-based TDEE), and coach-assigned meal plans with shareable public links (`/plan/[token]`).
- **Daily Metrics & Check-ins**: daily steps, body weight (`kg`/`lb` conversion, stored in `kg`), daily check-ins (energy, satiety, sleep 1–10 + notes), and weekly coach check-ins with progress photos.
- **Progress Photos**: browser-resized (1600px JPEG, max 200/account) stored in private S3/MinIO buckets and served via short-lived same-origin presigned URLs, with side-by-side comparison.
- **Coaching Suite**: public/invite-only training programs, enrollment workflow, client adherence analytics, workout feedback/reactions, weekly check-in reviews, and meal plans.
- **Offline-First PWA**: IndexedDB queue for workouts, steps, body weight, and daily check-ins with atomic, idempotent replay (`POST /api/v1/offline/sync`) and per-account queue isolation.
- **GDPR & Backups**: full JSON export/import, guaranteed S3-before-DB account/data erasure, and automatic encrypted Google Drive backups (`drive.appdata` scope, including progress photos).

## Local Development

Requires **Node.js 24+** (native `crypto.argon2` and built-in TypeScript test runner) and **Docker** (for local PostgreSQL + MinIO).

1. **Install dependencies**:
   ```bash
   npm install
   npm run build:shared
   ```
2. **Start local PostgreSQL 17 + MinIO**:
   ```bash
   docker compose -f docker-compose.dev.yml up -d
   ```
   *(If port `5432` or `9000` is already in use, override `DEV_POSTGRES_PORT` / `DEV_MINIO_PORT`.)*
3. **Configure API environment**:
   ```bash
   cp apps/api/.env.example apps/api/.env
   ```
   Fill in `JWT_ACCESS_SECRET` (or generate secrets with `node scripts/gen-secrets.mjs`).
4. **Run API and Web in separate terminals**:
   ```bash
   npm run dev:api   # http://localhost:4000/api/v1 (Swagger: http://localhost:4000/api/docs)
   npm run dev:web   # http://localhost:3000 (proxies /api/v1/* to API)
   ```

> Service workers / PWA caching are intentionally disabled in `npm run dev:web`. To test offline PWA behavior locally, run `npm run build` and start both apps in production mode.

## Testing & Verification

```bash
npm run typecheck                                   # TypeScript checks across shared, api, web
npm run test:shared                                 # Pure domain unit tests (packages/shared)
npm run test:web                                    # Web & offline unit tests (apps/web)
npm run test:api                                    # NestJS unit tests (apps/api)
npm run test:api:e2e                                # NestJS E2E integration tests (requires Postgres + MinIO)
node --test scripts/migrate-from-supabase.test.mjs  # Supabase migration script tests
npm run build                                       # Production build (shared + api + web with webpack PWA)
```

## Self-Hosting & Supabase Migration

RepLog deploys on a single VPS with 5 containers (`postgres`, `minio`, `api`, `web`, `caddy`) and automatic HTTPS.

- Full deployment, operations, backup, and Google Drive setup guide: **[docs/self-hosting.md](./docs/self-hosting.md)**
- Migrating an existing Supabase instance (users with `bcrypt` hashes, all 30 domain tables, and storage buckets): use `node scripts/migrate-from-supabase.ts --dry-run` (see `docs/self-hosting.md`).
