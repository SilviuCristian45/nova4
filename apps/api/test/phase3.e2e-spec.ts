import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { DataSource } from "typeorm";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.setup";
import { StorageService } from "../src/storage/storage.service";

class FakeStorageService {
  readonly objects = new Map<string, { contentLength: number; contentType?: string }>();
  failDeletePrefix = false;

  getProgressPhotosBucket() {
    return "progress-photos";
  }

  getCheckinPhotosBucket() {
    return "checkin-photos";
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
    return this.objects.get(`${bucket}/${key}`) ?? null;
  }

  async uploadObject(bucket: string, key: string, body: Buffer) {
    this.objects.set(`${bucket}/${key}`, { contentLength: body.length, contentType: "image/jpeg" });
  }

  async downloadObject() {
    return Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  }

  async deleteObject(bucket: string, key: string) {
    this.objects.delete(`${bucket}/${key}`);
  }

  async deleteObjects(bucket: string, keys: readonly string[]) {
    for (const key of keys) this.objects.delete(`${bucket}/${key}`);
  }

  async deleteUserPrefix(bucket: string, userId: string) {
    if (this.failDeletePrefix) {
      throw new Error("Simulated S3 outage");
    }
    const prefix = `${bucket}/${userId}/`;
    for (const fullKey of [...this.objects.keys()]) {
      if (fullKey.startsWith(prefix)) this.objects.delete(fullKey);
    }
  }
}

