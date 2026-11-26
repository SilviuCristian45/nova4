#!/usr/bin/env node
/**
 * One-shot idempotent migration from Supabase (hosted or self-hosted) to RepLog's
 * standalone PostgreSQL + MinIO/S3 stack.
 *
 * Run with Node 22.18+ / Node 24 directly:
 *   node scripts/migrate-from-supabase.ts [--dry-run] [--skip-db] [--skip-storage] [--batch-size=500]
 *
 * Required environment variables (unless --skip-db):
 *   SOURCE_DATABASE_URL      Supabase Postgres connection URI (with read access to auth.users & public.*)
 *   TARGET_DATABASE_URL      RepLog Postgres connection URI (after TypeORM migrations have been applied)
 *
 * Storage migration environment variables (unless --skip-storage):
 *   S3_ENDPOINT              Target S3/MinIO endpoint (e.g. http://localhost:9000)
 *   S3_ACCESS_KEY_ID         Target S3/MinIO access key (MINIO_ROOT_USER)
 *   S3_SECRET_ACCESS_KEY     Target S3/MinIO secret key (MINIO_ROOT_PASSWORD)
 *   S3_REGION                Optional, defaults to us-east-1
 *   S3_FORCE_PATH_STYLE      Optional, defaults to true
 *   S3_BUCKET_PROGRESS_PHOTOS Optional, defaults to progress-photos
 *   S3_BUCKET_CHECKIN_PHOTOS  Optional, defaults to checkin-photos
 *
 *   And ONE of the following storage sources:
 *     A) HTTP API (hosted or self-hosted Supabase):
 *          SUPABASE_URL               e.g. https://xxxx.supabase.co
 *          SUPABASE_SERVICE_ROLE_KEY  service_role key
 *     B) Local file backend directory (extracted from self-hosted Supabase storage_data volume):
 *          SUPABASE_STORAGE_DIR       path containing bucket files
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import pg from "pg";

const { Client } = pg;

/**
 * All domain tables in strict topological FK order (parents before children).
 * `public.users` is migrated first from `auth.users`.
 * `public.refresh_tokens` is NestJS-only and intentionally omitted.
 */
export const MIGRATION_TABLES: readonly string[] = [
  "profiles",
  "coach_profiles",
  "programs",
  "program_workouts",
  "program_workout_exercises",
  "program_workout_cardio",
  "enrollments",
  "coach_client_notes",
  "workouts",
  "workout_sets",
  "cardio_sessions",
  "workout_drafts",
  "workout_feedback",
  "foods",
  "meals",
  "meal_items",
  "meal_templates",
  "user_targets",
  "meal_plans",
  "meal_plan_days",
  "meal_plan_meals",
  "meal_plan_items",
  "daily_steps",
  "daily_weight",
  "daily_checkin",
  "progress_photos",
  "weekly_checkins",
  "notifications",
  "offline_sync_receipts",
  "google_drive_backups",
] as const;

export interface CliOptions {
  dryRun: boolean;
  skipDb: boolean;
  skipStorage: boolean;
  batchSize: number;
  concurrency: number;
  help: boolean;
}

export interface ColumnMeta {
  name: string;
  dataType: string;
}

export interface MappedUserRow {
  id: string;
  email: string;
  password_hash: string;
  email_verified_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface TableMigrationStats {
  table: string;
  sourceRows: number;
  inserted: number;
  skipped: number;
  failed: number;
  missingInSource?: boolean;
}

export interface StorageMigrationStats {
  bucket: string;
  totalKeys: number;
  uploaded: number;
  skipped: number;
  missingInSource: number;
  failed: number;
}

export function parseCliArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    skipDb: false,
    skipStorage: false,
    batchSize: 500,
    concurrency: 5,
    help: false,
  };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--skip-db") {
      options.skipDb = true;
    } else if (arg === "--skip-storage") {
      options.skipStorage = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg.startsWith("--batch-size=")) {
      const value = Number(arg.slice("--batch-size=".length));
      if (!Number.isInteger(value) || value < 1 || value > 5000) {
        throw new Error(`Invalid --batch-size value: "${arg}" (expected integer 1..5000)`);
      }
      options.batchSize = value;
    } else if (arg.startsWith("--concurrency=")) {
      const value = Number(arg.slice("--concurrency=".length));
      if (!Number.isInteger(value) || value < 1 || value > 32) {
        throw new Error(`Invalid --concurrency value: "${arg}" (expected integer 1..32)`);
      }
      options.concurrency = value;
    } else {
      throw new Error(`Unknown CLI argument: "${arg}"`);
    }
  }

  return options;
}

