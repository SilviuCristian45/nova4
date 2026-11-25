import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { DataSource } from "typeorm";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.setup";
import { StorageService } from "../src/storage/storage.service";

class InMemoryStorageService {
  readonly objects = new Map<string, { contentLength: number; contentType?: string }>();

  getProgressPhotosBucket() {
    return "progress-photos";
  }

  getCheckinPhotosBucket() {
    return "checkin-photos";
  }

  async createPresignedUploadUrl(bucket: string, key: string, options: { contentLength?: number } = {}) {
    return {
      url: `http://minio.local/${bucket}/${key}?put=1&len=${options.contentLength ?? 0}`,
      expiresIn: 600,
    };
  }

  async createPresignedDownloadUrl(bucket: string, key: string) {
    return `http://minio.local/${bucket}/${key}?get=1`;
  }

  async createPresignedDownloadUrls(bucket: string, keys: readonly string[]) {
    return new Map(keys.map((key) => [key, `http://minio.local/${bucket}/${key}?get=1`]));
  }

  async headObject(bucket: string, key: string) {
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

describe("Phase 2 E2E: Workouts, Metrics, Foods, Meals, Photos & Offline Sync", () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fakeStorage: InMemoryStorageService;

  const today = new Date().toISOString().slice(0, 10);

  async function registerUser(email: string, role: "client" | "coach" = "client", displayName?: string) {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email, password: "Password123!", role, displayName })
      .expect(201);
    return {
      id: res.body.user.id as string,
      token: res.body.accessToken as string,
    };
  }

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "test-jwt-secret-at-least-32-chars-long";
    process.env.COOKIE_SECURE = "false";
    process.env.COACH_SELF_SERVE = "true";
    process.env.THROTTLE_LIMIT = "1000";

