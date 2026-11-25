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
import { StorageService } from "../../storage/storage.service";
import type { CreatePhotoDto, RequestPhotoUploadDto } from "./dto/photo.dto";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class PhotosService {
  constructor(
    @InjectRepository(ProgressPhotoEntity)
    private readonly photosRepo: Repository<ProgressPhotoEntity>,
    private readonly storage: StorageService,
  ) {}

  async requestUploadUrl(userId: string, dto: RequestPhotoUploadDto) {
    const count = await this.photosRepo.count({ where: { userId } });
    if (count >= PHOTO_MAX_PER_USER) {
      throw new BadRequestException(`Photo limit reached (${PHOTO_MAX_PER_USER})`);
    }

    const id = randomUUID().toLowerCase();
    const path = photoPath(userId, id);
    const bucket = this.storage.getProgressPhotosBucket();
    const { url, expiresIn } = await this.storage.createPresignedUploadUrl(bucket, path, {
      contentType: "image/jpeg",
      contentLength: dto.sizeBytes,
      expiresInSeconds: 600,
    });

    return { id, path, uploadUrl: url, expiresIn };
  }

  async list(userId: string) {
    const rows = await this.photosRepo.find({
      where: { userId },
      order: { takenOn: "DESC", createdAt: "DESC" },
    });

    const bucket = this.storage.getProgressPhotosBucket();
    const signedByPath = await this.storage.createPresignedDownloadUrls(
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
      url: signedByPath.get(row.path) ?? null,
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

    const head = await this.storage.headObject(bucket, path);
    if (!head) {
      throw new BadRequestException("Photo file has not been uploaded to storage yet");
    }
    const verifiedSize = head.contentLength > 0 ? head.contentLength : dto.sizeBytes;
    if (verifiedSize <= 0 || verifiedSize > PHOTO_MAX_BYTES) {
      await this.storage.deleteObject(bucket, path).catch(() => undefined);
      throw new BadRequestException("Uploaded photo exceeds maximum allowed size");
    }

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
      const url = await this.storage.createPresignedDownloadUrl(bucket, saved.path, 600);

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
