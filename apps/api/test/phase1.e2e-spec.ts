import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import request from "supertest";
import { DataSource } from "typeorm";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.setup";
import { UserEntity } from "../src/database/entities";

const EXPECTED_TABLES = [
  "cardio_sessions",
  "coach_client_notes",
  "coach_profiles",
  "daily_checkin",
  "daily_steps",
  "daily_weight",
  "enrollments",
  "foods",
  "google_drive_backups",
  "meal_items",
  "meal_plan_days",
  "meal_plan_items",
  "meal_plan_meals",
  "meal_plans",
  "meal_templates",
  "meals",
  "notifications",
  "offline_sync_receipts",
  "profiles",
  "program_workout_cardio",
  "program_workout_exercises",
  "program_workouts",
  "programs",
  "progress_photos",
  "refresh_tokens",
  "user_targets",
  "users",
  "weekly_checkins",
  "workout_drafts",
  "workout_feedback",
  "workout_sets",
  "workouts",
];

describe("Phase 1 E2E: Schema, Auth, RBAC & Profiles", () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "test-jwt-secret-at-least-32-chars-long";
    process.env.COOKIE_SECURE = "false";
    process.env.COACH_SELF_SERVE = "true";
    process.env.THROTTLE_LIMIT = "1000";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app, { enableSwagger: true });
    await app.init();

    dataSource = app.get(DataSource);
    await dataSource.runMigrations();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(async () => {
    await dataSource.query("TRUNCATE TABLE public.users RESTART IDENTITY CASCADE");
  });

  it("creates all 32 PostgreSQL tables via TypeORM InitialSchema migration and responds on /health", async () => {
    const rows: { tablename: string }[] = await dataSource.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> 'migrations'
      ORDER BY tablename ASC
    `);
    expect(rows.map((r) => r.tablename)).toEqual(EXPECTED_TABLES);

    const health = await request(app.getHttpServer()).get("/api/v1/health").expect(200);
    expect(health.body.status).toBe("ok");
  });

  it("registers a client, sets HttpOnly cookies, enforces unique email, and serves /auth/me", async () => {
    const agent = request.agent(app.getHttpServer());

    const reg = await agent
      .post("/api/v1/auth/register")
      .send({ email: "Alice@Example.com", password: "Password123!", displayName: "Alice" })
      .expect(201);

    expect(reg.body.user.email).toBe("alice@example.com");
    expect(reg.body.user.profile.role).toBe("client");
    expect(reg.body.user.profile.displayName).toBe("Alice");
    expect(reg.body.user.profile.weightUnit).toBe("kg");
    expect(reg.body.user.coachProfile).toBeNull();
    expect(typeof reg.body.accessToken).toBe("string");
    expect(typeof reg.body.refreshToken).toBe("string");

    const setCookies = reg.headers["set-cookie"] as unknown as string[];
    expect(setCookies.some((c) => c.startsWith("replog_access_token=") && c.includes("HttpOnly"))).toBe(true);
    expect(setCookies.some((c) => c.startsWith("replog_refresh_token=") && c.includes("HttpOnly"))).toBe(true);
    expect(setCookies.some((c) => c.startsWith("weight_unit=kg"))).toBe(true);

    // Duplicate email (case-insensitive) -> 409 Conflict
    await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: "ALICE@example.com", password: "Password123!" })
      .expect(409);

    // Cookie auth works on /auth/me
    const meCookie = await agent.get("/api/v1/auth/me").expect(200);
    expect(meCookie.body.email).toBe("alice@example.com");

    // Bearer auth works on /auth/me
    const meBearer = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${reg.body.accessToken}`)
      .expect(200);
    expect(meBearer.body.id).toBe(reg.body.user.id);

    // Unauthenticated -> 401
    await request(app.getHttpServer()).get("/api/v1/auth/me").expect(401);
  });

  it("rotates refresh tokens, detects replay reuse across the token family, and supports logout", async () => {
    const reg = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: "bob@example.com", password: "Password123!" })
      .expect(201);

    const token1 = reg.body.refreshToken as string;

    const refreshed = await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: token1 })
      .expect(200);

    const token2 = refreshed.body.refreshToken as string;
    expect(token2).not.toBe(token1);

    // Replaying revoked token1 must fail AND revoke token2 (entire family)
    await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: token1 })
      .expect(401);

    await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: token2 })
      .expect(401);

    // Fresh login + logout revokes session
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: "bob@example.com", password: "Password123!" })
      .expect(200);

    await request(app.getHttpServer())
      .post("/api/v1/auth/logout")
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);

    await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);
  });

  it("transparently upgrades legacy Supabase bcrypt hashes to Argon2id on login", async () => {
    const legacyHash = await bcrypt.hash("LegacySecret99!", 10);
    const [inserted] = await dataSource.query(
      `INSERT INTO public.users (email, password_hash) VALUES ('legacy@example.com', $1) RETURNING id`,
      [legacyHash],
    );
    await dataSource.query(`INSERT INTO public.profiles (id) VALUES ($1)`, [inserted.id]);

    await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: "legacy@example.com", password: "WrongPassword!" })
      .expect(401);

    const ok = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: "legacy@example.com", password: "LegacySecret99!" })
      .expect(200);

    expect(ok.body.user.email).toBe("legacy@example.com");

    const updatedUser = await dataSource.getRepository(UserEntity).findOneByOrFail({ id: inserted.id });
    expect(updatedUser.passwordHash.startsWith("$argon2id$")).toBe(true);
  });

  it("updates password (revoking prior refresh tokens) and updates email", async () => {
    const reg = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: "carol@example.com", password: "InitialPassword1!" })
      .expect(201);

    const bearer = reg.body.accessToken as string;
    const oldRefresh = reg.body.refreshToken as string;

    await request(app.getHttpServer())
      .patch("/api/v1/auth/password")
      .set("Authorization", `Bearer ${bearer}`)
      .send({ currentPassword: "WrongPassword", newPassword: "NewPassword123!" })
      .expect(401);

    await request(app.getHttpServer())
      .patch("/api/v1/auth/password")
      .set("Authorization", `Bearer ${bearer}`)
      .send({ currentPassword: "InitialPassword1!", newPassword: "NewPassword123!" })
      .expect(200);

    // Prior refresh token was revoked
    await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: oldRefresh })
      .expect(401);

    // Login with new password succeeds
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: "carol@example.com", password: "NewPassword123!" })
      .expect(200);

    // Update email
    const emailRes = await request(app.getHttpServer())
      .patch("/api/v1/auth/email")
      .set("Authorization", `Bearer ${login.body.accessToken}`)
      .send({ email: "carol.new@example.com", currentPassword: "NewPassword123!" })
      .expect(200);
    expect(emailRes.body.email).toBe("carol.new@example.com");
  });

  it("enforces profile validation, blocks role escalation via PATCH /profile, and supports Coach activation + /coach-profile", async () => {
    const reg = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: "dan@example.com", password: "Password123!" })
      .expect(201);

    const token = reg.body.accessToken as string;

    // Attempting to pass `role` on PATCH /profile is rejected by ValidationPipe (forbidNonWhitelisted)
    await request(app.getHttpServer())
      .patch("/api/v1/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ role: "coach" })
      .expect(400);

    // Out-of-bounds height -> 400
    await request(app.getHttpServer())
      .patch("/api/v1/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({ heightCm: 350 })
      .expect(400);

    // Valid profile update + weight_unit cookie mirror
    const updated = await request(app.getHttpServer())
      .patch("/api/v1/profile")
      .set("Authorization", `Bearer ${token}`)
      .send({
        displayName: "Dan Pop",
        heightCm: 181.5,
        birthDate: "1994-05-12",
        sex: "male",
        weightUnit: "lb",
        dailyStepsGoal: 12000,
        activityLevel: "moderate",
        goalKgPerWeek: -0.25,
      })
      .expect(200);

    expect(updated.body).toMatchObject({
      role: "client",
      displayName: "Dan Pop",
      heightCm: 181.5,
      birthDate: "1994-05-12",
      sex: "male",
      weightUnit: "lb",
      dailyStepsGoal: 12000,
      activityLevel: "moderate",
      goalKgPerWeek: -0.25,
    });
    const profileCookies = updated.headers["set-cookie"] as unknown as string[];
    expect(profileCookies.some((c) => c.startsWith("weight_unit=lb"))).toBe(true);

    // Client cannot access coach-profile -> 403
    await request(app.getHttpServer())
      .get("/api/v1/coach-profile")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);

    // Activate coach role -> 200 and creates coach_profile
    const activated = await request(app.getHttpServer())
      .post("/api/v1/auth/activate-coach")
      .set("Authorization", `Bearer ${token}`)
      .send({ displayName: "Coach Dan" })
      .expect(200);

    expect(activated.body.user.profile.role).toBe("coach");
    expect(activated.body.user.coachProfile.displayName).toBe("Coach Dan");
    const coachToken = activated.body.accessToken as string;

    // Now coach-profile GET & PUT succeed and normalize specialties via @replog/shared
    const coachProfile = await request(app.getHttpServer())
      .put("/api/v1/coach-profile")
      .set("Authorization", `Bearer ${coachToken}`)
      .send({
        displayName: "Coach Dan Pro",
        bio: "Powerlifting & hypertrophy",
        specialties: ["Hypertrophy", "Strength", "hypertrophy", "Fat Loss"],
        isPublic: true,
        acceptingClients: true,
      })
      .expect(200);

    expect(coachProfile.body).toMatchObject({
      displayName: "Coach Dan Pro",
      bio: "Powerlifting & hypertrophy",
      specialties: ["Hypertrophy", "Strength", "Fat Loss"],
      isPublic: true,
      acceptingClients: true,
    });
  });

  it("respects COACH_SELF_SERVE=false on register and activate-coach", async () => {
    const prev = process.env.COACH_SELF_SERVE;
    process.env.COACH_SELF_SERVE = "false";
    try {
      await request(app.getHttpServer())
        .post("/api/v1/auth/register")
        .send({ email: "blocked@example.com", password: "Password123!", role: "coach" })
        .expect(403);

      const client = await request(app.getHttpServer())
        .post("/api/v1/auth/register")
        .send({ email: "client@example.com", password: "Password123!" })
        .expect(201);

      await request(app.getHttpServer())
        .post("/api/v1/auth/activate-coach")
        .set("Authorization", `Bearer ${client.body.accessToken}`)
        .send({ displayName: "Nope" })
        .expect(403);
    } finally {
      process.env.COACH_SELF_SERVE = prev;
    }
  });
});