export function quoteIdent(identifier: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: "${identifier}"`);
  }
  return `"${identifier}"`;
}

export function intersectColumns(
  sourceColumns: readonly ColumnMeta[],
  targetColumns: readonly ColumnMeta[],
): ColumnMeta[] {
  const sourceNames = new Set(sourceColumns.map((col) => col.name));
  return targetColumns.filter((col) => sourceNames.has(col.name));
}

export function serializeValueForColumn(value: unknown, dataType: string): unknown {
  if (value === null || value === undefined) return null;
  const lower = dataType.toLowerCase();
  if (lower === "json" || lower === "jsonb") {
    return typeof value === "string" ? value : JSON.stringify(value);
  }
  return value;
}

export function buildBatchInsertSql(
  table: string,
  columns: readonly ColumnMeta[],
  rows: readonly Record<string, unknown>[],
): { text: string; values: unknown[] } {
  if (columns.length === 0) {
    throw new Error(`Cannot build insert for "${table}" with zero columns`);
  }
  if (rows.length === 0) {
    throw new Error(`Cannot build insert for "${table}" with zero rows`);
  }

  const colList = columns.map((col) => quoteIdent(col.name)).join(", ");
  const values: unknown[] = [];
  const rowPlaceholders: string[] = [];

  for (const row of rows) {
    const placeholders: string[] = [];
    for (const col of columns) {
      values.push(serializeValueForColumn(row[col.name], col.dataType));
      placeholders.push(`$${values.length}`);
    }
    rowPlaceholders.push(`(${placeholders.join(", ")})`);
  }

  const text = `INSERT INTO public.${quoteIdent(table)} (${colList}) VALUES ${rowPlaceholders.join(", ")} ON CONFLICT DO NOTHING`;
  return { text, values };
}

export function mapAuthUserRow(row: Record<string, unknown>): MappedUserRow | null {
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const emailRaw = typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
  const encryptedPassword =
    typeof row.encrypted_password === "string" ? row.encrypted_password.trim() : "";

  if (!id || !emailRaw || !encryptedPassword) {
    return null;
  }

  const now = new Date();
  const createdAt = (row.created_at as Date | string | null) ?? now;
  const updatedAt = (row.updated_at as Date | string | null) ?? createdAt;
  const emailVerifiedAt = (row.email_confirmed_at as Date | string | null) ?? null;

  return {
    id,
    email: emailRaw,
    password_hash: encryptedPassword,
    email_verified_at: emailVerifiedAt,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

export function encodeStorageObjectPath(objectPath: string): string {
  return objectPath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function collectCheckinPhotoPaths(
  rows: readonly {
    photo_front_path?: string | null;
    photo_back_path?: string | null;
    photo_side_path?: string | null;
  }[],
): string[] {
  const keys = new Set<string>();
  for (const row of rows) {
    if (row.photo_front_path) keys.add(row.photo_front_path);
    if (row.photo_back_path) keys.add(row.photo_back_path);
    if (row.photo_side_path) keys.add(row.photo_side_path);
  }
  return [...keys];
}

export function resolveLocalStorageFile(
  storageDir: string,
  bucket: string,
  objectKey: string,
): string | null {
  const candidates = [
    path.join(storageDir, "stub", "stub", bucket, objectKey),
    path.join(storageDir, "stub", bucket, objectKey),
    path.join(storageDir, bucket, objectKey),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function printUsage(): void {
  console.log(`Usage: node scripts/migrate-from-supabase.ts [options]

Options:
  --dry-run             Inspect source/target and count rows/objects without writing anything
  --skip-db             Skip PostgreSQL data migration (run storage migration only)
  --skip-storage        Skip S3/MinIO storage migration (run database migration only)
  --batch-size=<N>      Rows per batch insert (default: 500, range: 1..5000)
  --concurrency=<N>     Concurrent storage transfers (default: 5, range: 1..32)
  -h, --help            Show this help message

Environment variables:
  SOURCE_DATABASE_URL       Supabase PostgreSQL URI
  TARGET_DATABASE_URL       RepLog PostgreSQL URI
  S3_ENDPOINT               Target S3/MinIO endpoint (e.g. http://localhost:9000)
  S3_ACCESS_KEY_ID          Target S3/MinIO access key
  S3_SECRET_ACCESS_KEY      Target S3/MinIO secret key
  S3_REGION                 Optional (default: us-east-1)
  S3_FORCE_PATH_STYLE       Optional (default: true)
  SUPABASE_URL              Source Supabase base URL (HTTP storage source)
  SUPABASE_SERVICE_ROLE_KEY Source Supabase service_role key (HTTP storage source)
  SUPABASE_STORAGE_DIR      Alternative local directory from self-hosted Supabase storage volume`);
}

async function getTableColumns(
  client: pg.Client,
  schema: string,
  table: string,
): Promise<ColumnMeta[]> {
  const res = await client.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position ASC`,
    [schema, table],
  );
  return res.rows.map((r) => ({ name: r.column_name, dataType: r.data_type }));
}

