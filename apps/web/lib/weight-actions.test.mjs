import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { parseBodyWeight, isMeasurementDate, localDate } from "./daily-metrics.ts";
import { ApiError } from "./api/types.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = ts.transpileModule(
  readFileSync(new URL("../app/weight/actions.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText;

function actions({ user = { id: "owner-id" }, rows = [], error = null } = {}) {
  const calls = [];
  const revalidated = [];
  const actionExports = {};
  const mocks = {
    "next/cache": { revalidatePath: (path) => revalidated.push(path) },
    "@/lib/api/server": {
      getSessionUser: async () => user,
      serverApi: async (path, options) => {
        calls.push([path, options]);
        if (error) throw error;
        return rows;
      },
    },
    "@/lib/api/types": { ApiError },
    "@/lib/daily-metrics": { parseBodyWeight, isMeasurementDate },
  };
  new Function("require", "exports", source)((id) => {
    assert.ok(id in mocks, `Unexpected import: ${id}`);
    return mocks[id];
  }, actionExports);
  return { ...actionExports, calls, revalidated };
}

function form(weight, date = localDate()) {
  const data = new FormData();
  data.set("date", date);
  data.set("weight", weight);
  return data;
}

test("weight save sends PUT /metrics/weight and revalidates", async () => {
  const api = actions();
  const data = form("75,55");
  data.set("user_id", "attacker-supplied-id");
  assert.deepEqual(await api.saveDailyWeight(data), { success: true, weight: 75.55 });
  assert.deepEqual(api.calls, [
    ["/metrics/weight", { method: "PUT", body: { date: localDate(), weightKg: 75.55 } }],
  ]);
  assert.deepEqual(api.revalidated, ["/", "/stats"]);
});

test("invalid weight/date and unauthenticated requests never write", async () => {
  const api = actions();
  assert.deepEqual(await api.saveDailyWeight(form("0")), { success: false, error: "invalid-weight" });
  assert.deepEqual(await api.saveDailyWeight(form("75", "2026-02-30")), { success: false, error: "invalid-date" });
  assert.equal(api.calls.length, 0);
  const guest = actions({ user: null });
  assert.deepEqual(await guest.saveDailyWeight(form("75")), { success: false, error: "unauthorized" });
  assert.deepEqual(await guest.getDailyWeight(localDate()), { success: false, error: "unauthorized" });
  assert.equal(guest.calls.length, 0);
});

test("weight lookup distinguishes no entry from value and queries by date", async () => {
  const api = actions({ rows: [{ date: localDate(), weightKg: 75.55 }] });
  assert.deepEqual(await api.getDailyWeight(localDate()), { success: true, weight: 75.55 });
  assert.deepEqual(api.calls, [[`/metrics/weight?date=${encodeURIComponent(localDate())}`, undefined]]);
  assert.deepEqual(await actions().getDailyWeight(localDate()), { success: true, weight: null });
});

test("storage and auth failures are explicit and never revalidate as a successful save", async (context) => {
  context.mock.method(console, "error", () => {});
  const unauth = actions({ error: new ApiError(401, "Unauthorized") });
  assert.deepEqual(await unauth.saveDailyWeight(form("75")), { success: false, error: "unauthorized" });
  assert.deepEqual(await unauth.getDailyWeight(localDate()), { success: false, error: "unauthorized" });

  const fail = actions({ error: new ApiError(500, "Server error") });
  assert.deepEqual(await fail.saveDailyWeight(form("75")), { success: false, error: "storage" });
  assert.deepEqual(await fail.getDailyWeight(localDate()), { success: false, error: "storage" });
  assert.deepEqual(fail.revalidated, []);
});
