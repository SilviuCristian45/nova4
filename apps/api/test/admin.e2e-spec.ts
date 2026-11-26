import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { DataSource } from "typeorm";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.setup";
import { StorageService } from "../src/storage/storage.service";

class FakeAdminStorageService {
  readonly deletedUsers: string[] = [];

  getProgressPhotosBucket() {
    return "progress-photos";
  }

  getCheckinPhotosBucket() {
    return "checkin-photos";
  }

  async deleteUserPrefix(bucket: string, userId: string) {
    this.deletedUsers.push(`${bucket}/${userId}`);
  }
}

describe("Admin E2E: Super Admin User Management & Disable Enforcement", () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fakeStorage: FakeAdminStorageService;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "test-jwt-secret-at-least-32-chars-long";
    process.env.COOKIE_SECURE = "false";
    process.env.COACH_SELF_SERVE = "true";
    process.env.THROTTLE_LIMIT = "1000";
    process.env.SUPER_ADMIN_EMAILS = "superadmin@example.com";
    process.env.DISABLE_SIGNUP = "false";

    fakeStorage = new FakeAdminStorageService();

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
    delete process.env.SUPER_ADMIN_EMAILS;
    delete process.env.DISABLE_SIGNUP;
    if (app) await app.close();
  });

  beforeEach(async () => {
    fakeStorage.deletedUsers.length = 0;
    process.env.DISABLE_SIGNUP = "false";
    await dataSource.query("TRUNCATE TABLE public.users, public.foods RESTART IDENTITY CASCADE");
  });

  it("enforces SuperAdminGuard and supports create, edit, disable/enable, reset-password, and GDPR delete", async () => {
    // 1. Register super admin and a regular user
    const adminReg = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: "superadmin@example.com", password: "AdminPassword123!", displayName: "Boss" })
      .expect(201);
    expect(adminReg.body.user.isSuperAdmin).toBe(true);
    const adminToken = adminReg.body.accessToken as string;
    const adminId = adminReg.body.user.id as string;

    const regularReg = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email: "alice@example.com", password: "AlicePassword123!", displayName: "Alice" })
      .expect(201);
    expect(regularReg.body.user.isSuperAdmin).toBe(false);
    const regularToken = regularReg.body.accessToken as string;

    // 2. Non-super-admin is rejected with 403
    await request(app.getHttpServer())
      .get("/api/v1/admin/users")
      .set("Authorization", `Bearer ${regularToken}`)
      .expect(403);

    // 3. Super admin can list users and create a user even when DISABLE_SIGNUP=true
    process.env.DISABLE_SIGNUP = "true";
    const createdRes = await request(app.getHttpServer())
      .post("/api/v1/admin/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        email: "bob@example.com",
        password: "BobPassword123!",
        displayName: "Bob",
        role: "client",
        weightUnit: "lb",
        dailyStepsGoal: 12000,
      })
      .expect(201);
    const bobId = createdRes.body.id as string;
    expect(createdRes.body.email).toBe("bob@example.com");
    expect(createdRes.body.weightUnit).toBe("lb");
    expect(createdRes.body.dailyStepsGoal).toBe(12000);
    expect(createdRes.body.disabled).toBe(false);

    // 4. Bob can sign in
    const bobLogin = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: "bob@example.com", password: "BobPassword123!" })
      .expect(200);
    const bobToken = bobLogin.body.accessToken as string;
    const bobRefresh = bobLogin.body.refreshToken as string;

    // 5. Super admin edits Bob (promotes to coach + updates displayName)
    const editedRes = await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${bobId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ displayName: "Coach Bob", role: "coach", weightUnit: "kg" })
      .expect(200);
    expect(editedRes.body.displayName).toBe("Coach Bob");
    expect(editedRes.body.role).toBe("coach");
    expect(editedRes.body.weightUnit).toBe("kg");

    // 6. Super admin disables Bob -> immediate lockout on access token, refresh token, and login
    const disabledRes = await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${bobId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ disabled: true })
      .expect(200);
    expect(disabledRes.body.disabled).toBe(true);

    await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${bobToken}`)
      .expect(401);

    await request(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: bobRefresh })
      .expect(401);

    await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: "bob@example.com", password: "BobPassword123!" })
      .expect(403);

    // 7. Super admin re-enables Bob and resets his password
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${bobId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ disabled: false })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/users/${bobId}/reset-password`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ newPassword: "NewBobPassword456!" })
      .expect(200);

    await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: "bob@example.com", password: "BobPassword123!" })
      .expect(401);

    await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: "bob@example.com", password: "NewBobPassword456!" })
      .expect(200);

    // 8. Self-protection: super admin cannot disable or delete themselves
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${adminId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ disabled: true })
      .expect(400);

    await request(app.getHttpServer())
      .delete(`/api/v1/admin/users/${adminId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(400);

    // 9. Super admin deletes Bob -> purges both S3 buckets & removes DB row
    await request(app.getHttpServer())
      .delete(`/api/v1/admin/users/${bobId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(fakeStorage.deletedUsers).toEqual([`progress-photos/${bobId}`, `checkin-photos/${bobId}`]);

    const listAfter = await request(app.getHttpServer())
      .get("/api/v1/admin/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(listAfter.body.stats.total).toBe(2);
  });
});