async function migrateUsers(
  source: pg.Client,
  target: pg.Client,
  options: CliOptions,
): Promise<TableMigrationStats> {
  const stats: TableMigrationStats = {
    table: "users",
    sourceRows: 0,
    inserted: 0,
    skipped: 0,
    failed: 0,
  };

  const authColumns = await getTableColumns(source, "auth", "users");
  if (authColumns.length === 0) {
    throw new Error("Source database does not have auth.users table (or insufficient privileges)");
  }

  const hasDeletedAt = authColumns.some((c) => c.name === "deleted_at");
  const whereClause = hasDeletedAt ? "WHERE deleted_at IS NULL" : "";
  const query = `
    SELECT id, email, encrypted_password, email_confirmed_at, created_at, updated_at
      FROM auth.users
      ${whereClause}
     ORDER BY created_at ASC
  `;

  const res = await source.query<Record<string, unknown>>(query);
  stats.sourceRows = res.rows.length;

  const mapped: MappedUserRow[] = [];
  for (const row of res.rows) {
    const user = mapAuthUserRow(row);
    if (!user) {
      stats.skipped++;
      continue;
    }
    mapped.push(user);
  }

  if (options.dryRun || mapped.length === 0) {
    return stats;
  }

  const userColumns: ColumnMeta[] = [
    { name: "id", dataType: "uuid" },
    { name: "email", dataType: "text" },
    { name: "password_hash", dataType: "text" },
    { name: "email_verified_at", dataType: "timestamp with time zone" },
    { name: "created_at", dataType: "timestamp with time zone" },
    { name: "updated_at", dataType: "timestamp with time zone" },
  ];

  const { inserted, skipped, failed } = await insertBatches(
    target,
    "users",
    userColumns,
    mapped as unknown as Record<string, unknown>[],
    options.batchSize,
  );
  stats.inserted += inserted;
  stats.skipped += skipped;
  stats.failed += failed;
  return stats;
}

async function insertBatches(
  target: pg.Client,
  table: string,
  columns: readonly ColumnMeta[],
  rows: readonly Record<string, unknown>[],
  batchSize: number,
): Promise<{ inserted: number; skipped: number; failed: number }> {
  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  const maxRowsPerQuery = Math.max(1, Math.min(batchSize, Math.floor(60_000 / Math.max(1, columns.length))));

  for (let i = 0; i < rows.length; i += maxRowsPerQuery) {
    const batch = rows.slice(i, i + maxRowsPerQuery);
    const { text, values } = buildBatchInsertSql(table, columns, batch);
    try {
      const result = await target.query(text, values);
      const count = result.rowCount ?? 0;
      inserted += count;
      skipped += batch.length - count;
    } catch (batchErr) {
      console.warn(
        `  [warn] Batch insert failed for public.${table} (rows ${i}..${i + batch.length - 1}): ${
          batchErr instanceof Error ? batchErr.message : String(batchErr)
        }. Falling back to row-by-row insert.`,
      );
      for (const row of batch) {
        const single = buildBatchInsertSql(table, columns, [row]);
        try {
          const singleRes = await target.query(single.text, single.values);
          if ((singleRes.rowCount ?? 0) > 0) {
            inserted++;
          } else {
            skipped++;
          }
        } catch (rowErr) {
          failed++;
          const idHint = row.id ?? row.user_id ?? "unknown";
          console.error(
            `  [error] Failed row in public.${table} (${String(idHint)}): ${
              rowErr instanceof Error ? rowErr.message : String(rowErr)
            }`,
          );
        }
      }
    }
  }

  return { inserted, skipped, failed };
}

