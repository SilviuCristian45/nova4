# Documentație RepLog (`nova4`)

Acest folder conține documentația tehnică completă a proiectului **RepLog** (monorepo NestJS 11 + TypeORM + PostgreSQL 17 + MinIO + Next.js 16 + Caddy), scrisă astfel încât orice dezvoltator să poată înțelege, rula, depana, extinde și opera aplicația în producție **independent, fără asistență AI**.

## Hartă de navigare

| Document | Când îl citești | Conținut principal |
| --- | --- | --- |
| **[architecture.md](./architecture.md)** | Primul document la onboarding sau înainte de o decizie de design | Diagramă sistem, structura monorepo, flux Auth (JWT + refresh rotativ), RBAC/Guards, modelul celor 32 de tabele, Storage S3/MinIO (AWS SigV4), Offline PWA, Design System & i18n |
| **[development.md](./development.md)** | Setup pe un PC nou, rulare zilnică, teste, migrații DB | Setup local în 2 moduri (Hot-Reload dev vs. Full Docker local cu Adminer), variabile de mediu, comenzi de testare (`shared`/`web`/`api`/E2E), flux TypeORM migrations, testare PWA |
| **[feature-development.md](./feature-development.md)** | De fiecare dată când implementezi un feature nou sau modifici schema | Playbook pas-cu-pas cap-coadă (`shared` → entitate & migrație → NestJS → GDPR checklist → Next.js SSR/Client → Offline → Teste), reguli obligatorii și Definition of Done |
| **[self-hosting.md](./self-hosting.md)** | Deploy pe VPS, backup & restore, operare producție, migrare Supabase | Stack-ul de producție (5 servicii + Caddy HTTPS), configurare `.env`, backup/restore Postgres + MinIO, acces sigur la Adminer prin SSH tunnel, checklist de producție, script migrare Supabase |
| **[troubleshooting.md](./troubleshooting.md)** | Când apare o eroare în dev, build, Docker, migrare sau producție | Catalog de probleme reale întâlnite în proiect și soluțiile exacte (Node 24 Argon2, workspaces Docker, MinIO SigV4, cookies/CORS, IPv6 Supabase, Tailwind 4, PWA/SW, Google Drive) |

## Documente auxiliare / istorice

- **[../README.md](../README.md)** — prezentare generală și quick-start pentru repository.
- **[nestjs-migration-plan.md](./nestjs-migration-plan.md)** — planul istoric al migrării din Supabase în NestJS (Fazele 0–5, finalizate).
- **[idei/poze-criptate-e2ee.md](./idei/poze-criptate-e2ee.md)** — analiză de design amânată pentru criptare E2E a pozelor de progres.
- **[idei/gym-management-qr-checkins.md](./idei/gym-management-qr-checkins.md)** — specificație & arhitectură pentru management sală de fitness, QR check-in (poster printat + live feed SSE + alertă sonoră) și abonamente.
- **[../AGENTS.md](../AGENTS.md)** & **[../CLAUDE.md](../CLAUDE.md)** — ghiduri concise de reguli și invarianți de domeniu.
