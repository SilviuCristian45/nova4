# Ghid Complet de Dezvoltare Locală (Dev Guide)

Acest ghid acoperă tot ce ai nevoie ca să configurezi, rulezi, testezi și depanezi RepLog pe mașina ta locală (Windows, macOS sau Linux).

---

## 1. Cerințe preliminare

- **Node.js 24+** (`node -v` → minim `v24.x` — necesar pentru `crypto.argon2` nativ și rularea directă a testelor TypeScript).
- **npm 10+** (vine cu Node 24; proiectul folosește **npm workspaces**).
- **Docker Desktop** (cu Docker Compose v2 — necesar pentru PostgreSQL 17, MinIO și Adminer).

Instalare inițială după `git clone`:

```bash
npm install
npm run build:shared
```

> **Important:** Ori de câte ori modifici fișiere din `packages/shared/src/`, rulează `npm run build:shared` astfel încât `packages/shared/dist` (consumat de `apps/api` și `apps/web`) să fie actualizat.

---

## 2. Două moduri de rulare locală

### Modul A — Dezvoltare zilnică cu Hot-Reload (recomandat când scrii cod)

Rulezi doar bazele de date/storage în Docker (`docker-compose.dev.yml`) și aplicațiile NestJS + Next.js nativ cu watch/HMR.

1. **Pornește Postgres 17 + MinIO + Adminer**:
   ```bash
   docker compose -f docker-compose.dev.yml up -d
   ```
   Dacă portul `5432`, `9000` sau `8081` este deja ocupat pe PC-ul tău, suprascrie-l din env (exemplu PowerShell):
   ```powershell
   $env:DEV_POSTGRES_PORT='5439'
   docker compose -f docker-compose.dev.yml up -d
   ```
2. **Creează `apps/api/.env`** (ignorat de git):
   ```bash
   cp apps/api/.env.example apps/api/.env
   ```
   Editează în `apps/api/.env`:
   - `DATABASE_URL` (ex: `postgres://postgres:postgres@localhost:5432/replog`, sau `:5439` dacă ai schimbat portul)
   - `JWT_ACCESS_SECRET` (un string random de minim 32 caractere — poți genera cu `node scripts/gen-secrets.mjs`)
   - Opțional: `USDA_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI=http://localhost:3000/api/v1/drive/callback`, `DRIVE_TOKEN_KEY`, `CRON_SECRET`.
3. **Pornește API-ul și Frontend-ul** în două terminale separate:
   ```bash
   npm run dev:api   # http://localhost:4000/api/v1 + Swagger la http://localhost:4000/api/docs
   npm run dev:web   # http://localhost:3000 (face proxy intern /api/v1/* -> localhost:4000)
   ```

**URL-uri în Modul A:**
- Web App: `http://localhost:3000`
- Swagger API Docs: `http://localhost:4000/api/docs`
- API Health: `http://localhost:4000/api/v1/health`
- Adminer (UI Postgres): `http://localhost:8081` (`PostgreSQL`, server `postgres`, user `postgres`, parolă `postgres`, db `replog`)
- MinIO Console: `http://localhost:9001` (`minioadmin` / `minioadmin`)

> În `npm run dev:web`, **Service Worker-ul / PWA este dezactivat intenționat** ca să nu îți cache-uiască codul vechi în timp ce dezvolți.

---

### Modul B — Stack complet în Docker local (identic cu producția + PWA + Caddy)

Folosește-l când vrei să testezi **PWA / Offline mode**, build-ul Docker, rutarea Caddy, presigned URL-urile MinIO same-origin sau pur și simplu să ridici tot proiectul cu o singură comandă.

```bash
npm run docker:local
```

Ce face `scripts/local-docker.mjs` automat:
1. Dacă `.env.docker.local` nu există, îl creează automat (ignorat de git) cu secrete criptografice persistente și preia automat `USDA_API_KEY` / Google Drive din `apps/api/.env` dacă există. (Poți consulta și template-ul [.env.docker.local.example](../.env.docker.local.example).)
2. Construiește și pornește toate cele 6 containere (`postgres`, `minio`, `api`, `web`, `caddy` + `adminer` pe profilul `tools`) și așteaptă să devină `healthy`.
3. Afișează toate URL-urile și parola Postgres generată pentru Adminer.

**Comenzi utile pentru Modul B:**

