import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomBytes } from "node:crypto";
import request from "supertest";
import { DataSource } from "typeorm";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.setup";
import { isEncryptedPhotoBuffer, isJpegBuffer } from "../src/storage/photo-crypto";
import { StorageService } from "../src/storage/storage.service";

describe("Photo Encryption E2E: AES-256-GCM at rest + Strict Owner / Active Coach Access", () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let storage: StorageService;

  const fakeJpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
    0x00, 0xff, 0xd9,
  ]);
  const today = new Date().toISOString().slice(0, 10);

  async function registerUser(email: string, role: "client" | "coach" = "client", displayName?: string) {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({ email, password: "Password123!", role, displayName })
      .expect(201);
    return { id: res.body.user.id as string, token: res.body.accessToken as string };
  }

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "test-jwt-secret-at-least-32-chars-long";
    process.env.COOKIE_SECURE = "false";
    process.env.COACH_SELF_SERVE = "true";
    process.env.THROTTLE_LIMIT = "1000";
    process.env.SUPER_ADMIN_EMAILS = "boss@example.com";
    process.env.PHOTO_ENCRYPTION_KEY = randomBytes(32).toString("base64");

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app, { enableSwagger: false });
    await app.init();

    dataSource = app.get(DataSource);
    storage = app.get(StorageService);
    await dataSource.runMigrations();
  });

  afterAll(async () => {
    delete process.env.PHOTO_ENCRYPTION_KEY;
    delete process.env.SUPER_ADMIN_EMAILS;
    if (app) await app.close();
  });

  beforeEach(async () => {
    await dataSource.query("TRUNCATE TABLE public.users, public.foods RESTART IDENTITY CASCADE");
  });

  it("encrypts progress & check-in photos at rest in MinIO and enforces strict owner/active-coach-switch access", async () => {
    const superAdmin = await registerUser("boss@example.com", "client", "Super Admin");
    const coachA = await registerUser("coacha@example.com", "coach", "Coach A");
    const coachB = await registerUser("coachb@example.com", "coach", "Coach B");
    const client = await registerUser("client@example.com", "client", "Client X");

    // 1. Progress photo upload -> stored encrypted in MinIO -> readable ONLY by owner (NOT even Super Admin or Coach!)
    const upMeta = await request(app.getHttpServer())
      .post("/api/v1/photos/upload-url")
      .set("Authorization", `Bearer ${client.token}`)
      .send({ sizeBytes: fakeJpeg.length })
      .expect(201);

    expect(upMeta.body.uploadUrl).toBe(`/api/v1/photos/upload/${upMeta.body.id}`);

    await request(app.getHttpServer())
      .put(upMeta.body.uploadUrl)
      .set("Authorization", `Bearer ${client.token}`)
      .set("Content-Type", "image/jpeg")
      .send(fakeJpeg)
      .expect(200);

    // Inspect RAW bytes directly in MinIO: MUST be encrypted ciphertext, NOT plaintext JPEG!
    const rawProgressBlob = await storage.downloadRawObject(storage.getProgressPhotosBucket(), upMeta.body.path);
    expect(rawProgressBlob).not.toBeNull();
    expect(isEncryptedPhotoBuffer(rawProgressBlob!)).toBe(true);
    expect(isJpegBuffer(rawProgressBlob!)).toBe(false);

    const createdPhoto = await request(app.getHttpServer())
      .post("/api/v1/photos")
      .set("Authorization", `Bearer ${client.token}`)
      .send({
        id: upMeta.body.id,
        takenOn: today,
        pose: "front",
        note: "encrypted test",
        sizeBytes: fakeJpeg.length,
      })
      .expect(201);

    expect(createdPhoto.body.url).toBe(`/api/v1/photos/${upMeta.body.id}/file`);

    // Owner gets decrypted exact JPEG bytes
    const ownerImg = await request(app.getHttpServer())
      .get(createdPhoto.body.url)
      .set("Authorization", `Bearer ${client.token}`)
      .expect(200);
    expect(Buffer.compare(ownerImg.body as Buffer, fakeJpeg)).toBe(0);

    // Super Admin & Coach CANNOT view private progress photo
    await request(app.getHttpServer())
      .get(createdPhoto.body.url)
      .set("Authorization", `Bearer ${superAdmin.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(createdPhoto.body.url)
      .set("Authorization", `Bearer ${coachA.token}`)
      .expect(404);

    // 2. Weekly check-in photo with Coach A active -> encrypted in MinIO -> visible to Client + Coach A (NOT Super Admin / Coach B)
    await dataSource.query(
      `INSERT INTO public.enrollments (client_id, coach_id, status) VALUES ($1, $2, 'active')`,
      [client.id, coachA.id],
    );

    const ciUpload = await request(app.getHttpServer())
      .post("/api/v1/checkins/weekly/photo-upload-url")
      .set("Authorization", `Bearer ${client.token}`)
      .send({ sizeBytes: fakeJpeg.length })
      .expect(201);

    expect(ciUpload.body.uploadUrl).toBe(`/api/v1/checkins/weekly/photo-upload/${ciUpload.body.id}`);

    await request(app.getHttpServer())
      .put(ciUpload.body.uploadUrl)
      .set("Authorization", `Bearer ${client.token}`)
      .set("Content-Type", "image/jpeg")
      .send(fakeJpeg)
      .expect(200);

    const rawCheckinBlob = await storage.downloadRawObject(storage.getCheckinPhotosBucket(), ciUpload.body.path);
    expect(rawCheckinBlob).not.toBeNull();
    expect(isEncryptedPhotoBuffer(rawCheckinBlob!)).toBe(true);
    expect(isJpegBuffer(rawCheckinBlob!)).toBe(false);

    const submitted = await request(app.getHttpServer())
      .post("/api/v1/checkins/weekly")
      .set("Authorization", `Bearer ${client.token}`)
      .send({
        coachId: coachA.id,
        weekStart: today,
        energy: 4,
        sleep: 4,
        stress: 2,
        photoFrontPath: ciUpload.body.path,
      })
      .expect(201);

    const photoUrl = submitted.body.photoUrls.front as string;
    expect(photoUrl).toBe(`/api/v1/checkins/weekly/${submitted.body.id}/photo/front`);

    // Client and Coach A get exact decrypted JPEG
    const clientCiImg = await request(app.getHttpServer())
      .get(photoUrl)
      .set("Authorization", `Bearer ${client.token}`)
      .expect(200);
    expect(Buffer.compare(clientCiImg.body as Buffer, fakeJpeg)).toBe(0);

    const coachACiImg = await request(app.getHttpServer())
      .get(photoUrl)
      .set("Authorization", `Bearer ${coachA.token}`)
      .expect(200);
    expect(Buffer.compare(coachACiImg.body as Buffer, fakeJpeg)).toBe(0);

    // Super Admin and Coach B (not active yet) are forbidden
    await request(app.getHttpServer())
      .get(photoUrl)
      .set("Authorization", `Bearer ${superAdmin.token}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(photoUrl)
      .set("Authorization", `Bearer ${coachB.token}`)
      .expect(403);

    // 3. Switch coach: Coach A becomes paused, Coach B becomes active!
    // -> Coach A IMMEDIATELY loses access (403); Coach B IMMEDIATELY gains access (200) to historical check-in photos!
    await dataSource.query(
      `UPDATE public.enrollments SET status = 'paused' WHERE client_id = $1 AND coach_id = $2`,
      [client.id, coachA.id],
    );
    await dataSource.query(
      `INSERT INTO public.enrollments (client_id, coach_id, status) VALUES ($1, $2, 'active')`,
      [client.id, coachB.id],
    );

    await request(app.getHttpServer())
      .get(photoUrl)
      .set("Authorization", `Bearer ${coachA.token}`)
      .expect(403);

    const coachBCiImg = await request(app.getHttpServer())
      .get(photoUrl)
      .set("Authorization", `Bearer ${coachB.token}`)
      .expect(200);
    expect(Buffer.compare(coachBCiImg.body as Buffer, fakeJpeg)).toBe(0);

    // Cleanup S3 objects created during test
    await storage.deleteUserPrefix(storage.getProgressPhotosBucket(), client.id);
    await storage.deleteUserPrefix(storage.getCheckinPhotosBucket(), client.id);
  });
});
