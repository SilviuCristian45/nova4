import assert from "node:assert/strict";
import test from "node:test";
import {
  MIGRATION_TABLES,
  buildBatchInsertSql,
  buildPgClientConfig,
  collectCheckinPhotoPaths,
  encodeStorageObjectPath,
  intersectColumns,
  mapAuthUserRow,
  parseCliArgs,
  quoteIdent,
  serializeValueForColumn,
} from "./migrate-from-supabase.ts";

test("MIGRATION_TABLES includes all 30 domain tables in valid FK parent-before-child order", () => {
  assert.equal(MIGRATION_TABLES.length, 30);
  assert.equal(new Set(MIGRATION_TABLES).size, 30);

  const indexOf = (table) => MIGRATION_TABLES.indexOf(table);
  assert.ok(indexOf("programs") < indexOf("program_workouts"));
  assert.ok(indexOf("program_workouts") < indexOf("program_workout_exercises"));
  assert.ok(indexOf("program_workouts") < indexOf("program_workout_cardio"));
  assert.ok(indexOf("programs") < indexOf("enrollments"));
  assert.ok(indexOf("enrollments") < indexOf("workouts"));
  assert.ok(indexOf("program_workouts") < indexOf("workouts"));
  assert.ok(indexOf("workouts") < indexOf("workout_sets"));
  assert.ok(indexOf("workouts") < indexOf("cardio_sessions"));
  assert.ok(indexOf("workouts") < indexOf("workout_feedback"));
  assert.ok(indexOf("foods") < indexOf("meal_items"));
  assert.ok(indexOf("meals") < indexOf("meal_items"));
  assert.ok(indexOf("meal_plans") < indexOf("meal_plan_days"));
  assert.ok(indexOf("meal_plan_days") < indexOf("meal_plan_meals"));
  assert.ok(indexOf("meal_plan_meals") < indexOf("meal_plan_items"));
  assert.ok(indexOf("foods") < indexOf("meal_plan_items"));
  assert.ok(indexOf("enrollments") < indexOf("weekly_checkins"));
});

test("parseCliArgs parses flags and validates bounds", () => {
  assert.deepEqual(parseCliArgs(["--dry-run", "--skip-storage", "--batch-size=250", "--concurrency=8"]), {
    dryRun: true,
    skipDb: false,
    skipStorage: true,
    batchSize: 250,
    concurrency: 8,
    help: false,
  });

  assert.throws(() => parseCliArgs(["--batch-size=0"]));
  assert.throws(() => parseCliArgs(["--concurrency=99"]));
  assert.throws(() => parseCliArgs(["--unknown-flag"]));
});

test("quoteIdent allows valid SQL identifiers and rejects injection attempts", () => {
  assert.equal(quoteIdent("workout_sets"), '"workout_sets"');
  assert.throws(() => quoteIdent("users; drop table users;--"));
  assert.throws(() => quoteIdent("123invalid"));
});

test("intersectColumns preserves target column order and data types", () => {
  const source = [
    { name: "id", dataType: "uuid" },
    { name: "legacy_only", dataType: "text" },
    { name: "payload", dataType: "jsonb" },
  ];
  const target = [
    { name: "payload", dataType: "jsonb" },
    { name: "id", dataType: "uuid" },
    { name: "new_default_col", dataType: "boolean" },
  ];

  assert.deepEqual(intersectColumns(source, target), [
    { name: "payload", dataType: "jsonb" },
    { name: "id", dataType: "uuid" },
  ]);
});

test("buildBatchInsertSql serializes jsonb arrays as JSON strings while keeping text[] arrays intact", () => {
  const columns = [
    { name: "id", dataType: "uuid" },
    { name: "items", dataType: "jsonb" },
    { name: "specialties", dataType: "ARRAY" },
  ];
  const rows = [
    {
      id: "11111111-1111-1111-1111-111111111111",
      items: [{ food_id: "abc", grams: 150 }],
      specialties: ["hypertrophy", "strength"],
    },
  ];

  const built = buildBatchInsertSql("meal_templates", columns, rows);
  assert.equal(
    built.text,
    'INSERT INTO public."meal_templates" ("id", "items", "specialties") VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
  );
  assert.equal(built.values[0], "11111111-1111-1111-1111-111111111111");
  assert.equal(built.values[1], '[{"food_id":"abc","grams":150}]');
  assert.deepEqual(built.values[2], ["hypertrophy", "strength"]);
  assert.equal(serializeValueForColumn(null, "jsonb"), null);
});

test("mapAuthUserRow preserves UUID & bcrypt hash, normalizes email, and skips incomplete rows", () => {
  const mapped = mapAuthUserRow({
    id: "22222222-2222-2222-2222-222222222222",
    email: "  User@Example.COM ",
    encrypted_password: "$2a$10$abcdefghijklmnopqrstuv",
    email_confirmed_at: "2025-01-01T00:00:00Z",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-02T00:00:00Z",
  });

  assert.deepEqual(mapped, {
    id: "22222222-2222-2222-2222-222222222222",
    email: "user@example.com",
    password_hash: "$2a$10$abcdefghijklmnopqrstuv",
    email_verified_at: "2025-01-01T00:00:00Z",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-02T00:00:00Z",
  });

  assert.equal(mapAuthUserRow({ id: "abc", email: "a@b.com", encrypted_password: "" }), null);
  assert.equal(mapAuthUserRow({ id: "abc", email: "", encrypted_password: "$2a$10$..." }), null);
});

test("collectCheckinPhotoPaths deduplicates non-null paths and encodeStorageObjectPath preserves slashes", () => {
  const paths = collectCheckinPhotoPaths([
    { photo_front_path: "u1/a.jpg", photo_back_path: null, photo_side_path: "u1/b.jpg" },
    { photo_front_path: "u1/a.jpg", photo_back_path: "u1/c.jpg", photo_side_path: null },
  ]);
  assert.deepEqual(paths, ["u1/a.jpg", "u1/b.jpg", "u1/c.jpg"]);
  assert.equal(encodeStorageObjectPath("user-1/photo 1.jpg"), "user-1/photo%201.jpg");
});

test("buildPgClientConfig enables relaxed SSL for remote Supabase hosts and keeps local hosts plain", () => {
  const localCfg = buildPgClientConfig("postgres://postgres:postgres@localhost:5439/replog");
  assert.equal(localCfg.ssl, undefined);

  const remoteCfg = buildPgClientConfig("postgres://postgres.abc:pass@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require");
  assert.deepEqual(remoteCfg.ssl, { rejectUnauthorized: false });
  assert.equal(remoteCfg.connectionString?.includes("sslmode="), false);

  const disabledCfg = buildPgClientConfig("postgres://postgres:pass@remote.host:5432/db?sslmode=disable");
  assert.equal(disabledCfg.ssl, undefined);
});
