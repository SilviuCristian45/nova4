import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { DataSource } from "typeorm";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.setup";
import { StorageService } from "../src/storage/storage.service";

class InMemoryPhotoStorage {
  readonly objects = new Map<string, Buffer>();

  getProgressPhotosBucket() {
    return "progress-photos";
  }

  getCheckinPhotosBucket() {
    return "checkin-photos";
  }

  isPhotoEncryptionEnabled() {
    return false;
  }

  async createPresignedUploadUrl(bucket: string, key: string) {
    return { url: `http://minio.local/${bucket}/${key}?put=1`, expiresIn: 600 };
  }

  async createPresignedDownloadUrl(bucket: string, key: string) {
    return `http://minio.local/${bucket}/${key}?get=1`;
  }

  async createPresignedDownloadUrls(bucket: string, keys: readonly string[]) {
    return new Map(keys.map((key) => [key, `http://minio.local/${bucket}/${key}?get=1`]));
  }

  async headObject(bucket: string, key: string) {
    const buf = this.objects.get(`${bucket}/${key}`);
    return buf ? { contentLength: buf.length, contentType: "image/jpeg" } : null;
  }

  async uploadObject(bucket: string, key: string, body: Buffer | Uint8Array) {
    this.objects.set(`${bucket}/${key}`, Buffer.isBuffer(body) ? body : Buffer.from(body));
  }

  async downloadObject(bucket: string, key: string) {
    return this.objects.get(`${bucket}/${key}`) ?? null;
  }

  async deleteObject(bucket: string, key: string) {
    this.objects.delete(`${bucket}/${key}`);
  }

  async deleteObjects(bucket: string, keys: readonly string[]) {
    for (const key of keys) this.objects.delete(`${bucket}/${key}`);
  }

  async deleteUserPrefix(bucket: string, userId: string) {
    const prefix = `${bucket}/${userId}/`;
    for (const fullKey of [...this.objects.keys()]) {
      if (fullKey.startsWith(prefix)) this.objects.delete(fullKey);
    }
  }
}

