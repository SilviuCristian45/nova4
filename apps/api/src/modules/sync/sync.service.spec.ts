import type { DataSource } from "typeorm";
import type { StorageService } from "../../storage/storage.service";
import type { FoodsService } from "../foods/foods.service";
import { SyncService } from "./sync.service";

describe("SyncService (unit)", () => {
  const userId = "11111111-1111-4111-8111-111111111111";

  function createMockService(queryHandler: (sql: string, params?: unknown[]) => unknown[]) {
    const manager = {
      query: jest.fn(async (sql: string, params?: unknown[]) => queryHandler(sql, params)),
    };
    const dataSource = {
      query: jest.fn(async (sql: string, params?: unknown[]) => queryHandler(sql, params)),
      transaction: jest.fn(async (cb: (m: typeof manager) => Promise<unknown>) => cb(manager)),
    } as unknown as DataSource;
    const foodsService = {
      getOrCacheBarcodeFood: jest.fn(async () => null),
    } as unknown as FoodsService;
    const storage = {
      getProgressPhotosBucket: jest.fn(() => "progress-photos"),
      isPhotoEncryptionEnabled: jest.fn(() => false),
      headObject: jest.fn(async () => ({ contentLength: 120_000, contentType: "image/jpeg" })),
      deleteObject: jest.fn(async () => undefined),
    } as unknown as StorageService;

    return { service: new SyncService(dataSource, foodsService, storage), manager, foodsService, storage };
  }

  it("returns current cursor immediately for empty push batches", async () => {
    const { service } = createMockService((sql) => {
      if (sql.includes("MAX(seq)")) return [{ seq: "42" }];
      return [];
    });

    const res = await service.push(userId, { mutations: [] });
    expect(res.results).toEqual([]);
    expect(res.foodIdMap).toEqual({});
    expect(res.serverCursor).toBe(42);
  });

  it("deduplicates already processed mutationIds via offline_sync_receipts", async () => {
    const mutationId = "22222222-2222-4222-8222-222222222222";
    const { service } = createMockService((sql) => {
      if (sql.includes("FROM public.offline_sync_receipts")) return [{ mutation_id: mutationId }];
      if (sql.includes("MAX(seq)")) return [{ seq: "7" }];
      return [];
    });

    const res = await service.push(userId, {
      mutations: [
        {
          mutationId,
          entityType: "daily_steps",
          entityId: "2026-11-27",
          op: "upsert",
          clientUpdatedAt: "2026-11-27T09:00:00.000Z",
          payload: { steps: 9500 },
        },
      ],
    });

    expect(res.results).toEqual([{ mutationId, status: "deduplicated" }]);
    expect(res.serverCursor).toBe(7);
  });

  it("resolves LWW conflict in favor of server when server updated_at is newer", async () => {
    const mutationId = "33333333-3333-4333-8333-333333333333";
    const { service, manager } = createMockService((sql) => {
      if (sql.includes("FROM public.offline_sync_receipts")) return [];
      if (sql.includes("FROM public.sync_changes WHERE user_id")) {
        return [{ updated_at: new Date("2026-11-27T10:00:00.000Z") }];
      }
      if (sql.includes("MAX(seq)")) return [{ seq: "12" }];
      return [];
    });

    const res = await service.push(userId, {
      mutations: [
        {
          mutationId,
          entityType: "daily_weight",
          entityId: "2026-11-27",
          op: "upsert",
          clientUpdatedAt: "2026-11-27T09:00:00.000Z",
          payload: { weight_kg: 80.5 },
        },
      ],
    });

    expect(res.results).toEqual([{ mutationId, status: "conflict_server_wins" }]);
    expect(
      manager.query.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes("INSERT INTO public.daily_weight")),
    ).toBe(false);
  });

  it("maps barcode food to existing canonical server food without overwriting shared catalog", async () => {
    const mutationId = "44444444-4444-4444-8444-444444444444";
    const localFoodId = "55555555-5555-4555-8555-555555555555";
    const serverFoodId = "66666666-6666-4666-8666-666666666666";

    const { service, manager } = createMockService((sql) => {
      if (sql.includes("FROM public.offline_sync_receipts")) return [];
      if (sql.includes("FROM public.sync_changes WHERE user_id")) return [];
      if (sql.includes("FROM public.foods WHERE barcode = $1")) return [{ id: serverFoodId }];
      if (sql.includes("MAX(seq)")) return [{ seq: "15" }];
      return [];
    });

    const res = await service.push(userId, {
      mutations: [
        {
          mutationId,
          entityType: "food",
          entityId: localFoodId,
          op: "upsert",
          clientUpdatedAt: "2026-11-27T09:00:00.000Z",
          payload: {
            name: "Milk",
            barcode: "5941234567890",
            kcal_per_100g: 60,
            protein_per_100g: 3.2,
            carbs_per_100g: 4.8,
            fat_per_100g: 3.5,
          },
        },
      ],
    });

    expect(res.results).toEqual([{ mutationId, status: "applied" }]);
    expect(res.foodIdMap).toEqual({ [localFoodId]: serverFoodId });
    expect(
      manager.query.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes("INSERT INTO public.foods")),
    ).toBe(false);
  });

  it("builds delta pull response with deletes and upserts since cursor", async () => {
    const deletedWorkoutId = "77777777-7777-4777-8777-777777777777";
    const { service } = createMockService((sql) => {
      if (sql.includes("MAX(seq)")) return [{ seq: "20" }];
      if (sql.includes("FROM public.sync_changes") && sql.includes("seq > $2")) {
        return [
          {
            entity_type: "workout",
            entity_id: deletedWorkoutId,
            op: "delete",
            updated_at: new Date("2026-11-27T09:30:00.000Z"),
          },
          {
            entity_type: "daily_steps",
            entity_id: "2026-11-27",
            op: "upsert",
            updated_at: new Date("2026-11-27T09:35:00.000Z"),
          },
        ];
      }
      if (sql.includes("FROM public.daily_steps")) {
        return [{ id: "88888888-8888-4888-8888-888888888888", date: "2026-11-27", steps: 11200 }];
      }
      return [];
    });

    const pull = await service.pull(userId, 10);
    expect(pull.mode).toBe("delta");
    expect(pull.cursor).toBe(20);
    expect(pull.upserts.daily_steps).toEqual([
      { id: "88888888-8888-4888-8888-888888888888", date: "2026-11-27", steps: 11200 },
    ]);
    expect(pull.deletes).toEqual([
      {
        entityType: "workout",
        entityId: deletedWorkoutId,
        updatedAt: "2026-11-27T09:30:00.000Z",
      },
    ]);
  });

  it("pushes daily_checkin upserts and progress_photo inserts/deletes with S3 cleanup", async () => {
    const mCheckin = "99999999-9999-4999-8999-999999999991";
    const mPhotoUpsert = "99999999-9999-4999-8999-999999999992";
    const mPhotoDelete = "99999999-9999-4999-8999-999999999993";
    const photoId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    const { service, storage } = createMockService((sql) => {
      if (sql.includes("FROM public.offline_sync_receipts")) return [];
      if (sql.includes("FROM public.sync_changes WHERE user_id")) return [];
      if (sql.includes("SELECT id, user_id FROM public.progress_photos")) return [];
      if (sql.includes("SELECT COUNT(*)::text AS count FROM public.progress_photos")) return [{ count: "1" }];
      if (sql.includes("SELECT path FROM public.progress_photos")) return [{ path: `${userId}/${photoId}.jpg` }];
      if (sql.includes("MAX(seq)")) return [{ seq: "30" }];
      return [];
    });

    const res = await service.push(userId, {
      mutations: [
        {
          mutationId: mCheckin,
          entityType: "daily_checkin",
          entityId: "2026-11-27",
          op: "upsert",
          clientUpdatedAt: "2026-11-27T09:00:00.000Z",
          payload: { energy: 8, satiety: 7, sleep: 9, note: "Felt great" },
        },
        {
          mutationId: mPhotoUpsert,
          entityType: "progress_photo",
          entityId: photoId,
          op: "upsert",
          clientUpdatedAt: "2026-11-27T09:05:00.000Z",
          payload: { taken_on: "2026-11-27", pose: "front", note: "Morning check", size_bytes: 120_000 },
        },
        {
          mutationId: mPhotoDelete,
          entityType: "progress_photo",
          entityId: photoId,
          op: "delete",
          clientUpdatedAt: "2026-11-27T09:10:00.000Z",
        },
      ],
    });

    expect(res.results.map((r) => r.status)).toEqual(["applied", "applied", "applied"]);
    expect(storage.headObject).toHaveBeenCalledWith("progress-photos", `${userId}/${photoId}.jpg`);
    expect(storage.deleteObject).toHaveBeenCalledWith("progress-photos", `${userId}/${photoId}.jpg`);
  });

  it("formats pg Date instances as YYYY-MM-DD strings on full pull", async () => {
    const { service } = createMockService((sql) => {
      if (sql.includes("MAX(seq)")) return [{ seq: "5" }];
      if (sql.includes("FROM public.profiles")) {
        return [{ daily_steps_goal: 10000, birth_date: new Date(1995, 4, 9), weight_unit: "kg", goal_kg_per_week: 0 }];
      }
      if (sql.includes("FROM public.workouts")) {
        return [
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            performed_on: new Date(2026, 6, 30),
            split: "Push",
            created_at: new Date("2026-07-30T10:00:00.000Z"),
            client_id: null,
            workout_mode: "strength",
          },
        ];
      }
      if (sql.includes("FROM public.meals")) {
        return [
          {
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            performed_on: new Date(2026, 7, 13),
            meal_type: "Lunch",
            notes: null,
            created_at: new Date("2026-08-13T12:00:00.000Z"),
          },
        ];
      }
      if (sql.includes("FROM public.daily_steps")) {
        return [{ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", date: new Date(2026, 7, 13), steps: 12354 }];
      }
      if (sql.includes("FROM public.daily_weight")) {
        return [{ date: new Date(2026, 9, 16), weight_kg: "79.6" }];
      }
      if (sql.includes("FROM public.daily_checkin")) {
        return [{ date: new Date(2026, 9, 17), energy: 8, satiety: 7, sleep: 8, note: null }];
      }
      if (sql.includes("FROM public.progress_photos")) {
        return [
          {
            id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            taken_on: new Date(2026, 9, 18),
            pose: "front",
            note: null,
            size_bytes: 50000,
            created_at: new Date("2026-10-18T08:00:00.000Z"),
          },
        ];
      }
      return [];
    });

    const pull = await service.pull(userId, 0);
    expect(pull.upserts.profile?.birth_date).toBe("1995-05-09");
    expect(pull.upserts.workouts[0]?.performed_on).toBe("2026-07-30");
    expect(pull.upserts.meals[0]?.performed_on).toBe("2026-08-13");
    expect(pull.upserts.daily_steps[0]?.date).toBe("2026-08-13");
    expect(pull.upserts.daily_weight[0]?.date).toBe("2026-10-16");
    expect(pull.upserts.daily_checkin[0]?.date).toBe("2026-10-17");
    expect(pull.upserts.progress_photos[0]?.taken_on).toBe("2026-10-18");
  });
});
