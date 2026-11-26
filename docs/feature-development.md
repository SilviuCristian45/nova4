# Ghid Pas-cu-Pas: Cum Implementăm Feature-uri Noi

Acest document este un **playbook practic** pe care să-l urmezi de fiecare dată când adaugi o funcționalitate nouă în RepLog (de ex. măsurători corporale, rutine salvate, export PDF nou, integrare mobilă etc.), ca să păstrezi arhitectura curată și să nu rupi niciun invariant (securitate, GDPR, offline, unități, design system).

---

## 1. Unde trăiește codul? (Regula celor 3 straturi)

Înainte să scrii prima linie de cod, împarte feature-ul pe straturi:

| Strat | Director | Ce pui aici | Ce NU pui aici |
| --- | --- | --- | --- |
| **1. Domeniu pur** | `packages/shared/src/` | Calcule matematice, validări de limite/constante, tipuri comune, formatări, parsere, teste unitare `*.test.mjs` | Zero importuri din `next/*`, `@nestjs/*`, `typeorm`, `pg`, `fs` sau DOM |
| **2. Backend API** | `apps/api/src/` | Entități TypeORM, migrații SQL, DTO-uri (`class-validator`), servicii tranzacționale, autorizare (Guards), S3/MinIO, cron-uri, teste unitare + E2E | Zero cod de randare HTML/React |
| **3. Frontend UI & PWA** | `apps/web/` | Pagini App Router, Server Actions, componente React (`components/ui/*`), apeluri HTTP prin `lib/api/{server,client}.ts`, IndexedDB offline | Zero SQL, zero credențiale S3/DB, zero secrete (`CRON_SECRET`, `DRIVE_TOKEN_KEY`) |

---

## 2. Rețeta completă (de la DB la UI)

Să presupunem că adaugi un feature nou numit **`body-measurements`** (măsurători corporale: talie, piept, braț per dată). Urmează pașii în exact această ordine:

### Pasul 1 — Logică pură & constante în `packages/shared`

1. Creează `packages/shared/src/body-measurements.ts` cu:
   - Constante de validare (ex: `MEASUREMENT_MIN_CM = 10`, `MEASUREMENT_MAX_CM = 300`, `MEASUREMENT_NOTE_MAX = 280`) — **aceleași constante vor fi folosite de DB, NestJS DTO și formularul Web**.
   - Funcții pure de validare / calcul / conversie.
2. Exportă modulul în `packages/shared/src/index.ts`.
3. Scrie teste unitare în `packages/shared/src/body-measurements.test.mjs`.
4. Compilează și testează imediat:
   ```bash
   npm run build:shared
   npm run test:shared
   ```

---

### Pasul 2 — Schema PostgreSQL (Entitate + Migrație TypeORM)

1. **Creează entitatea** în `apps/api/src/database/entities/body-measurement.entity.ts`:
   - `userId` (`uuid`, FK către `public.users(id)` cu `onDelete: "CASCADE"`).
   - Mapare explicită `snake_case` în DB (`@Column({ name: "waist_cm", ... })`) și `camelCase` în TypeScript.
   - Re-exportă în `apps/api/src/database/entities/index.ts`.
2. **Creează migrația** în `apps/api/src/database/migrations/<timestamp>-AddBodyMeasurements.ts`:
   - Folosește timestamp UNIX ms real (ex: `Date.now()` → `1765000000000-AddBodyMeasurements.ts`).
   - Implementează atât `up(queryRunner)` cât și `down(queryRunner)`.
   - Pune explicit constrângeri `CHECK` identice cu constantele din `packages/shared`, indecși pentru query-urile frecvente (ex: `(user_id, measured_on desc)`) și FK `references public.users(id) on delete cascade`.
3. **Înregistrează** entitatea și migrația în `apps/api/src/database/data-source.ts`:
   - Adaugă entitatea în `DATABASE_ENTITIES`.
   - Adaugă clasa migrației la finalul `DATABASE_MIGRATIONS`.
4. **Verifică migrația** pe baza locală:
   ```bash
   npm run migration:run --workspace=@replog/api
   npm run migration:show --workspace=@replog/api
   ```