describe("Bidirectional Sync E2E (Push, Pull, Triggers, LWW, Photos & Isolation)", () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let storage: InMemoryPhotoStorage;

  const today = new Date().toISOString().slice(0, 10);
  const minimalJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

  async function registerUser(email: string, displayName: string) {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email, password: "Password123!", displayName })
      .expect(201);
    return {
      id: res.body.user.id as string,
      token: res.body.accessToken as string,
    };
  }

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "test-jwt-secret-at-least-32-chars-long";
    process.env.COOKIE_SECURE = "false";
    process.env.THROTTLE_LIMIT = "1000";

    storage = new InMemoryPhotoStorage();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StorageService)
      .useValue(storage)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app, { enableSwagger: false });
    await app.init();

    dataSource = app.get(DataSource);
    await dataSource.runMigrations();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(async () => {
    storage.objects.clear();
    await dataSource.query("TRUNCATE TABLE public.users, public.foods RESTART IDENTITY CASCADE");
  });

  it("synchronizes workouts, meals, barcode foods, metrics, check-in, profile, and photos bidirectionally", async () => {
    const alice = await registerUser("sync-alice@example.com", "Alice");
    const bob = await registerUser("sync-bob@example.com", "Bob");

    // Seed a shared barcode food on the server to verify foodIdMap remapping.
    const [canonicalFood] = await dataSource.query(
      `INSERT INTO public.foods (user_id, name, brand, barcode, kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g)
       VALUES (NULL, 'Canonical Milk', 'Brand', '5940001112223', 60, 3.2, 4.8, 3.5)
       RETURNING id`,
    );

    const workoutId = randomUUID();
    const setId = randomUUID();
    const mealId = randomUUID();
    const mealItemId = randomUUID();
    const localFoodId = randomUUID();
    const photoId = randomUUID();

    // Upload JPEG photo bytes before pushing progress_photo metadata.
    await request(app.getHttpServer())
      .put(`/api/v1/photos/upload/${photoId}`)
      .set("Authorization", `Bearer ${alice.token}`)
      .set("Content-Type", "image/jpeg")
      .send(minimalJpeg)
      .expect(200);

    const m1 = randomUUID();
    const m2 = randomUUID();
    const m3 = randomUUID();
    const m4 = randomUUID();
    const m5 = randomUUID();
    const m6 = randomUUID();
    const nowIso = new Date().toISOString();

    const pushRes = await request(app.getHttpServer())
      .post("/api/v1/sync/push")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({
        mutations: [
          {
            mutationId: m1,
            entityType: "workout",
            entityId: workoutId,
            op: "upsert",
            clientUpdatedAt: nowIso,
            payload: {
              id: workoutId,
              performed_on: today,
              split: "Push",
              workout_mode: "strength",
              created_at: nowIso,
              workout_sets: [
                {
                  id: setId,
                  workout_id: workoutId,
                  split: "Push",
                  exercise: "Bench Press",
                  set_number: 1,
                  reps: 8,
                  rir: null,
                  set_type: "Working Set",
                  weight: 82.5,
                  notes: "Mobile set",
                  created_at: nowIso,
                },
              ],
              cardio_sessions: [],
            },
          },
          {
            mutationId: m2,
            entityType: "food",
            entityId: localFoodId,
            op: "upsert",
            clientUpdatedAt: nowIso,
            payload: {
              id: localFoodId,
              name: "Local Milk",
              barcode: "5940001112223",
              kcal_per_100g: 999,
              protein_per_100g: 1,
              carbs_per_100g: 1,
              fat_per_100g: 1,
              created_at: nowIso,
            },
          },
          {
            mutationId: m3,
            entityType: "meal",
            entityId: mealId,
            op: "upsert",
            clientUpdatedAt: nowIso,
            payload: {
              id: mealId,
              performed_on: today,
              meal_type: "Breakfast",
              notes: null,
              created_at: nowIso,
              meal_items: [
                {
                  id: mealItemId,
                  meal_id: mealId,
                  food_id: localFoodId,
                  consumed_weight_g: 250,
                  total_kcal: 150,
                  total_protein_g: 8,
                  total_carbs_g: 12,
                  total_fat_g: 8.8,
                  created_at: nowIso,
                },
              ],
            },
          },
          {
            mutationId: m4,
            entityType: "daily_checkin",
            entityId: today,
            op: "upsert",
            clientUpdatedAt: nowIso,
            payload: { energy: 8, satiety: 7, sleep: 9, note: "Great sleep" },
          },
          {
            mutationId: m5,
            entityType: "profile",
            entityId: "self",
            op: "upsert",
            clientUpdatedAt: nowIso,
            payload: { display_name: "Alice Mobile", daily_steps_goal: 12000, role: "coach" },
          },
          {
            mutationId: m6,
            entityType: "progress_photo",
            entityId: photoId,
            op: "upsert",
            clientUpdatedAt: nowIso,
            payload: { taken_on: today, pose: "front", note: "Day 1", size_bytes: minimalJpeg.length, created_at: nowIso },
          },
        ],
      })
      .expect(200);

    expect(pushRes.body.results.every((r: { status: string }) => r.status === "applied")).toBe(true);
    expect(pushRes.body.foodIdMap[localFoodId]).toBe(canonicalFood.id);
    const cursorAfterPush = pushRes.body.serverCursor as number;
    expect(cursorAfterPush).toBeGreaterThan(0);

    // Retry same mutationId -> deduplicated.
    const retryRes = await request(app.getHttpServer())
      .post("/api/v1/sync/push")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({
        mutations: [
          {
            mutationId: m4,
            entityType: "daily_checkin",
            entityId: today,
            op: "upsert",
            clientUpdatedAt: nowIso,
            payload: { energy: 8, satiety: 7, sleep: 9, note: "Great sleep" },
          },
        ],
      })
      .expect(200);
    expect(retryRes.body.results).toEqual([{ mutationId: m4, status: "deduplicated" }]);

    // Role must NEVER be escalated by mobile sync.
    const me = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${alice.token}`)
      .expect(200);
    expect(me.body.profile.role).toBe("client");
    expect(me.body.profile.displayName).toBe("Alice Mobile");

    // Cross-user isolation: Bob cannot overwrite Alice's workout UUID.
    const bobAttack = await request(app.getHttpServer())
      .post("/api/v1/sync/push")
      .set("Authorization", `Bearer ${bob.token}`)
      .send({
        mutations: [
          {
            mutationId: randomUUID(),
            entityType: "workout",
            entityId: workoutId,
            op: "upsert",
            clientUpdatedAt: new Date(Date.now() + 1000).toISOString(),
            payload: {
              id: workoutId,
              performed_on: today,
              split: "Hacked",
              workout_mode: "strength",
              created_at: nowIso,
              workout_sets: [
                {
                  id: randomUUID(),
                  workout_id: workoutId,
                  split: "Hacked",
                  exercise: "Bench Press",
                  set_number: 1,
                  reps: 1,
                  rir: 0,
                  set_type: "Working Set",
                  weight: 10,
                  created_at: nowIso,
                },
              ],
              cardio_sessions: [],
            },
          },
        ],
      })
      .expect(200);
    expect(bobAttack.body.results[0].status).toBe("rejected");

    // Web edits Alice's photo metadata, steps, and deletes the workout -> Postgres triggers record sync_changes.
    await request(app.getHttpServer())
      .patch(`/api/v1/photos/${photoId}`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ note: "Edited on web", pose: "side" })
      .expect(200);

    await request(app.getHttpServer())
      .put("/api/v1/metrics/steps")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ date: today, steps: 13500 })
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/api/v1/workouts/${workoutId}`)
      .set("Authorization", `Bearer ${alice.token}`)
      .expect(200);

    // Delta pull from cursorAfterPush must return the web steps upsert, updated photo, and workout delete tombstone.
    const delta = await request(app.getHttpServer())
      .get(`/api/v1/sync/pull?cursor=${cursorAfterPush}`)
      .set("Authorization", `Bearer ${alice.token}`)
      .expect(200);

    expect(delta.body.mode).toBe("delta");
    expect(delta.body.cursor).toBeGreaterThan(cursorAfterPush);
    expect(delta.body.upserts.daily_steps).toEqual([
      expect.objectContaining({ date: today, steps: 13500 }),
    ]);
    expect(delta.body.upserts.progress_photos).toEqual([
      expect.objectContaining({ id: photoId, pose: "side", note: "Edited on web" }),
    ]);
    expect(delta.body.deletes).toEqual(
      expect.arrayContaining([expect.objectContaining({ entityType: "workout", entityId: workoutId })]),
    );

    // LWW conflict: stale mobile steps push older than web's update returns conflict_server_wins.
    const stalePush = await request(app.getHttpServer())
      .post("/api/v1/sync/push")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({
        mutations: [
          {
            mutationId: randomUUID(),
            entityType: "daily_steps",
            entityId: today,
            op: "upsert",
            clientUpdatedAt: "2020-01-01T00:00:00.000Z",
            payload: { steps: 100 },
          },
        ],
      })
      .expect(200);
    expect(stalePush.body.results[0].status).toBe("conflict_server_wins");

    // Photo delete via sync purges S3 object as well as DB row.
    await request(app.getHttpServer())
      .post("/api/v1/sync/push")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({
        mutations: [
          {
            mutationId: randomUUID(),
            entityType: "progress_photo",
            entityId: photoId,
            op: "delete",
            clientUpdatedAt: new Date(Date.now() + 60_000).toISOString(),
          },
        ],
      })
      .expect(200);

    expect(await storage.headObject("progress-photos", `${alice.id}/${photoId}.jpg`)).toBeNull();
  });
});
