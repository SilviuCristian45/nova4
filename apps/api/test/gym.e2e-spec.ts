import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { firstValueFrom, filter, timeout } from "rxjs";
import request from "supertest";
import { DataSource } from "typeorm";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.setup";
import { GymSseService, type GymCheckinLiveEvent } from "../src/modules/gym/gym-sse.service";
import { GymService } from "../src/modules/gym/gym.service";
import { StorageService } from "../src/storage/storage.service";

const stubStorageService = {
  getProgressPhotosBucket: () => "progress-photos",
  getCheckinPhotosBucket: () => "checkin-photos",
  deleteUserPrefix: async () => {},
};

async function registerUser(
  app: INestApplication,
  email: string,
  displayName: string,
): Promise<{ agent: ReturnType<typeof request.agent>; userId: string; accessToken: string }> {
  const agent = request.agent(app.getHttpServer());
  const res = await agent
    .post("/api/v1/auth/register")
    .send({ email, password: "Password123!", displayName })
    .expect(201);
  return {
    agent,
    userId: res.body.user.id as string,
    accessToken: res.body.accessToken as string,
  };
}

describe("Gym Management + QR Check-in + Memberships E2E", () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let gymService: GymService;
  let gymSse: GymSseService;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET =
      process.env.JWT_ACCESS_SECRET || "test-jwt-secret-at-least-32-chars-long";
    process.env.COOKIE_SECURE = "false";
    process.env.COACH_SELF_SERVE = "true";
    process.env.THROTTLE_LIMIT = "1000";
    process.env.SUPER_ADMIN_EMAILS = "superadmin@replog.test";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StorageService)
      .useValue(stubStorageService)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app, { enableSwagger: false });
    await app.init();

    dataSource = app.get(DataSource);
    gymService = app.get(GymService);
    gymSse = app.get(GymSseService);
    await dataSource.runMigrations();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(async () => {
    await dataSource.query("TRUNCATE TABLE public.gyms, public.users RESTART IDENTITY CASCADE");
  });

  it("enforces multi-gym isolation, role RBAC, QR rotation, cooldown, concurrency, freeze, hours, SSE, cron, and GDPR", async () => {
    const superAdmin = await registerUser(app, "superadmin@replog.test", "Super Admin");
    const ownerA = await registerUser(app, "ownera@replog.test", "Owner A");
    const ownerB = await registerUser(app, "ownerb@replog.test", "Owner B");
    const receptionA = await registerUser(app, "receptiona@replog.test", "Reception A");
    const member = await registerUser(app, "member1@replog.test", "Ionut Pop");

    // 1. Non-super-admin blocked from /admin/gyms
    await ownerA.agent
      .post("/api/v1/admin/gyms")
      .send({ name: "Unauthorized Gym" })
      .expect(403);

    // 2. Super Admin creates Gym A and Gym B
    const gymARes = await superAdmin.agent
      .post("/api/v1/admin/gyms")
      .send({
        name: "Iron Gym A",
        address: "Str. Libertatii 1",
        timezone: "Europe/Bucharest",
        currency: "RON",
        checkinCooldownMinutes: 15,
        ownerUserId: ownerA.userId,
      })
      .expect(201);
    const gymAId = gymARes.body.id as string;

    const gymBRes = await superAdmin.agent
      .post("/api/v1/admin/gyms")
      .send({
        name: "Power Gym B",
        ownerUserId: ownerB.userId,
      })
      .expect(201);
    const gymBId = gymBRes.body.id as string;

    // 3. Multi-gym isolation: Owner A gets 403 on Gym B
    await ownerA.agent.get(`/api/v1/gym/${gymBId}/members`).expect(403);
    await ownerA.agent.get(`/api/v1/gym/${gymBId}/qr`).expect(403);
    await ownerA.agent.get(`/api/v1/gym/${gymBId}/checkins`).expect(403);

    // 4. Owner A adds Reception A staff; Reception A cannot create plans or rotate QR
    await ownerA.agent
      .post(`/api/v1/gym/${gymAId}/staff`)
      .send({ email: "receptiona@replog.test", role: "reception" })
      .expect(201);

    await receptionA.agent
      .post(`/api/v1/gym/${gymAId}/plans`)
      .send({ name: "Bad Plan", planType: "time_based", durationDays: 30, priceCents: 10000 })
      .expect(403);

    await receptionA.agent.post(`/api/v1/gym/${gymAId}/qr/rotate`).expect(403);
    await receptionA.agent.get(`/api/v1/gym/${gymAId}/audit`).expect(403);

    // 5. Owner A creates a session_pack plan (2 sessions) and a Day Time plan with freeze
    const packPlanRes = await ownerA.agent
      .post(`/api/v1/gym/${gymAId}/plans`)
      .send({
        name: "Pack 2 Sessions",
        planType: "session_pack",
        durationDays: 30,
        sessionCount: 2,
        priceCents: 8000,
        maxFreezeDays: 0,
      })
      .expect(201);
    const packPlanId = packPlanRes.body.id as string;

    const dayPlanRes = await ownerA.agent
      .post(`/api/v1/gym/${gymAId}/plans`)
      .send({
        name: "Day Time 07-16",
        planType: "time_based",
        durationDays: 30,
        priceCents: 18000,
        allowedFromTime: "07:00",
        allowedToTime: "16:00",
        allowedDaysMask: 127,
        maxFreezeDays: 10,
      })
      .expect(201);
    const dayPlanId = dayPlanRes.body.id as string;

    // Fetch Gym A QR info
    const qrRes = await ownerA.agent.get(`/api/v1/gym/${gymAId}/qr`).expect(200);
    const originalQrToken = qrRes.body.qrToken as string;

    // 6. Member not yet enrolled -> denied_not_member
    const notMemberScan = await member.agent
      .post("/api/v1/gym/checkins/scan")
      .send({ qrToken: `https://replog.ro/gym/scan?code=${originalQrToken}` })
      .expect(200);
    expect(notMemberScan.body.outcome).toBe("denied_not_member");

    // 7. Reception A enrolls member (and also verifies creating a brand-new account works)
    const enrollRes = await receptionA.agent
      .post(`/api/v1/gym/${gymAId}/members`)
      .send({ email: "member1@replog.test", phone: "+40700111222" })
      .expect(201);
    const memberId = enrollRes.body.id as string;
    expect(enrollRes.body.memberCode).toMatch(/^MEM-/);

    const newAcctMember = await receptionA.agent
      .post(`/api/v1/gym/${gymAId}/members`)
      .send({ email: "walkin@replog.test", displayName: "Walk In" })
      .expect(201);
    expect(newAcctMember.body.createdNewAccount).toBe(true);
    expect(typeof newAcctMember.body.generatedPassword).toBe("string");

    // Member enrolled without subscription -> denied_no_subscription
    const noSubScan = await member.agent
      .post("/api/v1/gym/checkins/scan")
      .send({ qrToken: originalQrToken })
      .expect(200);
    expect(noSubScan.body.outcome).toBe("denied_no_subscription");

    // 8. Reception A activates 2-session pack + cash payment
    const subRes = await receptionA.agent
      .post(`/api/v1/gym/${gymAId}/subscriptions`)
      .send({
        memberId,
        planId: packPlanId,
        recordPayment: true,
        paymentMethod: "cash",
      })
      .expect(201);
    expect(subRes.body.payment.amountCents).toBe(8000);

    // Subscribe to live SSE stream before scanning
    const ssePromise = firstValueFrom(
      gymSse.subscribe(gymAId).pipe(
        filter((ev) => ev.type === "checkin"),
        timeout(3000),
      ),
    );

    // First scan -> allowed (sessionsAfter = 1)
    const firstScan = await member.agent
      .post("/api/v1/gym/checkins/scan")
      .send({ qrToken: originalQrToken })
      .expect(200);
    expect(firstScan.body.outcome).toBe("allowed");
    expect(firstScan.body.sessionsAfter).toBe(1);
    expect(firstScan.body.expiringSoon).toBe(true);

    const liveEv = await ssePromise;
    expect((liveEv.data as GymCheckinLiveEvent).outcome).toBe("allowed");
    expect((liveEv.data as GymCheckinLiveEvent).memberEmail).toBe("member1@replog.test");

    // Second immediate scan within 15-min cooldown -> denied_duplicate & does NOT decrement session!
    const dupScan = await member.agent
      .post("/api/v1/gym/checkins/scan")
      .send({ qrToken: originalQrToken })
      .expect(200);
    expect(dupScan.body.outcome).toBe("denied_duplicate");

    // 9. Concurrency test on the 1 remaining session (set cooldown=0 first)
    await ownerA.agent
      .patch(`/api/v1/gym/${gymAId}/settings`)
      .send({ checkinCooldownMinutes: 0 })
      .expect(200);

    const [c1, c2] = await Promise.all([
      member.agent.post("/api/v1/gym/checkins/scan").send({ qrToken: originalQrToken }).expect(200),
      member.agent.post("/api/v1/gym/checkins/scan").send({ qrToken: originalQrToken }).expect(200),
    ]);
    const outcomes = [c1.body.outcome, c2.body.outcome].sort();
    expect(outcomes).toEqual(["allowed", "denied_no_sessions"]);

    // 10. Activate Day Time plan & test freeze/unfreeze + time window
    const yesterdayIso = new Date(Date.now() - 86_400_000).toISOString();
    const tomorrowBase = new Date(Date.now() + 86_400_000);
    const tomorrowNoonBucharest = new Date(
      Date.UTC(tomorrowBase.getUTCFullYear(), tomorrowBase.getUTCMonth(), tomorrowBase.getUTCDate(), 10, 0, 0),
    ); // 12:00 EET / 13:00 EEST in Europe/Bucharest (always inside 07:00-16:00)
    const tomorrowEveningBucharest = new Date(
      Date.UTC(tomorrowBase.getUTCFullYear(), tomorrowBase.getUTCMonth(), tomorrowBase.getUTCDate(), 18, 0, 0),
    ); // 20:00 EET / 21:00 EEST in Europe/Bucharest (always outside 07:00-16:00)

    const daySubRes = await receptionA.agent
      .post(`/api/v1/gym/${gymAId}/subscriptions`)
      .send({
        memberId,
        planId: dayPlanId,
        startsAt: yesterdayIso,
        recordPayment: true,
        paymentMethod: "card_pos",
      })
      .expect(201);
    const daySubId = daySubRes.body.subscription.id as string;

    // Freeze for 5 days -> scan returns denied_frozen
    await receptionA.agent
      .post(`/api/v1/gym/${gymAId}/subscriptions/${daySubId}/freeze`)
      .send({ days: 5 })
      .expect(200);

    const frozenScan = await gymService.scanCheckin(
      member.userId,
      { qrToken: originalQrToken },
      tomorrowNoonBucharest,
    );
    expect(frozenScan.outcome).toBe("denied_frozen");

    // Unfreeze -> allowed during midday Bucharest, denied_outside_hours in evening Bucharest
    await receptionA.agent
      .post(`/api/v1/gym/${gymAId}/subscriptions/${daySubId}/unfreeze`)
      .expect(200);

    const inHoursScan = await gymService.scanCheckin(
      member.userId,
      { qrToken: originalQrToken },
      tomorrowNoonBucharest,
    );
    expect(inHoursScan.outcome).toBe("allowed");

    const outHoursScan = await gymService.scanCheckin(
      member.userId,
      { qrToken: originalQrToken },
      tomorrowEveningBucharest,
    );
    expect(outHoursScan.outcome).toBe("denied_outside_hours");

    // 11. QR rotation invalidates old poster immediately
    const rotated = await ownerA.agent.post(`/api/v1/gym/${gymAId}/qr/rotate`).expect(200);
    expect(rotated.body.qrToken).not.toBe(originalQrToken);

    const oldQrScan = await member.agent
      .post("/api/v1/gym/checkins/scan")
      .send({ qrToken: originalQrToken })
      .expect(200);
    expect(oldQrScan.body.outcome).toBe("denied_invalid_qr");

    // 12. Manual check-in override requires reason and creates audit entry
    await receptionA.agent
      .post(`/api/v1/gym/${gymAId}/checkins/manual`)
      .send({ memberId, overrideReason: "Dead phone battery" })
      .expect(201);

    const auditRes = await ownerA.agent.get(`/api/v1/gym/${gymAId}/audit`).expect(200);
    expect(
      (auditRes.body as { action: string }[]).some((a) => a.action === "checkin.manual_override"),
    ).toBe(true);
    expect((auditRes.body as { action: string }[]).some((a) => a.action === "qr.rotated")).toBe(
      true,
    );

    // 13. Payments totals check
    const paymentsRes = await receptionA.agent.get(`/api/v1/gym/${gymAId}/payments`).expect(200);
    expect(paymentsRes.body.totals.grandTotalCents).toBe(26000);
    expect(paymentsRes.body.totals.byMethod.cash).toBe(8000);
    expect(paymentsRes.body.totals.byMethod.card_pos).toBe(18000);

    // 14. Daily maintenance cron dispatches expiring notification when ends_at is 2 days away
    await dataSource.query(
      `UPDATE public.gym_subscriptions SET ends_at = now() + interval '2 days' WHERE id = $1`,
      [daySubId],
    );
    const cronSummary = await gymService.runDailyMaintenance();
    expect(cronSummary.notified).toBeGreaterThanOrEqual(1);

    const notifsRes = await member.agent.get("/api/v1/notifications").expect(200);
    expect(
      (notifsRes.body as { type: string }[]).some((n) => n.type === "gym_subscription_expiring"),
    ).toBe(true);

    // 15. GDPR export includes gym records and never leaks qr_token
    const exportRes = await member.agent.get("/api/v1/account/export").expect(200);
    expect(exportRes.body.gym_memberships.length).toBe(1);
    expect(exportRes.body.gym_subscriptions.length).toBeGreaterThanOrEqual(2);
    expect(exportRes.body.gym_checkins.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(exportRes.body)).not.toContain(rotated.body.qrToken);

    // 16. GDPR account delete cascades personal gym rows while keeping gym_payments ledger with user_id = NULL
    await member.agent
      .delete("/api/v1/account")
      .send({ confirmEmail: "member1@replog.test" })
      .expect(200);

    const remainingPayments = await ownerA.agent.get(`/api/v1/gym/${gymAId}/payments`).expect(200);
    expect(remainingPayments.body.totals.grandTotalCents).toBe(26000);
    expect(
      (remainingPayments.body.items as { userId: string | null }[]).every((p) => p.userId === null),
    ).toBe(true);
  });
});