---

### Pasul 3 — Modulul NestJS (`apps/api/src/modules/<feature>/`)

Structura standard a unui modul:

```text
apps/api/src/modules/body-measurements/
├── dto/
│   └── body-measurement.dto.ts
├── body-measurements.controller.ts
├── body-measurements.service.ts
└── body-measurements.module.ts
```

**Reguli obligatorii în NestJS:**
- **DTO-uri stricte**: `ValidationPipe` global are `whitelist: true` și `forbidNonWhitelisted: true`. Orice câmp fără decorator `class-validator` va fi respins cu `400 Bad Request`. Adaugă și `@ApiProperty` / `@ApiPropertyOptional` ca Swagger (`/api/docs`) să rămână la zi.
- **Autentificare & Autorizare**:
  - Nu trebuie să adaugi `@UseGuards(JwtAuthGuard)` — e deja global.
  - Ia identitatea exclusiv prin `@CurrentUser() user: AuthenticatedUser` (`user.userId`). **Niciodată** nu accepta `userId` din body/query pentru acțiuni ale utilizatorului curent.
  - Pentru rute de antrenor: adaugă `@UseGuards(CoachGuard)`.
  - Pentru rute în care antrenorul citește datele unui client: adaugă `@UseGuards(CoachGuard, ActiveCoachAccessGuard)` + `@CoachAccess()` (sau `@CoachAccess({ requireNutrition: true })`).
  - Pentru rute publice (fără login): marchează explicit cu `@Public()` și asigură-te că nu expui PII.
- **Tranzacții**: orice operație multi-tabel (ex: insert părinte + copii + notificare) se rulează în `this.dataSource.transaction(async (manager) => { ... })`.
- **Înregistrare**: importă `BodyMeasurementsModule` în `apps/api/src/app.module.ts`.

---

### Pasul 4 — Checklist GDPR & Invarianți (OBLIGATORIU pentru orice tabel nou cu date de utilizator)

Nu trece la frontend până nu bifezi **toate** punctele de mai jos:

- [ ] **FK cascade**: tabelul are FK către `public.users(id)` cu `ON DELETE CASCADE`.
- [ ] **Export JSON (`replog-export` v1)**: adaugă tabelul în `AccountService.buildExport()` (`apps/api/src/modules/account/account.service.ts`) — **nu exporta niciodată secrete, parole sau token-uri**.
- [ ] **Import JSON**: adaugă suportul de import în `AccountService.importData()` (și validare în `packages/shared/src/account-export.ts`).
- [ ] **Ștergere date**: adaugă ștergerea în `AccountService.deleteAllData()` (în ordine corectă față de FK-uri).
- [ ] **Dacă feature-ul stochează fișiere în S3/MinIO**: adaugă `StorageService.deleteUserPrefix()` în `AccountService.purgeUserStorageOrAbort()` **înainte** de ștergerea din Postgres (cu abort la eșec S3).
- [ ] **Verificare schemă E2E**: adaugă numele tabelului în `EXPECTED_TABLES` (ordine alfabetică!) din `apps/api/test/phase1.e2e-spec.ts`.
- [ ] **Migrare Supabase** (dacă tabelul a existat și în vechea bază): adaugă-l în `MIGRATION_TABLES` din `scripts/migrate-from-supabase.ts` în poziția corectă FK.

---

### Pasul 5 — Frontend Next.js (`apps/web`)

1. **Tipuri API**: definește tipurile de request/response în `apps/web/lib/api/types.ts`.
2. **Citire date (SSR — Server Components)**:
   - Folosește `serverApi<T>("/body-measurements")` din `apps/web/lib/api/server.ts`.
   - `serverApi` forwardează cookie-urile de sesiune către `INTERNAL_API_URL/api/v1` și reîmprospătează automat access token-ul expirat.