async function migrateDomainTable(
  source: pg.Client,
  target: pg.Client,
  table: string,
  options: CliOptions,
): Promise<TableMigrationStats> {
  const stats: TableMigrationStats = {
    table,
    sourceRows: 0,
    inserted: 0,
    skipped: 0,
    failed: 0,
  };

  const [sourceCols, targetCols] = await Promise.all([
    getTableColumns(source, "public", table),
    getTableColumns(target, "public", table),
  ]);

  if (targetCols.length === 0) {
    throw new Error(
      `Target table public.${table} does not exist. Run TypeORM migrations on TARGET_DATABASE_URL first.`,
    );
  }

  if (sourceCols.length === 0) {
    stats.missingInSource = true;
    return stats;
  }

  const sharedCols = intersectColumns(sourceCols, targetCols);
  if (sharedCols.length === 0) {
    throw new Error(`No overlapping columns between source and target for public.${table}`);
  }

  const selectCols = sharedCols.map((c) => quoteIdent(c.name)).join(", ");
  const sourceRes = await source.query<Record<string, unknown>>(
    `SELECT ${selectCols} FROM public.${quoteIdent(table)}`,
  );
  stats.sourceRows = sourceRes.rows.length;

  if (options.dryRun || sourceRes.rows.length === 0) {
    return stats;
  }

  const { inserted, skipped, failed } = await insertBatches(
    target,
    table,
    sharedCols,
    sourceRes.rows,
    options.batchSize,
  );
  stats.inserted = inserted;
  stats.skipped = skipped;
  stats.failed = failed;
  return stats;
}

async function ensureS3Bucket(s3: S3Client, bucket: string, dryRun: boolean): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    if (dryRun) {
      console.log(`  [dry-run] Would create target S3 bucket "${bucket}"`);
      return;
    }
    try {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
      console.log(`  Created target S3 bucket "${bucket}"`);
    } catch (err) {
      const name = (err as { name?: string })?.name ?? "";
      if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") {
        throw err;
      }
    }
  }
}

async function s3ObjectExists(s3: S3Client, bucket: string, key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    const code = (err as { name?: string })?.name;
    const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    if (code === "NotFound" || code === "NoSuchKey" || status === 404) {
      return false;
    }
    throw err;
  }
}

