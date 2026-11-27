import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import { Repository } from "typeorm";
import {
  PHOTO_MAX_BYTES,
  PHOTO_MAX_PER_USER,
  photoPath,
  isMeasurementDate,
} from "@replog/shared";
import { ProgressPhotoEntity } from "../../database/entities";
import { PHOTO_CRYPTO_OVERHEAD, isJpegBuffer } from "../../storage/photo-crypto";
import { StorageService } from "../../storage/storage.service";
import type { CreatePhotoDto, RequestPhotoUploadDto, UpdatePhotoDto } from "./dto/photo.dto";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class PhotosService {
  constructor(
    @InjectRepository(ProgressPhotoEntity)
    private readonly photosRepo: Repository<ProgressPhotoEntity>,
    private readonly storage: StorageService,
  ) {}

  private isEncryptedMode(): boolean {
    return typeof this.storage.isPhotoEncryptionEnabled === "function" && this.storage.isPhotoEncryptionEnabled();
  }

  async requestUploadUrl(userId: string, dto: RequestPhotoUploadDto) {
    const count = await this.photosRepo.count({ where: { userId } });
    if (count >= PHOTO_MAX_PER_USER) {
      throw new BadRequestException(`Photo limit reached (${PHOTO_MAX_PER_USER})`);
    }

    const id = dto.id ? dto.id.toLowerCase() : randomUUID().toLowerCase();
    const path = photoPath(userId, id);

    if (this.isEncryptedMode()) {
      return {
        id,
        path,
        uploadUrl: `/api/v1/photos/upload/${id}`,
        expiresIn: 600,
      };
    }

    const bucket = this.storage.getProgressPhotosBucket();
    const { url, expiresIn } = await this.storage.createPresignedUploadUrl(bucket, path, {
      contentType: "image/jpeg",
      contentLength: dto.sizeBytes,
      expiresInSeconds: 600,
    });

    return { id, path, uploadUrl: url, expiresIn };
  }

  async uploadEncryptedFile(userId: string, idRaw: string, rawBody: unknown) {
    if (!UUID_REGEX.test(idRaw)) {
      throw new BadRequestException("Invalid photo ID");
    }
    const count = await this.photosRepo.count({ where: { userId } });
    if (count >= PHOTO_MAX_PER_USER) {
      throw new BadRequestException(`Photo limit reached (${PHOTO_MAX_PER_USER})`);
    }
    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
      throw new BadRequestException("JPEG image body is required");
    }
    if (rawBody.length > PHOTO_MAX_BYTES) {
      throw new BadRequestException("Photo exceeds maximum allowed size");
    }
    if (!isJpegBuffer(rawBody)) {
      throw new BadRequestException("Only valid JPEG images are supported");
    }

    const id = idRaw.toLowerCase();
    const path = photoPath(userId, id);
    const bucket = this.storage.getProgressPhotosBucket();
    await this.storage.uploadObject(bucket, path, rawBody, "image/jpeg");
    return { id, path, sizeBytes: rawBody.length };
  }

  async getPhotoFile(userId: string, idRaw: string): Promise<Buffer> {
    if (!UUID_REGEX.test(idRaw)) throw new NotFoundException("Photo not found");
    const row = await this.photosRepo.findOne({ where: { id: idRaw.toLowerCase(), userId } });
    if (!row) throw new NotFoundException("Photo not found");

    const bucket = this.storage.getProgressPhotosBucket();
    const bytes = await this.storage.downloadObject(bucket, row.path);
    if (!bytes) throw new NotFoundException("Photo file not found in storage");
    return bytes;
  }

  async list(userId: string) {
    const rows = await this.photosRepo.find({
      where: { userId },
      order: { takenOn: "DESC", createdAt: "DESC" },
    });

    const encryptedMode = this.isEncryptedMode();
    const bucket = this.storage.getProgressPhotosBucket();
    const signedByPath = encryptedMode
      ? new Map<string, string>()
      : await this.storage.createPresignedDownloadUrls(
          bucket,
          rows.map((r) => r.path),
          600,
        );

    return rows.map((row) => ({
      id: row.id,
      takenOn: String(row.takenOn).slice(0, 10),
      pose: row.pose,
      note: row.note ?? null,
      path: row.path,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      url: encryptedMode ? `/api/v1/photos/${row.id}/file` : (signedByPath.get(row.path) ?? null),
    }));
  }

  async create(userId: string, dto: CreatePhotoDto) {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    if (!isMeasurementDate(dto.takenOn, tomorrow.toISOString().slice(0, 10))) {
      throw new BadRequestException("Invalid photo date");
    }

    const id = dto.id.toLowerCase();
    const path = photoPath(userId, id);
    const bucket = this.storage.getProgressPhotosBucket();

    const encryptedMode = this.isEncryptedMode();
    const head = await this.storage.headObject(bucket, path);
    if (!head) {
      throw new BadRequestException("Photo file has not been uploaded to storage yet");
    }
    const maxStoredBytes = encryptedMode ? PHOTO_MAX_BYTES + PHOTO_CRYPTO_OVERHEAD : PHOTO_MAX_BYTES;
    const rawStoredLength = head.contentLength > 0 ? head.contentLength : dto.sizeBytes;
    if (rawStoredLength <= 0 || rawStoredLength > maxStoredBytes) {
      await this.storage.deleteObject(bucket, path).catch(() => undefined);
      throw new BadRequestException("Uploaded photo exceeds maximum allowed size");
    }
    const verifiedSize =
      encryptedMode && head.contentLength > PHOTO_CRYPTO_OVERHEAD
        ? Math.min(PHOTO_MAX_BYTES, head.contentLength - PHOTO_CRYPTO_OVERHEAD)
        : Math.min(PHOTO_MAX_BYTES, rawStoredLength);

    const count = await this.photosRepo.count({ where: { userId } });
    if (count >= PHOTO_MAX_PER_USER) {
      await this.storage.deleteObject(bucket, path).catch(() => undefined);
      throw new BadRequestException(`Photo limit reached (${PHOTO_MAX_PER_USER})`);
    }

    try {
      const entity = this.photosRepo.create({
        id,
        userId,
        takenOn: dto.takenOn,
        pose: dto.pose,
        note: dto.note?.trim() || null,
        path,
        sizeBytes: verifiedSize,
      });
      const saved = await this.photosRepo.save(entity);
      const url = encryptedMode
        ? `/api/v1/photos/${saved.id}/file`
        : await this.storage.createPresignedDownloadUrl(bucket, saved.path, 600);

      return {
        id: saved.id,
        takenOn: String(saved.takenOn).slice(0, 10),
        pose: saved.pose,
        note: saved.note ?? null,
        path: saved.path,
        sizeBytes: saved.sizeBytes,
        createdAt: saved.createdAt.toISOString(),
        url,
      };
    } catch (err) {
      await this.storage.deleteObject(bucket, path).catch(() => undefined);
      const pgCode = (err as { driverError?: { code?: string }; code?: string })?.driverError?.code ?? (err as { code?: string })?.code;
      if (pgCode === "23514") {
        throw new BadRequestException(`Photo limit reached (${PHOTO_MAX_PER_USER})`);
      }
      if (pgCode === "23505") {
        throw new BadRequestException("Photo with this ID already exists");
      }
      throw err;
    }
  }

  async update(userId: string, idRaw: string, dto: UpdatePhotoDto) {
    if (!UUID_REGEX.test(idRaw)) throw new NotFoundException("Photo not found");
    const existing = await this.photosRepo.findOne({ where: { id: idRaw.toLowerCase(), userId } });
    if (!existing) throw new NotFoundException("Photo not found");

    if (dto.takenOn !== undefined) {
      const tomorrow = new Date();
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      if (!isMeasurementDate(dto.takenOn, tomorrow.toISOString().slice(0, 10))) {
        throw new BadRequestException("Invalid photo date");
      }
      existing.takenOn = dto.takenOn;
    }
    if (dto.pose !== undefined) {
      existing.pose = dto.pose;
    }
    if (dto.note !== undefined) {
      existing.note = dto.note?.trim() || null;
    }

    const saved = await this.photosRepo.save(existing);
    const encryptedMode = this.isEncryptedMode();
    const bucket = this.storage.getProgressPhotosBucket();
    const url = encryptedMode
      ? `/api/v1/photos/${saved.id}/file`
      : await this.storage.createPresignedDownloadUrl(bucket, saved.path, 600);

    return {
      id: saved.id,
      takenOn: String(saved.takenOn).slice(0, 10),
      pose: saved.pose,
      note: saved.note ?? null,
      path: saved.path,
      sizeBytes: saved.sizeBytes,
      createdAt: saved.createdAt instanceof Date ? saved.createdAt.toISOString() : String(saved.createdAt),
      url,
    };
  }

  async remove(userId: string, id: string): Promise<{ deleted: true }> {
    if (!UUID_REGEX.test(id)) throw new NotFoundException("Photo not found");
    const existing = await this.photosRepo.findOne({ where: { id: id.toLowerCase(), userId } });
    if (!existing) throw new NotFoundException("Photo not found");

    const bucket = this.storage.getProgressPhotosBucket();
    await this.storage.deleteObject(bucket, existing.path);
    await this.photosRepo.delete({ id: existing.id, userId });
    return { deleted: true };
  }
}