3. **Scriere date (Mutations)**:
   - Din formulare / pagini server: creează un **Server Action** (`"use server"`) care apelează `serverApi("/body-measurements", { method: "POST", body: ... })`, apoi apelează `revalidatePath("/...")`.
   - Din componente interactive client (grafice live, upload poze, polling): folosește `clientApi<T>("/body-measurements", ...)` din `apps/web/lib/api/client.ts` (apelează same-origin `/api/v1/...`, face auto-refresh pe `401`).
   - Protejează butoanele de submit contra double-click cu `apps/web/lib/submit-guard.ts`.
4. **Rutare & Access Control**:
   - Dacă pagina nouă e **publică** (accesibilă fără login), adaug-o în `PUBLIC_EXACT` sau în excepțiile din `apps/web/proxy.ts`.
   - Dacă e doar pentru **coach**, pune-o sub `/coach/...` (protejată automat de `isCoachRoute(path)` în `proxy.ts`).
5. **Texte bilingve (`ro` / `en`)**:
   - Server: `const { t } = await getLanguage()` (`apps/web/app/language.ts`).
   - Client: `const { t } = useLanguage()` sau `<Text ro="..." en="..." />`.
   - **Zero string-uri hardcoded într-o singură limbă** în UI.
6. **Unități de greutate** (dacă feature-ul conține greutăți):
   - Trimite și stochează mereu în **kg**; afișează/parsează exclusiv prin `useUnits()` (client) sau `getWeightUnit()` / `getWeightFormatter()` (server).
7. **Design System (Tailwind 4)**:
   - Folosește primitivele din `apps/web/app/components/ui/` (`Screen`, `Columns`, `Stack`, `Card`, `Inner`, `Button`, `Input`, `Select`, `Segmented`, `Badge`, `Message`, `Empty`).
   - Folosește doar tokenii definiți în `apps/web/app/globals.css` (`lime` = acțiune primară; `coral`/`ice`/`lilac`/`gold`/`red` = date; `bg-background`/`bg-card`/`bg-inner`/`bg-control` = suprafețe).
   - **Nu suprascrie** padding-ul sau fundalul unei primitive prin `className` — adaugă un prop explicit în primitivă.

---

### Pasul 6 — Suport Offline (opțional, doar pentru feature-uri de logare zilnică)

Dacă feature-ul trebuie să funcționeze și fără internet (cum merg antrenamentele, pașii, greutatea și check-in-ul):

1. Extinde tipul de mutație și validarea în `packages/shared/src/offline/model.ts` (limite identice cu DB și NestJS DTO!).
2. Adaugă handling-ul în `OfflineService.syncMutation()` (`apps/api/src/modules/offline/offline.service.ts`) — obligatoriu idempotent prin `offline_sync_receipts`.
3. Actualizează IndexedDB snapshot + queue replay în `apps/web/lib/offline/`.
4. Expune funcționalitatea și pe pagina dedicată `/offline` (`apps/web/app/offline/`), pentru că fără rețea navigarea cade pe `/offline`.
5. Adaugă teste în `apps/web/lib/offline.test.mjs` pentru izolare pe cont (`ownerId`) și retry după eroare de rețea.

---

## 3. Definition of Done (Checklist final înainte de commit/PR)

- [ ] `npm run build:shared` rulat după orice modificare din `packages/shared`
- [ ] `npm run typecheck` — **0 erori** pe `shared`, `api`, `web`
- [ ] `npm run test:shared` — toate testele verzi
- [ ] `npm run test:web` — toate testele verzi
- [ ] `npm run test:api` — toate testele verzi
- [ ] Test E2E nou în `apps/api/test/` care verifică **cel puțin**: happy path + validare 400 + **izolare User A nu poate citi/modifica/șterge datele lui User B** (`403`/`404`) + GDPR delete
- [ ] `npx eslint <fisiere-atinse>` — 0 erori noi introduse
- [ ] `npm run build` — build de producție verde (`shared` + `api` + `web` webpack PWA)
- [ ] Verificat în browser în ambele limbi (`RO` și `EN`), pe mobile + desktop, light + dark mode
- [ ] Documentația actualizată dacă s-au adăugat env vars noi (`.env.example`, `apps/api/.env.example`, `.env.docker.local.example`, `docker-compose.yml`, `docs/self-hosting.md`)