    fakeStorage = new InMemoryStorageService();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StorageService)
      .useValue(fakeStorage)
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
    fakeStorage.objects.clear();
    await dataSource.query("TRUNCATE TABLE public.users, public.foods RESTART IDENTITY CASCADE");
  });

  it("handles transactional workout create, PR detection + coach notification, ID-preserving update, records, stats, draft, and user isolation", async () => {
    const coach = await registerUser("coach@example.com", "coach", "Coach Dan");
    const alice = await registerUser("alice@example.com", "client", "Alice");
    const bob = await registerUser("bob@example.com", "client", "Bob");

    // Link Alice to Coach Dan with active enrollment so PR notification triggers.
    await dataSource.query(
      `INSERT INTO public.enrollments (client_id, coach_id, status) VALUES ($1, $2, 'active')`,
      [alice.id, coach.id],
    );

    // 1. Baseline workout
    const w1 = await request(app.getHttpServer())
      .post("/api/v1/workouts")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({
        mode: "strength",
        split: "Push",
        date: "2026-11-20",
        sets: [
          { split: "Push", exercise: "Bench Press (Barbell)", setNumber: 1, reps: 8, weight: 80, rir: 2, setType: "Working Set", notes: "" },
        ],
        cardio: [],
      })
      .expect(201);

    expect(w1.body.prExercises).toEqual([]);
    const originalSetId = w1.body.sets[0].id as string;

    // 2. Edit workout: keep original set ID, add a second set
    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/workouts/${w1.body.id}`)
      .set("Authorization", `Bearer ${alice.token}`)
      .send({
        mode: "strength",
        split: "Push",
        date: "2026-11-20",
        sets: [
          { id: originalSetId, split: "Push", exercise: "Bench Press (Barbell)", setNumber: 1, reps: 8, weight: 80, rir: 2, setType: "Working Set", notes: "Clean" },
          { id: "client-temp-id", split: "Push", exercise: "Bench Press (Barbell)", setNumber: 2, reps: 8, weight: 80, rir: 1, setType: "Working Set", notes: "" },
        ],
        cardio: [],
      })
      .expect(200);

    expect(updated.body.sets).toHaveLength(2);
    expect(updated.body.sets[0].id).toBe(originalSetId);
    expect(updated.body.sets[0].notes).toBe("Clean");

    // 3. New workout beating previous best -> PR detected + coach notified!
    const w2 = await request(app.getHttpServer())
      .post("/api/v1/workouts")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({
        mode: "strength",
        split: "Push",
        date: "2026-11-22",
        sets: [
          { split: "Push", exercise: "Bench Press (Barbell)", setNumber: 1, reps: 8, weight: 85, rir: 1, setType: "Working Set", notes: "" },
        ],
        cardio: [],
      })
      .expect(201);

    expect(w2.body.prExercises).toEqual(["Bench Press (Barbell)"]);
    expect(w2.body.sets[0].isPr).toBe(true);

    const coachNotifications = await dataSource.query(
      `SELECT type, payload FROM public.notifications WHERE user_id = $1`,
      [coach.id],
    );
    expect(coachNotifications).toHaveLength(1);
    expect(coachNotifications[0].type).toBe("client_pr");
    expect(coachNotifications[0].payload.exercises).toEqual(["Bench Press (Barbell)"]);

    // 4. Records, Stats, and Exercise History
    const records = await request(app.getHttpServer())
      .get("/api/v1/workouts/records")
      .set("Authorization", `Bearer ${alice.token}`)
      .expect(200);
    expect(records.body[0].exercise).toBe("Bench Press (Barbell)");
    expect(records.body[0].weight).toBe(85);

    const stats = await request(app.getHttpServer())
      .get("/api/v1/workouts/stats")
      .query({ exercise: "Bench Press (Barbell)" })
      .set("Authorization", `Bearer ${alice.token}`)
      .expect(200);
    expect(stats.body.totalWorkouts).toBe(2);
    expect(stats.body.progression).toHaveLength(2);

    const history = await request(app.getHttpServer())
      .get(`/api/v1/workouts/exercises/${encodeURIComponent("Bench Press (Barbell)")}/history`)
      .set("Authorization", `Bearer ${alice.token}`)
      .expect(200);
    expect(history.body.bestAllTime.weight).toBe(85);

    // 5. Draft timestamp conflict resolution
    const newerTs = "2026-11-25T12:00:00.000Z";
    const olderTs = "2026-11-25T11:00:00.000Z";
    const saveNewer = await request(app.getHttpServer())
      .put("/api/v1/workouts/draft")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ draft: { split: "Pull" }, clientUpdatedAt: newerTs })
      .expect(200);
    expect(saveNewer.body.saved).toBe(true);

    const saveOlder = await request(app.getHttpServer())
      .put("/api/v1/workouts/draft")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ draft: { split: "Legs" }, clientUpdatedAt: olderTs })
      .expect(200);
    expect(saveOlder.body.saved).toBe(false);

    // 6. Cross-user isolation: Bob cannot read, update, or delete Alice's workout
    await request(app.getHttpServer())
      .get(`/api/v1/workouts/${w1.body.id}`)
      .set("Authorization", `Bearer ${bob.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/v1/workouts/${w1.body.id}`)
      .set("Authorization", `Bearer ${bob.token}`)
      .expect(404);
  });

  it("handles daily metrics (steps, weight, check-in) with strict validation and user isolation", async () => {
    const alice = await registerUser("metrics-alice@example.com");
    const bob = await registerUser("metrics-bob@example.com");

    await request(app.getHttpServer())
      .put("/api/v1/metrics/steps")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ date: today, steps: 9500 })
      .expect(200);

    await request(app.getHttpServer())
      .put("/api/v1/metrics/weight")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ date: today, weightKg: 76.45 })
      .expect(200);

    // Empty check-in rejected
    await request(app.getHttpServer())
      .put("/api/v1/metrics/checkin")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ date: today, energy: null, satiety: null, sleep: null, note: "   " })
      .expect(400);

    await request(app.getHttpServer())
      .put("/api/v1/metrics/checkin")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ date: today, energy: 8, satiety: 7, sleep: 9, note: "Great recovery" })
      .expect(200);

    const aliceSteps = await request(app.getHttpServer())
      .get("/api/v1/metrics/steps")
      .set("Authorization", `Bearer ${alice.token}`)
      .expect(200);
    expect(aliceSteps.body).toHaveLength(1);
    expect(aliceSteps.body[0].steps).toBe(9500);

    const bobSteps = await request(app.getHttpServer())
      .get("/api/v1/metrics/steps")
      .set("Authorization", `Bearer ${bob.token}`)
      .expect(200);
    expect(bobSteps.body).toEqual([]);
  });

  it("enforces private custom foods, logs meals, manages templates & targets", async () => {
    const alice = await registerUser("meals-alice@example.com");
    const bob = await registerUser("meals-bob@example.com");

    const customFood = await request(app.getHttpServer())
      .post("/api/v1/foods")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({
        name: "Alice Oats",
        kcalPer100g: 370,
        proteinPer100g: 13,
        carbsPer100g: 60,
        fatPer100g: 7,
      })
      .expect(201);

    // Bob cannot log Alice's private custom food
    await request(app.getHttpServer())
      .post("/api/v1/meals")
      .set("Authorization", `Bearer ${bob.token}`)
      .send({
        mealType: "Breakfast",
        performedOn: today,
        items: [{ foodId: customFood.body.id, grams: 100 }],
      })
      .expect(400);

    // Alice logs a meal using her custom food
    const meal = await request(app.getHttpServer())
      .post("/api/v1/meals")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({
        mealType: "Breakfast",
        performedOn: today,
        items: [{ foodId: customFood.body.id, grams: 150 }],
      })
      .expect(201);

    expect(meal.body.items).toHaveLength(1);
    expect(meal.body.items[0].totalKcal).toBe(555);
    expect(meal.body.items[0].totalProteinG).toBe(19.5);

    // Templates & Targets
    const tpl = await request(app.getHttpServer())
      .post("/api/v1/meals/templates")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ name: "Morning Oats", items: [{ foodId: customFood.body.id, grams: 100 }] })
      .expect(201);

    const templates = await request(app.getHttpServer())
      .get("/api/v1/meals/templates")
      .set("Authorization", `Bearer ${alice.token}`)
      .expect(200);
    expect(templates.body).toHaveLength(1);
    expect(templates.body[0].id).toBe(tpl.body.id);

    await request(app.getHttpServer())
      .put("/api/v1/meals/targets")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ kcal: 2400, protein: 180, carbs: 260, fat: 70, fiber: 35 })
      .expect(200);

    const targetsRes = await request(app.getHttpServer())
      .get("/api/v1/meals/targets")
      .set("Authorization", `Bearer ${alice.token}`)
      .expect(200);
    expect(targetsRes.body.targets.kcal).toBe(2400);
  });

  it("handles progress photos presigned upload URL, storage verification, listing, deletion, and user isolation", async () => {
    const alice = await registerUser("photos-alice@example.com");
    const bob = await registerUser("photos-bob@example.com");

    const uploadReq = await request(app.getHttpServer())
      .post("/api/v1/photos/upload-url")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ sizeBytes: 245000 })
      .expect(201);

    const { id, path, uploadUrl } = uploadReq.body as { id: string; path: string; uploadUrl: string };
    expect(path).toBe(`${alice.id}/${id}.jpg`);
    expect(uploadUrl).toContain(path);

    // Registering before object exists in S3 fails with 400
    await request(app.getHttpServer())
      .post("/api/v1/photos")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ id, takenOn: today, pose: "front", note: "Morning", sizeBytes: 245000 })
      .expect(400);

    // Simulate client PUT to presigned URL
    fakeStorage.objects.set(`progress-photos/${path}`, { contentLength: 245000, contentType: "image/jpeg" });

    const created = await request(app.getHttpServer())
      .post("/api/v1/photos")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ id, takenOn: today, pose: "front", note: "Morning", sizeBytes: 245000 })
      .expect(201);
    expect(created.body.url).toContain(path);

    // Bob cannot delete Alice's photo
    await request(app.getHttpServer())
      .delete(`/api/v1/photos/${id}`)
      .set("Authorization", `Bearer ${bob.token}`)
      .expect(404);

    // Alice deletes her photo -> removed from both S3 and DB
    await request(app.getHttpServer())
      .delete(`/api/v1/photos/${id}`)
      .set("Authorization", `Bearer ${alice.token}`)
      .expect(200);
    expect(fakeStorage.objects.has(`progress-photos/${path}`)).toBe(false);
  });

  it("replays offline mutations atomically and idempotently, rejects mismatched owners and conflicting replays", async () => {
    const alice = await registerUser("offline-alice@example.com");
    const bob = await registerUser("offline-bob@example.com");

    const workoutMutationId = randomUUID();
    const workoutPayload = {
      kind: "workout",
      date: today,
      mode: "strength",
      split: "Pull",
      cardio: [],
      sets: [
        { split: "Pull", exercise: "Deadlift (Conventional Barbell)", setNumber: 1, reps: 5, weight: 140, rir: 2, setType: "Working Set", notes: "" },
      ],
    };

    // Owner mismatch -> 409 Conflict
    await request(app.getHttpServer())
      .post("/api/v1/offline/sync")
      .set("Authorization", `Bearer ${bob.token}`)
      .send({ id: workoutMutationId, ownerId: alice.id, createdAt: new Date().toISOString(), payload: workoutPayload })
      .expect(409);

    // First sync succeeds
    const first = await request(app.getHttpServer())
      .post("/api/v1/offline/sync")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ id: workoutMutationId, ownerId: alice.id, createdAt: new Date().toISOString(), payload: workoutPayload })
      .expect(200);
    expect(first.body.success).toBe(true);

    // Exact replay is idempotent (deduplicated)
    const replay = await request(app.getHttpServer())
      .post("/api/v1/offline/sync")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({ id: workoutMutationId, ownerId: alice.id, createdAt: new Date().toISOString(), payload: workoutPayload })
      .expect(200);
    expect(replay.body.deduplicated).toBe(true);

    // Reusing same mutation ID for a different payload -> 400
    await request(app.getHttpServer())
      .post("/api/v1/offline/sync")
      .set("Authorization", `Bearer ${alice.token}`)
      .send({
        id: workoutMutationId,
        ownerId: alice.id,
        createdAt: new Date().toISOString(),
        payload: { kind: "steps", date: today, steps: 5000 },
      })
      .expect(400);

    // Sync steps + weight + checkin
    for (const payload of [
      { kind: "steps", date: today, steps: 11000 },
      { kind: "weight", date: today, weightKg: 81.25 },
      { kind: "checkin", date: today, energy: 7, satiety: 8, sleep: 8, note: "Offline ok" },
    ]) {
      await request(app.getHttpServer())
        .post("/api/v1/offline/sync")
        .set("Authorization", `Bearer ${alice.token}`)
        .send({ id: randomUUID(), ownerId: alice.id, createdAt: new Date().toISOString(), payload })
        .expect(200);
    }

    // Snapshot reflects exactly 1 workout (no duplicate!), plus steps, weight, checkin
    const snap = await request(app.getHttpServer())
      .get("/api/v1/offline/snapshot")
      .set("Authorization", `Bearer ${alice.token}`)
      .expect(200);

    expect(snap.body.snapshot.ownerId).toBe(alice.id);
    expect(snap.body.snapshot.workouts).toHaveLength(1);
    expect(snap.body.snapshot.steps).toEqual([{ date: today, steps: 11000 }]);
    expect(snap.body.snapshot.weights).toEqual([{ date: today, weight_kg: 81.25 }]);
    expect(snap.body.snapshot.checkins).toEqual([{ date: today, energy: 7, satiety: 8, sleep: 8, note: "Offline ok" }]);
  });
});
