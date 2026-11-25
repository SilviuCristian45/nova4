import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  forwardRef,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { Not, Repository } from "typeorm";
import {
  PHOTO_MAX_BYTES,
  PHOTO_MAX_PER_USER,
  drivePhotoName,
  isAutoBackupFrequency,
  parsePhotoRow,
  runAutoBackup,
  type AutoBackupFrequency,
  type AutoBackupResult,
} from "@replog/shared";
import { GoogleDriveBackupEntity, ProgressPhotoEntity } from "../../database/entities";
import { StorageService } from "../../storage/storage.service";
import { AccountService, type DriveCleanupHook } from "../account/account.service";
import { decryptDriveToken, encryptDriveToken } from "./drive-token";
import {
  DRIVE_SCOPE,
  GoogleDriveClient,
  exchangeGoogleCode,
  revokeGoogleToken,
  startGoogleAuthorization,
  type GoogleOAuthConfig,
} from "./google-drive.client";

export interface DriveStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
  frequency: AutoBackupFrequency;
  lastBackupAt: string | null;
  lastError: string | null;
}

const PHOTOS_PER_BACKUP = 40;

@Injectable()
export class DriveService implements DriveCleanupHook {
  private readonly logger = new Logger(DriveService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(GoogleDriveBackupEntity)
    private readonly backupsRepo: Repository<GoogleDriveBackupEntity>,
    @InjectRepository(ProgressPhotoEntity)
    private readonly photosRepo: Repository<ProgressPhotoEntity>,
    private readonly storage: StorageService,
    @Inject(forwardRef(() => AccountService))
    private readonly accountService: AccountService,
  ) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>("GOOGLE_CLIENT_ID") &&
        this.config.get<string>("GOOGLE_CLIENT_SECRET") &&
        this.config.get<string>("GOOGLE_REDIRECT_URI") &&
        this.config.get<string>("DRIVE_TOKEN_KEY"),
    );
  }

  private getOAuthConfig(): GoogleOAuthConfig {
    const clientId = this.config.get<string>("GOOGLE_CLIENT_ID");
    const clientSecret = this.config.get<string>("GOOGLE_CLIENT_SECRET");
    const redirectUri = this.config.get<string>("GOOGLE_REDIRECT_URI");
    if (!clientId || !clientSecret || !redirectUri || !this.config.get<string>("DRIVE_TOKEN_KEY")) {
      throw new ServiceUnavailableException("Google Drive backup is not configured on this server");
    }
    return { clientId, clientSecret, redirectUri };
  }

  private getTokenKey(): string {
    const key = this.config.get<string>("DRIVE_TOKEN_KEY");
    if (!key) throw new ServiceUnavailableException("DRIVE_TOKEN_KEY is not configured");
    return key;
  }

  async getStatus(userId: string): Promise<DriveStatus> {
    if (!this.isConfigured()) {
      return { configured: false, connected: false, email: null, frequency: "off", lastBackupAt: null, lastError: null };
    }
    const row = await this.backupsRepo.findOne({ where: { userId } });
    if (!row) {
      return { configured: true, connected: false, email: null, frequency: "off", lastBackupAt: null, lastError: null };
    }
    return {
      configured: true,
      connected: true,
      email: row.email ?? null,
      frequency: isAutoBackupFrequency(row.frequency) ? row.frequency : "off",
      lastBackupAt: row.lastBackupAt?.toISOString() ?? null,
      lastError: row.lastError ?? null,
    };
  }

  startConnect() {
    return startGoogleAuthorization(this.getOAuthConfig());
  }

  async completeConnect(userId: string, code: string, verifier: string): Promise<DriveStatus> {
    const cfg = this.getOAuthConfig();
    const exchanged = await exchangeGoogleCode(cfg, code, verifier);
    if (!exchanged.refreshToken) {
      throw new BadRequestException("Google did not grant offline refresh access");
    }
    if (!exchanged.scopes.includes(DRIVE_SCOPE)) {
      throw new BadRequestException("Required Google Drive appDataFolder scope was not granted");
    }

    const previous = await this.backupsRepo.findOne({ where: { userId } });
    const encrypted = encryptDriveToken(exchanged.refreshToken, this.getTokenKey());

    await this.backupsRepo
      .createQueryBuilder()
      .insert()
      .into(GoogleDriveBackupEntity)
      .values({
        userId,
        email: exchanged.email,
        refreshToken: encrypted,
        frequency: previous?.frequency ?? "off",
        lastError: null,
      })
      .orUpdate(["email", "refresh_token", "last_error"], ["user_id"])
      .execute();

    if (previous) {
      const oldToken = this.safeDecrypt(previous.refreshToken);
      if (oldToken && oldToken !== exchanged.refreshToken) {
        await revokeGoogleToken(oldToken);
      }
    }

    return this.getStatus(userId);
  }

  async setFrequency(userId: string, frequency: AutoBackupFrequency): Promise<DriveStatus> {
    const existing = await this.backupsRepo.findOne({ where: { userId } });
    if (!existing) throw new BadRequestException("Google Drive is not connected");

    existing.frequency = frequency;
    if (frequency === "off") existing.lastError = null;
    await this.backupsRepo.save(existing);
    return this.getStatus(userId);
  }

  async removeDriveLink(userId: string): Promise<void> {
    if (!this.isConfigured()) return;
    const row = await this.backupsRepo.findOne({ where: { userId } });
    if (!row) return;
    const token = this.safeDecrypt(row.refreshToken);
    if (token) await revokeGoogleToken(token);
    await this.backupsRepo.delete({ userId });
  }

  async purgeDrivePhotos(userId: string): Promise<void> {
    if (!this.isConfigured()) return;
    const row = await this.backupsRepo.findOne({ where: { userId } });
    if (!row) return;
    const client = new GoogleDriveClient(this.getOAuthConfig(), decryptDriveToken(row.refreshToken, this.getTokenKey()));
    for (const file of await client.listPhotos()) {
      await client.deleteFile(file.id);
    }
  }

  private async clientForUser(userId: string): Promise<GoogleDriveClient> {
    const row = await this.backupsRepo.findOne({ where: { userId } });
    if (!row) throw new BadRequestException("Google Drive is not connected");
    return new GoogleDriveClient(this.getOAuthConfig(), decryptDriveToken(row.refreshToken, this.getTokenKey()));
  }

  async listBackups(userId: string) {
    const client = await this.clientForUser(userId);
    return client.listBackups();
  }

  async downloadBackup(userId: string, fileId: string): Promise<string> {
    const client = await this.clientForUser(userId);
    return client.downloadBackup(fileId);
  }

  async backupUser(userId: string, force: boolean): Promise<AutoBackupResult> {
    const row = await this.backupsRepo.findOne({ where: { userId } });
    if (!row) throw new BadRequestException("Google Drive is not connected");
    return this.backupRow(row, force);
  }

  async restoreBackup(userId: string, fileId: string) {
    const client = await this.clientForUser(userId);
    const rawText = await client.downloadBackup(fileId);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      throw new BadRequestException("Backup file is not valid JSON");
    }

    const counts = await this.accountService.importData(userId, parsed);
    const photosRestored = await this.restorePhotosFromDrive(userId, client, parsed.progress_photos);
    return { success: true, counts, photosRestored };
  }

  private async restorePhotosFromDrive(
    userId: string,
    client: GoogleDriveClient,
    rawPhotos: unknown,
  ): Promise<{ restored: number; skipped: number; failed: number }> {
    const summary = { restored: 0, skipped: 0, failed: 0 };
    if (!Array.isArray(rawPhotos) || rawPhotos.length === 0) return summary;

    const existing = await this.photosRepo.find({ where: { userId }, select: { id: true } });
    const existingIds = new Set(existing.map((p) => p.id.toLowerCase()));
    let currentCount = existingIds.size;

    const drivePhotos = await client.listPhotos();
    const driveByName = new Map(drivePhotos.map((f) => [f.name, f.id]));
    const bucket = this.storage.getProgressPhotosBucket();

    for (const raw of rawPhotos) {
      if (currentCount >= PHOTO_MAX_PER_USER) break;
      const row = parsePhotoRow(raw, userId);
      if (!row || existingIds.has(row.id)) {
        summary.skipped++;
        continue;
      }

      const driveId = driveByName.get(drivePhotoName(row.id));
      if (!driveId) {
        summary.skipped++;
        continue;
      }

      try {
        const bytes = await client.downloadBytes(driveId);
        if (bytes.length === 0 || bytes.length > PHOTO_MAX_BYTES) {
          summary.failed++;
          continue;
        }
        await this.storage.uploadObject(bucket, row.path, bytes, "image/jpeg");
        await this.photosRepo.save(
          this.photosRepo.create({
            id: row.id,
            userId,
            takenOn: row.taken_on,
            pose: row.pose,
            note: row.note,
            path: row.path,
            sizeBytes: bytes.length,
          }),
        );
        existingIds.add(row.id);
        currentCount++;
        summary.restored++;
      } catch (err) {
        this.logger.warn(`Failed restoring photo ${row.id}: ${String(err)}`);
        summary.failed++;
      }
    }

    return summary;
  }

  private async backupRow(row: GoogleDriveBackupEntity, force = false, now = new Date()): Promise<AutoBackupResult> {
    const frequency = isAutoBackupFrequency(row.frequency) ? row.frequency : "off";
    const { result, state } = await runAutoBackup(
      {
        frequency,
        lastAt: row.lastBackupAt?.toISOString() ?? null,
        lastError: row.lastError ?? null,
      },
      async (fileName) => {
        const exportData = await this.accountService.buildExport(row.userId);
        const client = new GoogleDriveClient(
          this.getOAuthConfig(),
          decryptDriveToken(row.refreshToken, this.getTokenKey()),
        );
        await client.uploadAndPrune(fileName, JSON.stringify(exportData, null, 2));

        // Upload up to PHOTOS_PER_BACKUP missing progress photos from S3 to Drive appDataFolder.
        const photos = (exportData.progress_photos ?? []) as { id: string; path: string }[];
        if (photos.length > 0) {
          await this.backupPhotosToDrive(client, photos).catch((err) =>
            this.logger.warn(`Partial photo backup for ${row.userId}: ${String(err)}`),
          );
        }
      },
      now,
      force,
    );

    if (result.status !== "skipped") {
      await this.backupsRepo.update(
        { userId: row.userId },
        {
          lastBackupAt: state.lastAt ? new Date(state.lastAt) : null,
          lastError: state.lastError,
        },
      );
    }

    return result;
  }

  private async backupPhotosToDrive(client: GoogleDriveClient, photos: { id: string; path: string }[]): Promise<void> {
    const stored = new Set((await client.listPhotos()).map((f) => f.name));
    const bucket = this.storage.getProgressPhotosBucket();
    let uploaded = 0;

    for (const photo of photos) {
      const targetName = drivePhotoName(photo.id);
      if (stored.has(targetName)) continue;
      if (uploaded++ >= PHOTOS_PER_BACKUP) return;
      const bytes = await this.storage.downloadObject(bucket, photo.path);
      if (!bytes) continue;
      await client.uploadPhoto(targetName, bytes);
    }
  }

  async backupAllDue(budgetMs = 50_000) {
    if (!this.isConfigured()) {
      return { uploaded: 0, failed: 0, skipped: 0, remaining: 0 };
    }

    const started = Date.now();
    const rows = await this.backupsRepo.find({
      where: { frequency: Not("off") },
      order: { lastBackupAt: "ASC" },
      take: 1000,
    });

    const counts = { uploaded: 0, failed: 0, skipped: 0, remaining: 0 };
    for (let i = 0; i < rows.length; i++) {
      if (Date.now() - started > budgetMs) {
        counts.remaining = rows.length - i;
        break;
      }
      const result = await this.backupRow(rows[i], false).catch((err) => ({
        status: "failed" as const,
        message: String(err),
      }));
      counts[result.status === "uploaded" ? "uploaded" : result.status === "failed" ? "failed" : "skipped"]++;
    }
    return counts;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleHourlyBackupCron() {
    if (this.config.get<string>("DRIVE_CRON_ENABLED") === "false" || !this.isConfigured()) {
      return;
    }
    try {
      const summary = await this.backupAllDue(50_000);
      if (summary.uploaded > 0 || summary.failed > 0) {
        this.logger.log(`Hourly Drive backup cron: ${JSON.stringify(summary)}`);
      }
    } catch (err) {
      this.logger.error("Hourly Drive backup cron failed", err);
    }
  }

  private safeDecrypt(stored: string): string | null {
    try {
      return decryptDriveToken(stored, this.getTokenKey());
    } catch {
      return null;
    }
  }
}