describe("Phase 3 E2E: Coach, MealPlans, Notifications, Account GDPR & Drive", () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fakeStorage: FakeStorageService;

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
    process.env.DRIVE_CRON_ENABLED = "false";
    process.env.CRON_SECRET = "phase3-test-cron-secret";
    delete process.env.GOOGLE_CLIENT_ID;

    fakeStorage = new FakeStorageService();

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
    fakeStorage.failDeletePrefix = false;
    await dataSource.query("TRUNCATE TABLE public.users, public.foods RESTART IDENTITY CASCADE");
  });

  it("enforces coach program invite flow, enrollment approval, ActiveCoachAccessGuard, nutrition share guard, feedback, and weekly check-ins", async () => {
    const coach = await registerUser("coach1@example.com", "coach", "Coach Dan");
    const otherCoach = await registerUser("coach2@example.com", "coach", "Coach Eve");
    const client = await registerUser("client1@example.com", "client", "Ana");

    // 1. Coach creates an invite-only program requiring approval
    const prog = await request(app.getHttpServer())
      .post("/api/v1/coach/programs")
      .set("Authorization", `Bearer ${coach.token}`)
      .send({
        title: "Hypertrophy Block",
        description: "4-week upper/lower",
        difficulty: "intermediate",
        durationWeeks: 4,
        goal: "hypertrophy",
        status: "published",
        accessType: "invite_only",
        requiresApproval: true,
        workouts: [
          {
            weekNumber: 1,
            dayNumber: 1,
            title: "Upper A",
            workoutMode: "strength",
            split: "Upper",
            exercises: [
              {
                exercise: "Bench Press (Barbell)",
                setType: "Working Set",
                targetSets: 3,
                targetRepsMin: 8,
                targetRepsMax: 10,
                targetRir: 2,
                targetWeightKg: 80,
                restSeconds: 120,
              },
            ],
            cardio: [],
          },
        ],
      })
      .expect(201);

    const inviteCode = prog.body.inviteCode as string;
    expect(inviteCode).toMatch(/^[A-Z0-9]{8}$/);

    // 2. Client previews by invite code and enrolls -> pending
    const preview = await request(app.getHttpServer())
      .get(`/api/v1/explore/invite/${inviteCode}`)
      .set("Authorization", `Bearer ${client.token}`)
      .expect(200);
    expect(preview.body.title).toBe("Hypertrophy Block");

    const enrolled = await request(app.getHttpServer())
      .post("/api/v1/explore/enroll")
      .set("Authorization", `Bearer ${client.token}`)
      .send({ programId: prog.body.id, inviteCode, shareNutrition: false })
      .expect(201);
    expect(enrolled.body.status).toBe("pending");

    // Pending enrollment does NOT grant coach access to client detail
    await request(app.getHttpServer())
      .get(`/api/v1/coach/clients/${client.id}`)
      .set("Authorization", `Bearer ${coach.token}`)
      .expect(403);

    // 3. Coach approves enrollment -> active
    await request(app.getHttpServer())
      .post(`/api/v1/coach/enrollments/${enrolled.body.id}/respond`)
      .set("Authorization", `Bearer ${coach.token}`)
      .send({ decision: "active" })
      .expect(200);

    // Unrelated coach still gets 403
    await request(app.getHttpServer())
      .get(`/api/v1/coach/clients/${client.id}`)
      .set("Authorization", `Bearer ${otherCoach.token}`)
      .expect(403);

    // Active coach can read client detail & save private note
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/coach/clients/${client.id}`)
      .set("Authorization", `Bearer ${coach.token}`)
      .expect(200);
    expect(detail.body.client.displayName).toBe("Ana");

    await request(app.getHttpServer())
      .put(`/api/v1/coach/clients/${client.id}/note`)
      .set("Authorization", `Bearer ${coach.token}`)
      .send({ note: "Private coach note — never exported to client!" })
      .expect(200);

    // Nutrition sharing is FALSE -> 403 for coach
    await request(app.getHttpServer())
      .get(`/api/v1/coach/clients/${client.id}/nutrition`)
      .set("Authorization", `Bearer ${coach.token}`)
      .expect(403);

    // Client enables shareNutrition -> 200 for coach
    await request(app.getHttpServer())
      .patch(`/api/v1/explore/enrollments/${enrolled.body.id}/nutrition`)
      .set("Authorization", `Bearer ${client.token}`)
      .send({ shareNutrition: true })
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/coach/clients/${client.id}/nutrition`)
      .set("Authorization", `Bearer ${coach.token}`)
      .expect(200);

    // 4. Client logs workout -> Coach leaves feedback -> Client gets notification
    const workout = await request(app.getHttpServer())
      .post("/api/v1/workouts")
      .set("Authorization", `Bearer ${client.token}`)
      .send({
        mode: "strength",
        split: "Upper",
        date: today,
        sets: [
          { split: "Upper", exercise: "Bench Press (Barbell)", setNumber: 1, reps: 8, weight: 60, rir: 2, setType: "Working Set" },
        ],
        cardio: [],
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/feedback/workouts/${workout.body.id}`)
      .set("Authorization", `Bearer ${coach.token}`)
      .send({ body: "Great bar path!", reaction: "fire" })
      .expect(201);

    // 5. Weekly check-in with check-in photo -> Coach reviews -> Client locked from editing
    const upload = await request(app.getHttpServer())
      .post("/api/v1/checkins/weekly/photo-upload-url")
      .set("Authorization", `Bearer ${client.token}`)
      .send({ sizeBytes: 150000 })
      .expect(201);
    fakeStorage.objects.set(`checkin-photos/${upload.body.path}`, { contentLength: 150000 });

    const checkin = await request(app.getHttpServer())
      .post("/api/v1/checkins/weekly")
      .set("Authorization", `Bearer ${client.token}`)
      .send({
        coachId: coach.id,
        enrollmentId: enrolled.body.id,
        weightKg: 62.5,
        energy: 4,
        sleep: 5,
        stress: 2,
        clientNotes: "Feeling strong",
        photoFrontPath: upload.body.path,
      })
      .expect(201);
    expect(checkin.body.photoUrls.front).toContain(upload.body.path);

    const reviewed = await request(app.getHttpServer())
      .post(`/api/v1/checkins/weekly/${checkin.body.id}/review`)
      .set("Authorization", `Bearer ${coach.token}`)
      .send({ reply: "Awesome progress, keep protein high!" })
      .expect(200);
    expect(reviewed.body.coachReply).toBe("Awesome progress, keep protein high!");

    // Re-submitting same week after review is blocked (400)
    await request(app.getHttpServer())
      .post("/api/v1/checkins/weekly")
      .set("Authorization", `Bearer ${client.token}`)
      .send({
        coachId: coach.id,
        enrollmentId: enrolled.body.id,
        weightKg: 62.0,
        energy: 4,
        sleep: 4,
        stress: 2,
      })
      .expect(400);

    // Client notifications include approval, feedback, and check-in review
    const unread = await request(app.getHttpServer())
      .get("/api/v1/notifications/unread")
      .set("Authorization", `Bearer ${client.token}`)
      .expect(200);
    expect(unread.body.count).toBeGreaterThanOrEqual(3);

    await request(app.getHttpServer())
      .post("/api/v1/notifications/read-all")
      .set("Authorization", `Bearer ${client.token}`)
      .expect(200);

    const unreadAfter = await request(app.getHttpServer())
      .get("/api/v1/notifications/unread")
      .set("Authorization", `Bearer ${client.token}`)
      .expect(200);
    expect(unreadAfter.body.count).toBe(0);
  });

  it("handles coach meal plans, clone for client, 1-click log, apply targets, and zero-PII revocable public share links", async () => {
    const coach = await registerUser("mp-coach@example.com", "coach", "Coach Maria");
    const client = await registerUser("mp-client@example.com", "client", "Ion");

    await dataSource.query(
      `INSERT INTO public.enrollments (client_id, coach_id, status) VALUES ($1, $2, 'active')`,
      [client.id, coach.id],
    );

    const tpl = await request(app.getHttpServer())
      .post("/api/v1/coach/meal-plans")
      .set("Authorization", `Bearer ${coach.token}`)
      .send({
        title: "Lean Cut 2000",
        goal: "fat_loss",
        status: "draft",
        targetKcal: 2000,
        targetProteinG: 165,
        targetCarbsG: 190,
        targetFatG: 60,
        targetFiberG: 30,
        waterLiters: 3.0,
        days: [
          {
            title: "Training Day",
            meals: [
              {
                mealType: "Meal",
                title: "Meal 1",
                timeLabel: "08:00",
                items: [
                  {
                    name: "Oats",
                    brand: "Bio",
                    grams: 80,
                    kcalPer100g: 370,
                    proteinPer100g: 13.5,
                    carbsPer100g: 60,
                    fatPer100g: 7,
                    fiberPer100g: 10,
                  },
                ],
              },
            ],
          },
        ],
      })
      .expect(201);

    // Clone for client -> active & assigned
    const cloned = await request(app.getHttpServer())
      .post(`/api/v1/coach/meal-plans/${tpl.body.id}/clone`)
      .set("Authorization", `Bearer ${coach.token}`)
      .send({ clientId: client.id })
      .expect(201);

    const clientPlans = await request(app.getHttpServer())
      .get("/api/v1/meals/plan")
      .set("Authorization", `Bearer ${client.token}`)
      .expect(200);
    expect(clientPlans.body).toHaveLength(1);
    const planMealId = clientPlans.body[0].days[0].meals[0].id as string;

    // 1-click log meal today + apply targets
    await request(app.getHttpServer())
      .post(`/api/v1/meals/plan/meals/${planMealId}/log`)
      .set("Authorization", `Bearer ${client.token}`)
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/meals/plan/${cloned.body.id}/apply-targets`)
      .set("Authorization", `Bearer ${client.token}`)
      .expect(200);

    const targets = await request(app.getHttpServer())
      .get("/api/v1/meals/targets")
      .set("Authorization", `Bearer ${client.token}`)
      .expect(200);
    expect(targets.body.targets.kcal).toBe(2000);

    // Enable share link -> unauthenticated public access returns plan with ZERO client PII
    const shareOn = await request(app.getHttpServer())
      .post(`/api/v1/coach/meal-plans/${cloned.body.id}/share-link`)
      .set("Authorization", `Bearer ${coach.token}`)
      .send({ enable: true })
      .expect(200);
    const token = shareOn.body.shareToken as string;
    expect(token.length).toBeGreaterThanOrEqual(16);

    const publicPlan = await request(app.getHttpServer())
      .get(`/api/v1/public/meal-plans/${token}`)
      .expect(200);
    expect(publicPlan.body.title).toBe("Lean Cut 2000");
    expect(publicPlan.body.coachName).toBe("Coach Maria");
    expect(publicPlan.body.assignedClientId).toBeUndefined();
    expect(publicPlan.body.clientName).toBeUndefined();
    expect(publicPlan.body.shareToken).toBeUndefined();

    // Revoke share link -> 404
    await request(app.getHttpServer())
      .post(`/api/v1/coach/meal-plans/${cloned.body.id}/share-link`)
      .set("Authorization", `Bearer ${coach.token}`)
      .send({ enable: false })
      .expect(200);

    await request(app.getHttpServer()).get(`/api/v1/public/meal-plans/${token}`).expect(404);
  });

  it("handles GDPR export -> import round-trip, S3-first abort-on-error, full account erasure, and Drive cron auth", async () => {
    const source = await registerUser("gdpr-src@example.com", "client", "Source");
    const target = await registerUser("gdpr-dst@example.com", "client", "Dest");

    // Populate source account with workout, weight, steps, checkin, and a progress photo in S3
    await request(app.getHttpServer())
      .post("/api/v1/workouts")
      .set("Authorization", `Bearer ${source.token}`)
      .send({
        mode: "strength",
        split: "Legs",
        date: today,
        sets: [
          { split: "Legs", exercise: "Squat (Barbell - High Bar)", setNumber: 1, reps: 5, weight: 100, rir: 2, setType: "Working Set" },
        ],
        cardio: [],
      })
      .expect(201);

    await request(app.getHttpServer())
      .put("/api/v1/metrics/steps")
      .set("Authorization", `Bearer ${source.token}`)
      .send({ date: today, steps: 12345 })
      .expect(200);

    const photoReq = await request(app.getHttpServer())
      .post("/api/v1/photos/upload-url")
      .set("Authorization", `Bearer ${source.token}`)
      .send({ sizeBytes: 120000 })
      .expect(201);
    fakeStorage.objects.set(`progress-photos/${photoReq.body.path}`, { contentLength: 120000 });
    await request(app.getHttpServer())
      .post("/api/v1/photos")
      .set("Authorization", `Bearer ${source.token}`)
      .send({ id: photoReq.body.id, takenOn: today, pose: "front", sizeBytes: 120000 })
      .expect(201);

    // 1. Export -> Import round-trip
    const exported = await request(app.getHttpServer())
      .get("/api/v1/account/export")
      .set("Authorization", `Bearer ${source.token}`)
      .expect(200);

    expect(exported.body.format).toBe("replog-export");
    expect(exported.body.version).toBe(1);
    expect(exported.body.workouts).toHaveLength(1);
    expect(exported.body.progress_photos).toHaveLength(1);

    const imported = await request(app.getHttpServer())
      .post("/api/v1/account/import")
      .set("Authorization", `Bearer ${target.token}`)
      .send({ data: exported.body })
      .expect(200);
    expect(imported.body.counts.workouts).toBe(1);
    expect(imported.body.counts.workout_sets).toBe(1);
    expect(imported.body.counts.daily_steps).toBe(1);

    // 2. S3 deletion failure MUST abort DB deletion
    fakeStorage.failDeletePrefix = true;
    await request(app.getHttpServer())
      .delete("/api/v1/account/data")
      .set("Authorization", `Bearer ${source.token}`)
      .send({ confirmEmail: "gdpr-src@example.com" })
      .expect(500);

    const workoutsStillPresent = await request(app.getHttpServer())
      .get("/api/v1/workouts")
      .set("Authorization", `Bearer ${source.token}`)
      .expect(200);
    expect(workoutsStillPresent.body.total).toBe(1);

    // 3. Full account deletion wipes S3 objects first, then cascades DB rows
    fakeStorage.failDeletePrefix = false;
    await request(app.getHttpServer())
      .delete("/api/v1/account")
      .set("Authorization", `Bearer ${source.token}`)
      .send({ confirmEmail: "gdpr-src@example.com" })
      .expect(200);

    expect(fakeStorage.objects.has(`progress-photos/${photoReq.body.path}`)).toBe(false);
    const remainingUsers = await dataSource.query(`SELECT id FROM public.users WHERE id = $1`, [source.id]);
    expect(remainingUsers).toHaveLength(0);

    // 4. Drive status (unconfigured) & cron endpoint secret check
    const driveStatus = await request(app.getHttpServer())
      .get("/api/v1/drive/status")
      .set("Authorization", `Bearer ${target.token}`)
      .expect(200);
    expect(driveStatus.body.configured).toBe(false);

    await request(app.getHttpServer()).post("/api/v1/drive/cron").expect(401);
    await request(app.getHttpServer())
      .post("/api/v1/drive/cron")
      .set("Authorization", "Bearer wrong-secret")
      .expect(401);
    const cronOk = await request(app.getHttpServer())
      .post("/api/v1/drive/cron")
      .set("Authorization", "Bearer phase3-test-cron-secret")
      .expect(200);
    expect(cronOk.body).toEqual({ uploaded: 0, failed: 0, skipped: 0, remaining: 0 });
  });
});
