# Self-hosting RepLog on a VPS

One `docker-compose.yml` starts the entire self-hosted stack in **5 services**, with zero Supabase dependencies:

| Service | What it is |
| --- | --- |
| `postgres` | PostgreSQL 17 (`postgres:17-alpine`) storing all RepLog data (`replog` database) |
| `minio` | S3-compatible object storage for private `progress-photos` and `checkin-photos` buckets |
| `api` | RepLog NestJS 11 + TypeORM REST API (auto-runs TypeORM migrations, auto-creates MinIO buckets, and runs the hourly Google Drive backup cron natively via `@nestjs/schedule`) |
| `web` | RepLog Next.js standalone PWA frontend |
| `caddy` | The only public entry point (ports `80`/`443`), automatic HTTPS via Let's Encrypt |

Caddy serves everything on one public domain (`https://DOMAIN`):

- `/api/v1/*` and `/api/docs*` → `api:4000`
- `/progress-photos/*` and `/checkin-photos/*` → `minio:9000` (exact path and `Host` preserved so AWS SigV4 presigned URLs work same-origin with no extra CORS setup)
- `/*` → `web:3000`

No separate API subdomain, no Supabase containers, and no external cron container.

## Deploy

1. **VPS**: Docker + Docker Compose v2, DNS `A` record for `DOMAIN` pointing to the VPS, ports `80` and `443` open.
2. **Secrets and config**:
   ```bash
   git clone <repo> && cd nova4
   node scripts/gen-secrets.mjs      # prints POSTGRES_PASSWORD, JWT_ACCESS_SECRET, MINIO_ROOT_USER, MINIO_ROOT_PASSWORD, DRIVE_TOKEN_KEY, CRON_SECRET
   cp .env.example .env              # paste them in and set DOMAIN
   ```
   `POSTGRES_PASSWORD` and `MINIO_ROOT_*` are initialized into the `postgres_data` / `minio_data` volumes on first start — do not change them after initial bootstrap.
3. **Start**:
   ```bash
   docker compose up -d --build
   ```
   On first boot, `api` automatically applies pending TypeORM migrations (`TYPEORM_MIGRATIONS_RUN=true`) and creates the private `progress-photos` and `checkin-photos` buckets in MinIO (`S3_AUTO_CREATE_BUCKETS=true`).
   Verify everything is healthy with `docker compose ps` and open `https://DOMAIN`.
4. **Create your account** on `/register`. If nobody else should be able to sign up afterwards, set `DISABLE_SIGNUP=true` in `.env` and run `docker compose up -d api`.
5. **Optional features**:
   - **Google Drive automatic backup**: set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI=https://<DOMAIN>/api/v1/drive/callback` (add the exact same URI in Google Cloud Console), `DRIVE_TOKEN_KEY`, and `CRON_SECRET`. The hourly scheduler runs inside `api` automatically when `DRIVE_CRON_ENABLED=true`.
   - **USDA food search fallback**: set `USDA_API_KEY`.
   - **Coach self-serve**: set `COACH_SELF_SERVE=false` to disable self-serve coach role activation on `/register` and `/settings`.
   - **Super Admin dashboard (`/admin`)**: set `SUPER_ADMIN_EMAILS=you@example.com` (comma-separated allowlist). Only listed accounts see the **Admin** button and can access `/admin` / `/api/v1/admin/*` to create, edit, disable/enable, reset passwords, or delete accounts. Leave empty to keep `/admin` completely closed.
   - **OpenAPI / Swagger UI**: set `SWAGGER_ENABLED=true` to expose `https://<DOMAIN>/api/docs` (disabled by default in production).

## Operations

| Task | Command |
| --- | --- |
| Logs | `docker compose logs -f api web` (or `postgres`, `minio`, `caddy`) |
| Update | `git pull && docker compose up -d --build` (new TypeORM migrations run automatically on `api` startup) |
| Status | `docker compose ps` |
| SQL console | `docker compose exec postgres psql -U postgres -d replog` |
| Applied migrations | `docker compose exec postgres psql -U postgres -d replog -c "select * from migrations;"` |
| API health | `docker compose exec api wget -qO- http://127.0.0.1:4000/api/v1/health` |

Unlike the legacy Supabase setup, `DOMAIN` is **not** baked into the Next.js bundle — changing `DOMAIN` only requires updating `.env` and running `docker compose up -d`.

### Backups

All persistent state lives in two Docker volumes (`postgres_data` and `minio_data`):

```bash
docker compose exec -T postgres pg_dump -U postgres -Fc replog > replog-$(date +%F).dump
docker run --rm -v <project>_minio_data:/data -v "$PWD":/out alpine tar czf /out/minio-$(date +%F).tgz -C /data .
```