async function downloadFromSupabaseHttp(
  supabaseUrl: string,
  serviceRoleKey: string,
  bucket: string,
  objectKey: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  const baseUrl = supabaseUrl.replace(/\/+$/, "");
  const encodedPath = encodeStorageObjectPath(objectKey);
  const url = `${baseUrl}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${encodedPath}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
    },
  });

  if (response.status === 404 || response.status === 400) {
    return null;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} downloading ${bucket}/${objectKey}: ${text.slice(0, 200)}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "image/jpeg";
  return { body: bytes, contentType };
}

async function downloadFromLocalDir(
  storageDir: string,
  bucket: string,
  objectKey: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  const filePath = resolveLocalStorageFile(storageDir, bucket, objectKey);
  if (!filePath) return null;
  const body = await readFile(filePath);
  return { body, contentType: "image/jpeg" };
}

async function migrateBucketObjects(params: {
  s3: S3Client;
  sourceBucket: string;
  targetBucket: string;
  keys: readonly string[];
  supabaseUrl?: string;
  supabaseServiceKey?: string;
  storageDir?: string;
  options: CliOptions;
}): Promise<StorageMigrationStats> {
  const { s3, sourceBucket, targetBucket, keys, supabaseUrl, supabaseServiceKey, storageDir, options } =
    params;

  const stats: StorageMigrationStats = {
    bucket: targetBucket,
    totalKeys: keys.length,
    uploaded: 0,
    skipped: 0,
    missingInSource: 0,
    failed: 0,
  };

  await ensureS3Bucket(s3, targetBucket, options.dryRun);
  if (keys.length === 0) {
    return stats;
  }

  let cursor = 0;
  const worker = async () => {
    while (cursor < keys.length) {
      const idx = cursor++;
      const key = keys[idx];
      try {
        const exists = await s3ObjectExists(s3, targetBucket, key);
        if (exists) {
          stats.skipped++;
          continue;
        }

        if (options.dryRun) {
          stats.uploaded++;
          continue;
        }

        const downloaded = storageDir
          ? await downloadFromLocalDir(storageDir, sourceBucket, key)
          : await downloadFromSupabaseHttp(supabaseUrl!, supabaseServiceKey!, sourceBucket, key);

        if (!downloaded) {
          stats.missingInSource++;
          console.warn(`  [warn] Object missing in source storage: ${sourceBucket}/${key}`);
          continue;
        }

        await s3.send(
          new PutObjectCommand({
            Bucket: targetBucket,
            Key: key,
            Body: downloaded.body,
            ContentType: downloaded.contentType,
          }),
        );
        stats.uploaded++;
      } catch (err) {
        stats.failed++;
        console.error(
          `  [error] Failed transferring ${sourceBucket}/${key}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  };

  const workerCount = Math.min(options.concurrency, keys.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return stats;
}