| Comandă | Ce face |
| --- | --- |
| `npm run docker:local` | Build + pornire stack complet pe `http://localhost` + Adminer pe `:8081` |
| `node scripts/local-docker.mjs up --no-build` | Repornire rapidă fără rebuild de imagini |
| `npm run docker:local:logs` | Log-uri live din containere (poți filtra: `node scripts/local-docker.mjs logs api web`) |
| `npm run docker:local:ps` | Statusul containerelor |
| `npm run docker:local:down` | Oprește containerele **păstrând volumele și datele** |
| `npm run docker:local:reset` | Oprește containerele și **șterge volumele locale (`-v`)** pentru un start curat |

> **Atenție:** Pe local, stack-ul folosește `http://localhost` (nu `https://localhost`) pentru a evita erorile de certificat self-signed în browser.

---

## 3. Fluxul de lucru cu baza de date și migrațiile TypeORM

- **Nu activa niciodată `synchronize: true`**. Schema evoluează strict prin fișiere de migrație în `apps/api/src/database/migrations/`.
- **Auto-run**: La pornirea `apps/api`, `TypeOrmModule` aplică automat migrațiile neaplicate (`TYPEORM_MIGRATIONS_RUN !== "false"`).
- **Comenzi manuale TypeORM** (necesită `DATABASE_URL` în `apps/api/.env` sau în mediul shell):
  ```bash
  npm run migration:show --workspace=@replog/api
  npm run migration:run --workspace=@replog/api
  npm run migration:revert --workspace=@replog/api
  ```
- **Inspecție DB rapidă**:
  - Prin UI: **Adminer** la `http://localhost:8081`.
  - Prin CLI (`psql`):
    ```bash
    # Modul A (dev compose)
    docker compose -f docker-compose.dev.yml exec postgres psql -U postgres -d replog

    # Modul B (full Docker local)
    docker exec -it replog-local-postgres-1 psql -U postgres -d replog
    ```
- **Golire rapidă a datelor de test** (păstrând schema):
  ```sql
  TRUNCATE TABLE public.users, public.foods RESTART IDENTITY CASCADE;
  ```

---

## 4. Testare, Typecheck, Lint și Build

Rulează aceste verificări înainte de orice commit / PR:

```bash
# 1. TypeScript check pe toate cele 3 workspace-uri (shared, api, web)
npm run typecheck

# 2. Teste unitare pure (packages/shared — ~141 teste)
npm run test:shared

# 3. Teste unitare frontend & offline (apps/web — ~42 teste)
npm run test:web

# 4. Teste unitare NestJS (apps/api — jest)
npm run test:api

# 5. Teste script migrare Supabase
node --test scripts/migrate-from-supabase.test.mjs

# 6. Teste E2E NestJS pe Postgres + MinIO reale (phase1, phase2, phase3)
#    (Asigură-te că postgres + minio rulează și setează DATABASE_URL + S3_*)
npm run test:api:e2e

# 7. ESLint pe fișierele modificate
npx eslint apps/web/app/cale/fisier.tsx

# 8. Build complet de producție (shared + api + web cu webpack PWA)
npm run build
```

### Exemplu rulare E2E pe un Postgres izolat (fără să strici datele tale de dev!)

> **ATENȚIE:** Suita `test:api:e2e` execută `TRUNCATE TABLE public.users, public.foods CASCADE` înainte de fiecare test! Nu o rula **niciodată** pe o bază cu date pe care vrei să le păstrezi!

```powershell
# Pornește un stack efemer separat pe portul 5440
$env:DEV_POSTGRES_PORT='5440'; $env:DEV_MINIO_PORT='9010'; $env:DEV_MINIO_CONSOLE_PORT='9011'
docker compose -p replog-e2e -f docker-compose.dev.yml up -d --wait

$env:DATABASE_URL='postgres://postgres:postgres@localhost:5440/replog'
$env:S3_ENDPOINT='http://localhost:9010'
$env:S3_PUBLIC_ENDPOINT='http://localhost:9010'
$env:S3_ACCESS_KEY_ID='minioadmin'
$env:S3_SECRET_ACCESS_KEY='minioadmin'
$env:S3_FORCE_PATH_STYLE='true'
npm run test:api:e2e

# Curăță stack-ul efemer
docker compose -p replog-e2e -f docker-compose.dev.yml down -v
```