Find the exact volume name with `docker volume ls`. In-app JSON export and Google Drive backups remain per-user safety nets on top of full volume backups.

### Restore from backup

1. Stop `api` and `web` so nothing writes during restore:
   ```bash
   docker compose stop api web
   ```
2. Restore PostgreSQL dump:
   ```bash
   docker compose exec -T postgres pg_restore -U postgres -d replog --clean --if-exists < replog-YYYY-MM-DD.dump
   ```
3. Restore MinIO data volume (if needed):
   ```bash
   docker compose stop minio
   docker run --rm -v <project>_minio_data:/data -v "$PWD":/in alpine sh -c "rm -rf /data/* && tar xzf /in/minio-YYYY-MM-DD.tgz -C /data"
   ```
4. Start the stack again and verify health:
   ```bash
   docker compose up -d
   docker compose ps
   ```

### Accessing Adminer safely on a production VPS

`adminer` is defined under `profiles: ["tools"]` and bound strictly to `127.0.0.1:8081` — it does **not** start during a normal `docker compose up -d` and is never exposed to the public internet.

If you ever need a temporary DB GUI on the VPS:
1. Start it on the VPS: `docker compose --profile tools up -d adminer`
2. Open an SSH tunnel from your local machine: `ssh -L 8081:127.0.0.1:8081 user@your-vps`
3. Open `http://localhost:8081` locally (`PostgreSQL`, server `postgres`, user `postgres`, db `replog`, password from `.env`).
4. Stop it when finished: `docker compose --profile tools stop adminer && docker compose --profile tools rm -f adminer`

### Production Pre-Deploy Checklist

- [ ] DNS `A` record for `DOMAIN` points to the VPS; firewall allows only `22` (SSH), `80` (HTTP), `443` (HTTPS).
- [ ] `.env` permissions restricted (`chmod 600 .env`) and never committed to git.
- [ ] `PUBLIC_SCHEME=https`, `COOKIE_SECURE=true`, `SWAGGER_ENABLED=false` (unless you intentionally expose `/api/docs`).
- [ ] `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` generated with `node scripts/gen-secrets.mjs`.
- [ ] After creating your own account, set `DISABLE_SIGNUP=true` if this is a private instance (`docker compose up -d api`).
- [ ] Automated off-site cron backup configured on the host for `pg_dump` + `minio_data`.
- [ ] If using Google Drive backups: OAuth consent screen published **In production** and redirect URI set to `https://<DOMAIN>/api/v1/drive/callback`.

## Migrating existing data from Supabase

### Option A — Full database + storage migration (`scripts/migrate-from-supabase.ts`)

Use the built-in idempotent migration script to move all users, password hashes, domain data (30 tables in FK order), and photos from hosted or self-hosted Supabase into the new Postgres + MinIO stack.

Existing Supabase `bcrypt` (`$2a$`/`$2b$`) hashes are preserved in `public.users.password_hash`; RepLog's `PasswordService` transparently verifies them and upgrades each hash on the user's next login.

1. Start the new stack once (or run `npm run migration:run --workspace=@replog/api`) so the target PostgreSQL schema is initialized.
2. Run a **dry run** first to verify connectivity and counts:
   ```bash
   SOURCE_DATABASE_URL="postgres://postgres:<supabase-db-pass>@<supabase-host>:5432/postgres" \
   TARGET_DATABASE_URL="postgres://postgres:<new-pass>@localhost:5432/replog" \
   S3_ENDPOINT="http://localhost:9000" \
   S3_ACCESS_KEY_ID="<MINIO_ROOT_USER>" \
   S3_SECRET_ACCESS_KEY="<MINIO_ROOT_PASSWORD>" \
   SUPABASE_URL="https://<project>.supabase.co" \
   SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
   node scripts/migrate-from-supabase.ts --dry-run
   ```
3. Run the actual migration (safe to re-run — uses `ON CONFLICT DO NOTHING` in Postgres and skips objects already present in MinIO):
   ```bash
   node scripts/migrate-from-supabase.ts
   ```

Useful flags & modes:
- `--skip-storage`: migrate PostgreSQL data only.
- `--skip-db`: migrate `progress-photos` and `checkin-photos` objects only.
- `--batch-size=500` / `--concurrency=5`: tune insert batch size and parallel S3 uploads.
- **Self-hosted Supabase file backend**: instead of `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, you can point `SUPABASE_STORAGE_DIR` to an extracted copy of the old `storage_data` volume.

### Option B — Per-user JSON export / import

For single-user migrations, you can also use **Settings → Your data → Download** on the old instance, register on the new instance, and import the JSON file (and restore progress photos from Google Drive backup if enabled).