async function collectBucketKeysFromDb(
  db: pg.Client,
): Promise<{ progressPhotoKeys: string[]; checkinPhotoKeys: string[] }> {
  const progressPhotoKeys: string[] = [];
  const checkinPhotoKeys: string[] = [];

  const progressCols = await getTableColumns(db, "public", "progress_photos");
  if (progressCols.some((c) => c.name === "path")) {
    const res = await db.query<{ path: string }>(
      `SELECT path FROM public.progress_photos WHERE path IS NOT NULL`,
    );
    for (const row of res.rows) {
      if (row.path) progressPhotoKeys.push(row.path);
    }
  }

  const checkinCols = await getTableColumns(db, "public", "weekly_checkins");
  if (
    checkinCols.some((c) => c.name === "photo_front_path") &&
    checkinCols.some((c) => c.name === "photo_back_path") &&
    checkinCols.some((c) => c.name === "photo_side_path")
  ) {
    const res = await db.query<{
      photo_front_path: string | null;
      photo_back_path: string | null;
      photo_side_path: string | null;
    }>(
      `SELECT photo_front_path, photo_back_path, photo_side_path
         FROM public.weekly_checkins
        WHERE photo_front_path IS NOT NULL
           OR photo_back_path IS NOT NULL
           OR photo_side_path IS NOT NULL`,
    );
    checkinPhotoKeys.push(...collectCheckinPhotoPaths(res.rows));
  }

  return { progressPhotoKeys, checkinPhotoKeys };
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  console.log(
    `RepLog Supabase migration starting${options.dryRun ? " [DRY RUN]" : ""} (batchSize=${options.batchSize}, concurrency=${options.concurrency})`,
  );

  let sourceClient: pg.Client | null = null;
  let targetClient: pg.Client | null = null;

  try {
    if (!options.skipDb || !options.skipStorage) {
      const targetUrl = requireEnv("TARGET_DATABASE_URL");
      targetClient = new Client({ connectionString: targetUrl });
      await targetClient.connect();
    }

    if (!options.skipDb) {
      const sourceUrl = requireEnv("SOURCE_DATABASE_URL");
      sourceClient = new Client({ connectionString: sourceUrl });
      await sourceClient.connect();

      const targetUsersCols = await getTableColumns(targetClient!, "public", "users");
      if (targetUsersCols.length === 0) {
        throw new Error(
          "Target database has no public.users table. Start the RepLog API once or run `npm run migration:run --workspace=@replog/api` first.",
        );
      }

      console.log("\n=== Phase 1: PostgreSQL Data Migration ===");
      const results: TableMigrationStats[] = [];

      const userStats = await migrateUsers(sourceClient, targetClient!, options);
      results.push(userStats);
      console.log(
        `  public.users: source=${userStats.sourceRows}, inserted=${userStats.inserted}, skipped=${userStats.skipped}, failed=${userStats.failed}`,
      );

      for (const table of MIGRATION_TABLES) {
        const tableStats = await migrateDomainTable(sourceClient, targetClient!, table, options);
        results.push(tableStats);
        if (tableStats.missingInSource) {
          console.log(`  public.${table}: [not present in source, skipped]`);
        } else {
          console.log(
            `  public.${table}: source=${tableStats.sourceRows}, inserted=${tableStats.inserted}, skipped=${tableStats.skipped}, failed=${tableStats.failed}`,
          );
        }
      }

      const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
      console.log(
        `\nDB migration ${options.dryRun ? "dry-run " : ""}complete: ${results.length} tables inspected, ${totalFailed} row errors.`,
      );
    }

    if (!options.skipStorage) {
      console.log("\n=== Phase 2: Object Storage Migration (Supabase -> S3/MinIO) ===");
      const s3Endpoint = requireEnv("S3_ENDPOINT");
      const s3AccessKey = requireEnv("S3_ACCESS_KEY_ID");
      const s3SecretKey = requireEnv("S3_SECRET_ACCESS_KEY");
      const s3Region = process.env.S3_REGION?.trim() || "us-east-1";
      const s3ForcePathStyle = process.env.S3_FORCE_PATH_STYLE !== "false";
      const targetProgressBucket = process.env.S3_BUCKET_PROGRESS_PHOTOS?.trim() || "progress-photos";
      const targetCheckinBucket = process.env.S3_BUCKET_CHECKIN_PHOTOS?.trim() || "checkin-photos";

      const storageDir = process.env.SUPABASE_STORAGE_DIR?.trim() || undefined;
      const supabaseUrl = process.env.SUPABASE_URL?.trim() || undefined;
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined;

      if (!options.dryRun && !storageDir && (!supabaseUrl || !supabaseServiceKey)) {
        throw new Error(
          "Storage migration requires either SUPABASE_STORAGE_DIR or both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or pass --skip-storage).",
        );
      }

      const s3 = new S3Client({
        region: s3Region,
        endpoint: s3Endpoint,
        forcePathStyle: s3ForcePathStyle,
        credentials: {
          accessKeyId: s3AccessKey,
          secretAccessKey: s3SecretKey,
        },
      });

      // In dry-run mode (or if target DB was not populated yet), read object paths from source DB when available.
      const dbForKeys = options.dryRun && sourceClient ? sourceClient : targetClient!;
      const { progressPhotoKeys, checkinPhotoKeys } = await collectBucketKeysFromDb(dbForKeys);

      const progressStats = await migrateBucketObjects({
        s3,
        sourceBucket: "progress-photos",
        targetBucket: targetProgressBucket,
        keys: progressPhotoKeys,
        supabaseUrl,
        supabaseServiceKey,
        storageDir,
        options,
      });
      console.log(
        `  bucket ${progressStats.bucket}: keys=${progressStats.totalKeys}, ${
          options.dryRun ? "wouldUpload" : "uploaded"
        }=${progressStats.uploaded}, skipped=${progressStats.skipped}, missing=${progressStats.missingInSource}, failed=${progressStats.failed}`,
      );

      const checkinStats = await migrateBucketObjects({
        s3,
        sourceBucket: "checkin-photos",
        targetBucket: targetCheckinBucket,
        keys: checkinPhotoKeys,
        supabaseUrl,
        supabaseServiceKey,
        storageDir,
        options,
      });
      console.log(
        `  bucket ${checkinStats.bucket}: keys=${checkinStats.totalKeys}, ${
          options.dryRun ? "wouldUpload" : "uploaded"
        }=${checkinStats.uploaded}, skipped=${checkinStats.skipped}, missing=${checkinStats.missingInSource}, failed=${checkinStats.failed}`,
      );
    }

    console.log("\nMigration finished successfully.");
  } finally {
    await sourceClient?.end().catch(() => {});
    await targetClient?.end().catch(() => {});
  }
}

const isMain =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch((err) => {
    console.error(`\nMigration failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
