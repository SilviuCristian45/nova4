import { BadRequestException, Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import {
  isMeasurementDate,
  isPhotoPose,
  isValidWorkoutDate,
  parseCheckin,
  PHOTO_MAX_BYTES,
  PHOTO_MAX_PER_USER,
  PHOTO_NOTE_MAX,
  photoPath,
  type PhotoPose,
} from "@replog/shared";
import type { SyncEntityType } from "../../database/entities/sync-change.entity";
import { PHOTO_CRYPTO_OVERHEAD } from "../../storage/photo-crypto";
import { StorageService } from "../../storage/storage.service";
import { FoodsService } from "../foods/foods.service";
import type { SyncMutationDto, SyncPushDto } from "./dto/sync.dto";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MEAL_TYPES = new Set(["Breakfast", "Lunch", "Dinner", "Snack"]);
const ACTIVITY_LEVELS = new Set(["sedentary", "light", "moderate", "active", "very_active"]);

export interface SyncProfilePayload {
  daily_steps_goal: number;
  display_name: string | null;
  height_cm: number | null;
  birth_date: string | null;
  sex: "male" | "female" | null;
  weight_unit: "kg" | "lb";
  activity_level: string | null;
  goal_kg_per_week: number;
}

export interface SyncUserTargetsPayload {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  updated_at: string | null;
}

export interface SyncFoodPayload {
  id: string;
  catalog: 0 | 1;
  name: string;
  brand: string | null;
  barcode: string | null;
  kcal_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  saturated_fat_per_100g: number | null;
  polyunsaturated_fat_per_100g: number | null;
  fiber_per_100g: number | null;
  sodium_mg_per_100g: number | null;
  created_at: string;
}

export interface SyncWorkoutSetPayload {
  id: string;
  workout_id: string;
  split: string;
  exercise: string;
  set_number: number;
  reps: number;
  rir: number | null;
  set_type: string;
  created_at: string;
  weight: number;
  notes: string | null;
}

export interface SyncCardioPayload {
  id: string;
  workout_id: string;
  activity: string;
  duration_min: number;
  created_at: string;
}

export interface SyncWorkoutPayload {
  id: string;
  performed_on: string;
  split: string;
  created_at: string;
  client_id: string | null;
  workout_mode: "strength" | "cardio";
  program_workout_id?: string | null;
  enrollment_id?: string | null;
  workout_sets: SyncWorkoutSetPayload[];
  cardio_sessions: SyncCardioPayload[];
}

export interface SyncMealItemPayload {
  id: string;
  meal_id: string;
  food_id: string;
  consumed_weight_g: number;
  total_kcal: number;
  total_protein_g: number;
  total_carbs_g: number;
  total_fat_g: number;
  created_at: string;
}

export interface SyncMealPayload {
  id: string;
  performed_on: string;
  meal_type: "Breakfast" | "Lunch" | "Dinner" | "Snack";
  notes: string | null;
  created_at: string;
  meal_items: SyncMealItemPayload[];
}

export interface SyncMealTemplatePayload {
  id: string;
  name: string;
  items: unknown[];
  created_at: string;
}

export interface SyncStepsPayload {
  id: string;
  date: string;
  steps: number;
}

export interface SyncWeightPayload {
  date: string;
  weight_kg: number;
}

export interface SyncDailyCheckinPayload {
  date: string;
  energy: number | null;
  satiety: number | null;
  sleep: number | null;
  note: string | null;
}

export interface SyncProgressPhotoPayload {
  id: string;
  taken_on: string;
  pose: PhotoPose;
  note: string | null;
  size_bytes: number;
  created_at: string;
}

export interface SyncMutationResult {
  mutationId: string;
  status: "applied" | "deduplicated" | "conflict_server_wins" | "rejected";
  error?: string;
}

export interface SyncPushResponse {
  results: SyncMutationResult[];
  foodIdMap: Record<string, string>;
  serverCursor: number;
  serverTime: string;
}

export interface SyncPullResponse {
  mode: "full" | "delta";
  cursor: number;
  serverTime: string;
  upserts: {
    profile: SyncProfilePayload | null;
    user_targets: SyncUserTargetsPayload | null;
    foods: SyncFoodPayload[];
    workouts: SyncWorkoutPayload[];
    meals: SyncMealPayload[];
    meal_templates: SyncMealTemplatePayload[];
    daily_steps: SyncStepsPayload[];
    daily_weight: SyncWeightPayload[];
    daily_checkin: SyncDailyCheckinPayload[];
    progress_photos: SyncProgressPhotoPayload[];
  };
  deletes: Array<{
    entityType: SyncEntityType;
    entityId: string;
    updatedAt: string;
  }>;
}

function isoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return new Date().toISOString();
}

function dateString(value: unknown): string {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isValidDateString(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_REGEX.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function assertUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_REGEX.test(value)) {
    throw new BadRequestException(`Invalid ${label} UUID`);
  }
  return value.toLowerCase();
}

function formatFoodRow(row: Record<string, unknown>): SyncFoodPayload {
  return {
    id: String(row.id),
    catalog: row.user_id === null || row.user_id === undefined ? 1 : 0,
    name: String(row.name),
    brand: row.brand === null || row.brand === undefined ? null : String(row.brand),
    barcode: row.barcode === null || row.barcode === undefined ? null : String(row.barcode),
    kcal_per_100g: toFiniteNumber(row.kcal_per_100g, 0),
    protein_per_100g: toFiniteNumber(row.protein_per_100g, 0),
    carbs_per_100g: toFiniteNumber(row.carbs_per_100g, 0),
    fat_per_100g: toFiniteNumber(row.fat_per_100g, 0),
    saturated_fat_per_100g: row.saturated_fat_per_100g === null ? null : toFiniteNumber(row.saturated_fat_per_100g, 0),
    polyunsaturated_fat_per_100g:
      row.polyunsaturated_fat_per_100g === null ? null : toFiniteNumber(row.polyunsaturated_fat_per_100g, 0),
    fiber_per_100g: row.fiber_per_100g === null ? null : toFiniteNumber(row.fiber_per_100g, 0),
    sodium_mg_per_100g: row.sodium_mg_per_100g === null ? null : toFiniteNumber(row.sodium_mg_per_100g, 0),
    created_at: isoString(row.created_at),
  };
}

@Injectable()
export class SyncService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly foodsService: FoodsService,
    private readonly storage: StorageService,
  ) {}

  async push(userId: string, dto: SyncPushDto): Promise<SyncPushResponse> {
    const mutations = dto.mutations ?? [];
    if (mutations.length === 0) {
      const [cursorRow] = await this.dataSource.query(
        `SELECT COALESCE(MAX(seq), 0)::text AS seq FROM public.sync_changes WHERE user_id = $1`,
        [userId],
      );
      return {
        results: [],
        foodIdMap: {},
        serverCursor: Number(cursorRow?.seq ?? 0),
        serverTime: new Date().toISOString(),
      };
    }

    // Pre-resolve any unknown barcode foods via Open Food Facts outside the DB transaction.
    await this.preResolveBarcodes(mutations);

    const foodIdMap: Record<string, string> = {};
    const results: SyncMutationResult[] = [];

    const serverCursor = await this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [userId]);

      for (let idx = 0; idx < mutations.length; idx++) {
        const m = mutations[idx];
        const mutationId = m.mutationId.toLowerCase();

        const existingReceipt: { mutation_id: string }[] = await manager.query(
          `SELECT mutation_id FROM public.offline_sync_receipts WHERE user_id = $1 AND mutation_id = $2 LIMIT 1`,
          [userId, mutationId],
        );
        if (existingReceipt.length > 0) {
          results.push({ mutationId, status: "deduplicated" });
          continue;
        }

        const clientTimeMs = Date.parse(m.clientUpdatedAt);
        if (!Number.isFinite(clientTimeMs)) {
          results.push({ mutationId, status: "rejected", error: "Invalid clientUpdatedAt timestamp" });
          continue;
        }

        // Last-Write-Wins conflict check against latest server change timestamp.
        const existingChange: { updated_at: Date | string }[] = await manager.query(
          `SELECT updated_at FROM public.sync_changes WHERE user_id = $1 AND entity_type = $2 AND entity_id = $3 LIMIT 1`,
          [userId, m.entityType, m.entityId],
        );
        if (existingChange.length > 0) {
          const serverTimeMs = new Date(existingChange[0].updated_at).getTime();
          if (Number.isFinite(serverTimeMs) && serverTimeMs > clientTimeMs) {
            await this.recordReceipt(manager, userId, mutationId, {
              kind: "sync_v1",
              entityType: m.entityType,
              entityId: m.entityId,
              op: m.op,
              status: "conflict_server_wins",
            });
            results.push({ mutationId, status: "conflict_server_wins" });
            continue;
          }
        }

        const savepoint = `sync_m_${idx}`;
        await manager.query(`SAVEPOINT ${savepoint}`);
        try {
          await this.applyMutation(manager, userId, m, foodIdMap);
          await this.recordReceipt(manager, userId, mutationId, {
            kind: "sync_v1",
            entityType: m.entityType,
            entityId: m.entityId,
            op: m.op,
            status: "applied",
          });
          await manager.query(`RELEASE SAVEPOINT ${savepoint}`);
          results.push({ mutationId, status: "applied" });
        } catch (err) {
          await manager.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          const message = err instanceof Error ? err.message : "Failed to apply sync mutation";
          results.push({ mutationId, status: "rejected", error: message });
        }
      }

      const [cursorRow]: { seq: string }[] = await manager.query(
        `SELECT COALESCE(MAX(seq), 0)::text AS seq FROM public.sync_changes WHERE user_id = $1`,
        [userId],
      );
      return Number(cursorRow?.seq ?? 0);
    });

    return {
      results,
      foodIdMap,
      serverCursor,
      serverTime: new Date().toISOString(),
    };
  }

  async pull(userId: string, cursor: number): Promise<SyncPullResponse> {
    return this.dataSource.transaction(async (manager) => {
      // Shared advisory lock matches record_sync_change's exclusive lock (salt 1001) so pull never skips uncommitted seqs.
      await manager.query(`SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 1001))`, [userId]);

      const [cursorRow]: { seq: string }[] = await manager.query(
        `SELECT COALESCE(MAX(seq), 0)::text AS seq FROM public.sync_changes WHERE user_id = $1`,
        [userId],
      );
      const serverCursor = Number(cursorRow?.seq ?? 0);
      const serverTime = new Date().toISOString();

      if (cursor === 0) {
        return this.buildFullPull(manager, userId, serverCursor, serverTime);
      }

      return this.buildDeltaPull(manager, userId, cursor, serverCursor, serverTime);
    });
  }

  private async preResolveBarcodes(mutations: SyncMutationDto[]): Promise<void> {
    const barcodes = new Set<string>();
    for (const m of mutations) {
      if (m.op !== "upsert" || !m.payload) continue;
      if (m.entityType === "food") {
        const b = typeof m.payload.barcode === "string" ? m.payload.barcode.trim() : "";
        if (b) barcodes.add(b);
      } else if (m.entityType === "meal" && Array.isArray(m.payload.meal_items)) {
        for (const item of m.payload.meal_items as Record<string, unknown>[]) {
          const food = item?.food as Record<string, unknown> | undefined;
          const b = typeof food?.barcode === "string" ? food.barcode.trim() : "";
          if (b) barcodes.add(b);
        }
      }
    }

    for (const barcode of barcodes) {
      await this.foodsService.getOrCacheBarcodeFood(barcode).catch(() => null);
    }
  }

  private async recordReceipt(
    manager: EntityManager,
    userId: string,
    mutationId: string,
    summary: Record<string, unknown>,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO public.offline_sync_receipts (user_id, mutation_id, payload)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (user_id, mutation_id) DO NOTHING`,
      [userId, mutationId, JSON.stringify(summary)],
    );
  }

  private async applyMutation(
    manager: EntityManager,
    userId: string,
    m: SyncMutationDto,
    foodIdMap: Record<string, string>,
  ): Promise<void> {
    const payload = m.payload ?? {};

    switch (m.entityType) {
      case "profile":
        if (m.op === "upsert") await this.applyProfileUpsert(manager, userId, payload);
        return;

      case "user_targets":
        if (m.op === "delete") {
          await manager.query(`DELETE FROM public.user_targets WHERE user_id = $1`, [userId]);
        } else {
          await this.applyTargetsUpsert(manager, userId, payload);
        }
        return;

      case "food":
        if (m.op === "delete") {
          const id = assertUuid(m.entityId, "food");
          await manager.query(`DELETE FROM public.foods WHERE id = $1 AND user_id = $2`, [id, userId]);
        } else {
          const id = assertUuid(m.entityId, "food");
          await this.applyFoodUpsert(manager, userId, id, payload, foodIdMap);
        }
        return;

      case "workout":
        if (m.op === "delete") {
          const id = assertUuid(m.entityId, "workout");
          await manager.query(`DELETE FROM public.workouts WHERE id = $1 AND user_id = $2`, [id, userId]);
        } else {
          const id = assertUuid(m.entityId, "workout");
          await this.applyWorkoutUpsert(manager, userId, id, payload);
        }
        return;

      case "meal":
        if (m.op === "delete") {
          const id = assertUuid(m.entityId, "meal");
          await manager.query(`DELETE FROM public.meals WHERE id = $1 AND user_id = $2`, [id, userId]);
        } else {
          const id = assertUuid(m.entityId, "meal");
          await this.applyMealUpsert(manager, userId, id, payload, foodIdMap);
        }
        return;

      case "meal_template":
        if (m.op === "delete") {
          const id = assertUuid(m.entityId, "meal_template");
          await manager.query(`DELETE FROM public.meal_templates WHERE id = $1 AND user_id = $2`, [id, userId]);
        } else {
          const id = assertUuid(m.entityId, "meal_template");
          await this.applyMealTemplateUpsert(manager, userId, id, payload);
        }
        return;

      case "daily_steps":
        if (!isValidDateString(m.entityId)) throw new BadRequestException("Invalid daily_steps date");
        if (m.op === "delete") {
          await manager.query(`DELETE FROM public.daily_steps WHERE user_id = $1 AND date = $2`, [userId, m.entityId]);
        } else {
          const steps = Math.trunc(toFiniteNumber(payload.steps, -1));
          if (!Number.isInteger(steps) || steps < 0 || steps > 2147483647) {
            throw new BadRequestException("Invalid steps count");
          }
          await manager.query(
            `INSERT INTO public.daily_steps (user_id, date, steps)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, date) DO UPDATE SET steps = EXCLUDED.steps`,
            [userId, m.entityId, steps],
          );
        }
        return;

      case "daily_weight":
        if (!isValidDateString(m.entityId)) throw new BadRequestException("Invalid daily_weight date");
        if (m.op === "delete") {
          await manager.query(`DELETE FROM public.daily_weight WHERE user_id = $1 AND date = $2`, [userId, m.entityId]);
        } else {
          const weightKg = Math.round(toFiniteNumber(payload.weight_kg, -1) * 100) / 100;
          if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg >= 10000) {
            throw new BadRequestException("Invalid body weight");
          }
          await manager.query(
            `INSERT INTO public.daily_weight (user_id, date, weight_kg)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, date) DO UPDATE SET weight_kg = EXCLUDED.weight_kg`,
            [userId, m.entityId, weightKg.toFixed(2)],
          );
        }
        return;

      case "daily_checkin":
        if (!isValidDateString(m.entityId)) throw new BadRequestException("Invalid daily_checkin date");
        if (m.op === "delete") {
          await manager.query(`DELETE FROM public.daily_checkin WHERE user_id = $1 AND date = $2`, [userId, m.entityId]);
        } else {
          const tomorrow = new Date();
          tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
          if (!isMeasurementDate(m.entityId, tomorrow.toISOString().slice(0, 10))) {
            throw new BadRequestException("Invalid daily_checkin date");
          }
          const parsed = parseCheckin({
            energy: payload.energy ?? null,
            satiety: payload.satiety ?? null,
            sleep: payload.sleep ?? null,
            note: payload.note ?? "",
          });
          if (!parsed) {
            throw new BadRequestException("Daily check-in requires at least one valid score (1-10) or note");
          }
          await manager.query(
            `INSERT INTO public.daily_checkin (user_id, date, energy, satiety, sleep, note)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (user_id, date) DO UPDATE
               SET energy = EXCLUDED.energy,
                   satiety = EXCLUDED.satiety,
                   sleep = EXCLUDED.sleep,
                   note = EXCLUDED.note`,
            [userId, m.entityId, parsed.energy, parsed.satiety, parsed.sleep, parsed.note || null],
          );
        }
        return;

      case "progress_photo": {
        const id = assertUuid(m.entityId, "progress_photo");
        if (m.op === "delete") {
          await this.applyProgressPhotoDelete(manager, userId, id);
        } else {
          await this.applyProgressPhotoUpsert(manager, userId, id, payload);
        }
        return;
      }
    }
  }

  private async applyProgressPhotoDelete(manager: EntityManager, userId: string, id: string): Promise<void> {
    const existing: { path: string }[] = await manager.query(
      `SELECT path FROM public.progress_photos WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [id, userId],
    );
    const bucket = this.storage.getProgressPhotosBucket();
    const key = existing[0]?.path ?? photoPath(userId, id);
    await this.storage.deleteObject(bucket, key).catch(() => undefined);
    await manager.query(`DELETE FROM public.progress_photos WHERE id = $1 AND user_id = $2`, [id, userId]);
  }

  private async applyProgressPhotoUpsert(
    manager: EntityManager,
    userId: string,
    id: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const takenOn = typeof payload.taken_on === "string" ? payload.taken_on.slice(0, 10) : "";
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    if (!isValidDateString(takenOn) || !isMeasurementDate(takenOn, tomorrow.toISOString().slice(0, 10))) {
      throw new BadRequestException("Invalid progress photo taken_on date");
    }
    const pose = isPhotoPose(payload.pose) ? payload.pose : null;
    if (!pose) throw new BadRequestException("Invalid progress photo pose");

    const noteRaw = typeof payload.note === "string" ? payload.note.trim() : typeof payload.notes === "string" ? payload.notes.trim() : "";
    const note = noteRaw ? noteRaw.slice(0, PHOTO_NOTE_MAX) : null;

    const existing: { id: string; user_id: string }[] = await manager.query(
      `SELECT id, user_id FROM public.progress_photos WHERE id = $1 LIMIT 1`,
      [id],
    );

    if (existing.length > 0) {
      if (existing[0].user_id !== userId) {
        throw new BadRequestException("Progress photo ID belongs to another user");
      }
      await manager.query(
        `UPDATE public.progress_photos
         SET taken_on = $3, pose = $4, note = $5
         WHERE id = $1 AND user_id = $2`,
        [id, userId, takenOn, pose, note],
      );
      return;
    }

    // New photo row: verify the JPEG object has already been uploaded to S3/MinIO.
    const countRows: { count: string }[] = await manager.query(
      `SELECT COUNT(*)::text AS count FROM public.progress_photos WHERE user_id = $1`,
      [userId],
    );
    if (Number(countRows[0]?.count ?? 0) >= PHOTO_MAX_PER_USER) {
      throw new BadRequestException(`Photo limit reached (${PHOTO_MAX_PER_USER})`);
    }

    const bucket = this.storage.getProgressPhotosBucket();
    const path = photoPath(userId, id);
    const head = await this.storage.headObject(bucket, path);
    if (!head) {
      throw new BadRequestException("Photo file has not been uploaded to storage yet");
    }

    const encryptedMode = typeof this.storage.isPhotoEncryptionEnabled === "function" && this.storage.isPhotoEncryptionEnabled();
    const maxStoredBytes = encryptedMode ? PHOTO_MAX_BYTES + PHOTO_CRYPTO_OVERHEAD : PHOTO_MAX_BYTES;
    const rawStoredLength = head.contentLength > 0 ? head.contentLength : Math.trunc(toFiniteNumber(payload.size_bytes, 0));
    if (rawStoredLength <= 0 || rawStoredLength > maxStoredBytes) {
      throw new BadRequestException("Uploaded photo exceeds maximum allowed size");
    }

    const verifiedSize =
      encryptedMode && head.contentLength > PHOTO_CRYPTO_OVERHEAD
        ? Math.min(PHOTO_MAX_BYTES, head.contentLength - PHOTO_CRYPTO_OVERHEAD)
        : Math.min(PHOTO_MAX_BYTES, rawStoredLength);
    const createdAt = isoString(payload.created_at);

    await manager.query(
      `INSERT INTO public.progress_photos (id, user_id, taken_on, pose, note, path, size_bytes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, userId, takenOn, pose, note, path, verifiedSize, createdAt],
    );
  }

  private async applyProfileUpsert(
    manager: EntityManager,
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [userId];

    const pushSet = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if ("display_name" in payload) {
      if (payload.display_name === null || payload.display_name === "") {
        pushSet("display_name", null);
      } else if (typeof payload.display_name === "string") {
        const trimmed = payload.display_name.trim();
        pushSet("display_name", trimmed.length > 0 ? trimmed.slice(0, 80) : null);
      }
    }

    if ("height_cm" in payload) {
      if (payload.height_cm === null || payload.height_cm === undefined) {
        pushSet("height_cm", null);
      } else {
        const h = Number(payload.height_cm);
        if (!Number.isFinite(h) || h < 50 || h > 272) throw new BadRequestException("Invalid height_cm");
        pushSet("height_cm", h.toFixed(1));
      }
    }

    if ("birth_date" in payload) {
      if (payload.birth_date === null || payload.birth_date === "") {
        pushSet("birth_date", null);
      } else if (isValidDateString(payload.birth_date) && payload.birth_date >= "1900-01-01") {
        pushSet("birth_date", payload.birth_date);
      } else {
        throw new BadRequestException("Invalid birth_date");
      }
    }

    if ("sex" in payload) {
      if (payload.sex === null || payload.sex === "") {
        pushSet("sex", null);
      } else if (payload.sex === "male" || payload.sex === "female") {
        pushSet("sex", payload.sex);
      } else {
        throw new BadRequestException("Invalid sex");
      }
    }

    if ("weight_unit" in payload) {
      if (payload.weight_unit === "kg" || payload.weight_unit === "lb") {
        pushSet("weight_unit", payload.weight_unit);
      } else {
        throw new BadRequestException("Invalid weight_unit");
      }
    }

    if ("daily_steps_goal" in payload) {
      const goal = Number(payload.daily_steps_goal);
      if (!Number.isInteger(goal) || goal < 1 || goal > 1_000_000) {
        throw new BadRequestException("Invalid daily_steps_goal");
      }
      pushSet("daily_steps_goal", goal);
    }

    if ("activity_level" in payload) {
      if (payload.activity_level === null || payload.activity_level === "") {
        pushSet("activity_level", null);
      } else if (typeof payload.activity_level === "string" && ACTIVITY_LEVELS.has(payload.activity_level)) {
        pushSet("activity_level", payload.activity_level);
      } else {
        throw new BadRequestException("Invalid activity_level");
      }
    }

    if ("goal_kg_per_week" in payload) {
      const rate = Number(payload.goal_kg_per_week);
      if (!Number.isFinite(rate) || rate < -1 || rate > 1) {
        throw new BadRequestException("Invalid goal_kg_per_week");
      }
      pushSet("goal_kg_per_week", rate.toFixed(2));
    }

    if (sets.length === 0) return;

    // Never allow sync to alter profiles.role.
    await manager.query(`UPDATE public.profiles SET ${sets.join(", ")} WHERE id = $1`, params);
  }

  private async applyTargetsUpsert(
    manager: EntityManager,
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const kcal = Math.round(clamp(toFiniteNumber(payload.kcal, 2200), 500, 15000));
    const protein = Math.round(clamp(toFiniteNumber(payload.protein, 160), 0, 1000));
    const carbs = Math.round(clamp(toFiniteNumber(payload.carbs, 250), 0, 2000));
    const fat = Math.round(clamp(toFiniteNumber(payload.fat, 70), 0, 500));
    const fiber = Math.round(clamp(toFiniteNumber(payload.fiber, 30), 0, 200));

    await manager.query(
      `INSERT INTO public.user_targets (user_id, kcal, protein, carbs, fat, fiber, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (user_id) DO UPDATE
         SET kcal = EXCLUDED.kcal,
             protein = EXCLUDED.protein,
             carbs = EXCLUDED.carbs,
             fat = EXCLUDED.fat,
             fiber = EXCLUDED.fiber,
             updated_at = now()`,
      [userId, kcal, protein, carbs, fat, fiber],
    );
  }

  private async applyFoodUpsert(
    manager: EntityManager,
    userId: string,
    id: string,
    payload: Record<string, unknown>,
    foodIdMap: Record<string, string>,
  ): Promise<string> {
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    if (!name) throw new BadRequestException("Food name is required");

    const barcode = typeof payload.barcode === "string" && payload.barcode.trim() ? payload.barcode.trim() : null;

    // Shared barcode catalog rows are server-canonical: link mobile to existing server row if present.
    if (barcode) {
      const existingByBarcode: { id: string }[] = await manager.query(
        `SELECT id FROM public.foods WHERE barcode = $1 LIMIT 1`,
        [barcode],
      );
      if (existingByBarcode.length > 0) {
        const canonicalId = existingByBarcode[0].id;
        if (canonicalId !== id) {
          foodIdMap[id] = canonicalId;
        }
        return canonicalId;
      }
    }

    const existingById: { id: string; user_id: string | null }[] = await manager.query(
      `SELECT id, user_id FROM public.foods WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (existingById.length > 0) {
      if (existingById[0].user_id === null) {
        // Shared catalog row already exists with the same ID: never overwrite shared catalog from client.
        return id;
      }
      if (existingById[0].user_id !== userId) {
        throw new BadRequestException("Food ID belongs to another user");
      }
    }

    const brand = typeof payload.brand === "string" && payload.brand.trim() ? payload.brand.trim() : null;
    const kcal = Math.max(0, toFiniteNumber(payload.kcal_per_100g, 0));
    const protein = Math.max(0, toFiniteNumber(payload.protein_per_100g, 0));
    const carbs = Math.max(0, toFiniteNumber(payload.carbs_per_100g, 0));
    const fat = Math.max(0, toFiniteNumber(payload.fat_per_100g, 0));
    const satFat = Math.max(0, toFiniteNumber(payload.saturated_fat_per_100g, 0));
    const polyFat = Math.max(0, toFiniteNumber(payload.polyunsaturated_fat_per_100g, 0));
    const fiber = Math.max(0, toFiniteNumber(payload.fiber_per_100g, 0));
    const sodium = Math.max(0, toFiniteNumber(payload.sodium_mg_per_100g, 0));
    const createdAt = isoString(payload.created_at);

    // Client-submitted foods are always stored privately (user_id = userId, barcode = null) so shared catalog stays server-authoritative.
    await manager.query(
      `INSERT INTO public.foods (
         id, user_id, name, brand, barcode,
         kcal_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
         saturated_fat_per_100g, polyunsaturated_fat_per_100g, fiber_per_100g, sodium_mg_per_100g, created_at
       )
       VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name,
             brand = EXCLUDED.brand,
             kcal_per_100g = EXCLUDED.kcal_per_100g,
             protein_per_100g = EXCLUDED.protein_per_100g,
             carbs_per_100g = EXCLUDED.carbs_per_100g,
             fat_per_100g = EXCLUDED.fat_per_100g,
             saturated_fat_per_100g = EXCLUDED.saturated_fat_per_100g,
             polyunsaturated_fat_per_100g = EXCLUDED.polyunsaturated_fat_per_100g,
             fiber_per_100g = EXCLUDED.fiber_per_100g,
             sodium_mg_per_100g = EXCLUDED.sodium_mg_per_100g
         WHERE public.foods.user_id = $2`,
      [id, userId, name, brand, kcal, protein, carbs, fat, satFat, polyFat, fiber, sodium, createdAt],
    );

    return id;
  }

  private async applyWorkoutUpsert(
    manager: EntityManager,
    userId: string,
    id: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const performedOn = typeof payload.performed_on === "string" ? payload.performed_on.slice(0, 10) : "";
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    if (!isValidDateString(performedOn) || !isValidWorkoutDate(performedOn, tomorrow.toISOString().slice(0, 10))) {
      throw new BadRequestException("Invalid workout performed_on date");
    }

    const mode = payload.workout_mode === "cardio" ? "cardio" : "strength";
    const splitRaw = typeof payload.split === "string" ? payload.split.trim() : "";
    const split = mode === "cardio" ? "CARDIO" : splitRaw.slice(0, 100);
    if (!split) throw new BadRequestException("Workout split is required");

    const sets = Array.isArray(payload.workout_sets) ? (payload.workout_sets as Record<string, unknown>[]) : [];
    const cardio = Array.isArray(payload.cardio_sessions) ? (payload.cardio_sessions as Record<string, unknown>[]) : [];
    if (mode === "strength" && (sets.length === 0 || sets.length > 1000)) {
      throw new BadRequestException("Strength workout must contain 1..1000 sets");
    }
    if (mode === "cardio" && (cardio.length === 0 || cardio.length > 1000)) {
      throw new BadRequestException("Cardio workout must contain 1..1000 sessions");
    }

    const existing: { user_id: string }[] = await manager.query(
      `SELECT user_id FROM public.workouts WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (existing.length > 0 && existing[0].user_id !== userId) {
      throw new BadRequestException("Workout ID belongs to another user");
    }

    const createdAt = isoString(payload.created_at);
    const clientId = typeof payload.client_id === "string" && payload.client_id.trim() ? payload.client_id.trim() : null;

    let programWorkoutId: string | null = null;
    if (typeof payload.program_workout_id === "string" && UUID_REGEX.test(payload.program_workout_id)) {
      const [pw] = await manager.query(`SELECT id FROM public.program_workouts WHERE id = $1 LIMIT 1`, [
        payload.program_workout_id.toLowerCase(),
      ]);
      if (pw) programWorkoutId = payload.program_workout_id.toLowerCase();
    }

    let enrollmentId: string | null = null;
    if (typeof payload.enrollment_id === "string" && UUID_REGEX.test(payload.enrollment_id)) {
      const [en] = await manager.query(
        `SELECT id FROM public.enrollments WHERE id = $1 AND client_id = $2 LIMIT 1`,
        [payload.enrollment_id.toLowerCase(), userId],
      );
      if (en) enrollmentId = payload.enrollment_id.toLowerCase();
    }

    await manager.query(
      `INSERT INTO public.workouts (id, user_id, performed_on, split, created_at, client_id, workout_mode, program_workout_id, enrollment_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE
         SET performed_on = EXCLUDED.performed_on,
             split = EXCLUDED.split,
             workout_mode = EXCLUDED.workout_mode,
             program_workout_id = COALESCE(EXCLUDED.program_workout_id, public.workouts.program_workout_id),
             enrollment_id = COALESCE(EXCLUDED.enrollment_id, public.workouts.enrollment_id)
         WHERE public.workouts.user_id = $2`,
      [id, userId, performedOn, split, createdAt, clientId, mode, programWorkoutId, enrollmentId],
    );

    await manager.query(`DELETE FROM public.workout_sets WHERE workout_id = $1 AND user_id = $2`, [id, userId]);
    await manager.query(`DELETE FROM public.cardio_sessions WHERE workout_id = $1 AND user_id = $2`, [id, userId]);

    if (mode === "strength") {
      for (let i = 0; i < sets.length; i++) {
        const s = sets[i];
        const setId = assertUuid(s.id, "workout_set");
        const exercise = typeof s.exercise === "string" ? s.exercise.trim().slice(0, 300) : "";
        if (!exercise) throw new BadRequestException("Set exercise is required");
        const setSplit = typeof s.split === "string" && s.split.trim() ? s.split.trim().slice(0, 100) : split;
        const setNumber = Math.max(1, Math.trunc(toFiniteNumber(s.set_number, i + 1)));
        const reps = Math.max(0, Math.trunc(toFiniteNumber(s.reps, 0)));
        const weight = clamp(Math.round(toFiniteNumber(s.weight, 0) * 100) / 100, 0, 10000);
        const rirRaw = s.rir === null || s.rir === undefined ? null : Math.trunc(Number(s.rir));
        const rir = rirRaw !== null && Number.isInteger(rirRaw) && rirRaw >= 0 && rirRaw <= 5 ? rirRaw : null;
        const setType =
          typeof s.set_type === "string" && s.set_type.trim() ? s.set_type.trim().slice(0, 100) : "Working Set";
        const notesRaw = typeof s.notes === "string" ? s.notes.trim() : "";
        const notes = notesRaw ? notesRaw.slice(0, 99) : null;
        const setCreatedAt = isoString(s.created_at);

        await manager.query(
          `INSERT INTO public.workout_sets (
             id, workout_id, user_id, split, exercise, set_number, reps, rir, set_type, created_at, weight, notes, is_pr
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, false)`,
          [setId, id, userId, setSplit, exercise, setNumber, reps, rir, setType, setCreatedAt, weight.toFixed(2), notes],
        );
      }
    } else {
      for (const c of cardio) {
        const cardioId = assertUuid(c.id, "cardio_session");
        const activity = typeof c.activity === "string" ? c.activity.trim().slice(0, 120) : "";
        const durationMin = Math.round(toFiniteNumber(c.duration_min, 0));
        if (!activity || durationMin < 1 || durationMin > 1440) {
          throw new BadRequestException("Invalid cardio session");
        }
        const cardioCreatedAt = isoString(c.created_at);
        await manager.query(
          `INSERT INTO public.cardio_sessions (id, workout_id, user_id, activity, duration_min, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [cardioId, id, userId, activity, durationMin, cardioCreatedAt],
        );
      }
    }
  }

  private async applyMealUpsert(
    manager: EntityManager,
    userId: string,
    id: string,
    payload: Record<string, unknown>,
    foodIdMap: Record<string, string>,
  ): Promise<void> {
    const performedOn = typeof payload.performed_on === "string" ? payload.performed_on.slice(0, 10) : "";
    if (!isValidDateString(performedOn)) throw new BadRequestException("Invalid meal performed_on date");
    const mealType = typeof payload.meal_type === "string" && MEAL_TYPES.has(payload.meal_type) ? payload.meal_type : null;
    if (!mealType) throw new BadRequestException("Invalid meal_type");

    const items = Array.isArray(payload.meal_items) ? (payload.meal_items as Record<string, unknown>[]) : [];
    const notesRaw = typeof payload.notes === "string" ? payload.notes.trim() : "";
    const notes = notesRaw ? notesRaw.slice(0, 1000) : null;
    const createdAt = isoString(payload.created_at);

    const existing: { user_id: string }[] = await manager.query(
      `SELECT user_id FROM public.meals WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (existing.length > 0 && existing[0].user_id !== userId) {
      throw new BadRequestException("Meal ID belongs to another user");
    }

    await manager.query(
      `INSERT INTO public.meals (id, user_id, performed_on, meal_type, notes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE
         SET performed_on = EXCLUDED.performed_on,
             meal_type = EXCLUDED.meal_type,
             notes = EXCLUDED.notes
         WHERE public.meals.user_id = $2`,
      [id, userId, performedOn, mealType, notes, createdAt],
    );

    await manager.query(`DELETE FROM public.meal_items WHERE meal_id = $1`, [id]);

    for (const item of items) {
      const itemId = assertUuid(item.id, "meal_item");
      const rawFoodId = assertUuid(item.food_id, "meal_item.food_id");
      let resolvedFoodId = foodIdMap[rawFoodId] ?? rawFoodId;

      const foodRow: { id: string }[] = await manager.query(
        `SELECT id FROM public.foods WHERE id = $1 AND (user_id IS NULL OR user_id = $2) LIMIT 1`,
        [resolvedFoodId, userId],
      );

      if (foodRow.length === 0) {
        const inlineFood = item.food as Record<string, unknown> | undefined;
        if (!inlineFood || typeof inlineFood !== "object") {
          throw new BadRequestException(`Referenced food ${resolvedFoodId} does not exist on server`);
        }
        resolvedFoodId = await this.applyFoodUpsert(manager, userId, rawFoodId, inlineFood, foodIdMap);
      }

      const grams = Math.max(0.01, toFiniteNumber(item.consumed_weight_g, 0));
      const kcal = Math.max(0, toFiniteNumber(item.total_kcal, 0));
      const protein = Math.max(0, toFiniteNumber(item.total_protein_g, 0));
      const carbs = Math.max(0, toFiniteNumber(item.total_carbs_g, 0));
      const fat = Math.max(0, toFiniteNumber(item.total_fat_g, 0));
      const itemCreatedAt = isoString(item.created_at);

      await manager.query(
        `INSERT INTO public.meal_items (
           id, meal_id, food_id, consumed_weight_g, total_kcal, total_protein_g, total_carbs_g, total_fat_g, created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [itemId, id, resolvedFoodId, grams, kcal, protein, carbs, fat, itemCreatedAt],
      );
    }
  }

  private async applyMealTemplateUpsert(
    manager: EntityManager,
    userId: string,
    id: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const name = typeof payload.name === "string" ? payload.name.trim().slice(0, 120) : "";
    if (!name) throw new BadRequestException("Template name is required");
    const items = Array.isArray(payload.items) ? payload.items : [];
    const createdAt = isoString(payload.created_at);

    const existing: { user_id: string }[] = await manager.query(
      `SELECT user_id FROM public.meal_templates WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (existing.length > 0 && existing[0].user_id !== userId) {
      throw new BadRequestException("Meal template ID belongs to another user");
    }

    await manager.query(
      `INSERT INTO public.meal_templates (id, user_id, name, items, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name,
             items = EXCLUDED.items
         WHERE public.meal_templates.user_id = $2`,
      [id, userId, name, JSON.stringify(items), createdAt],
    );
  }

  private async buildFullPull(
    manager: EntityManager,
    userId: string,
    serverCursor: number,
    serverTime: string,
  ): Promise<SyncPullResponse> {
    const [
      profileRows,
      targetRows,
      ownFoods,
      workoutRows,
      setRows,
      cardioRows,
      mealRows,
      mealItemRows,
      templates,
      stepsRows,
      weightRows,
      checkinRows,
      photoRows,
    ] = await Promise.all([
      manager.query(
        `SELECT daily_steps_goal, display_name, height_cm, birth_date::text AS birth_date, sex, weight_unit, activity_level, goal_kg_per_week
         FROM public.profiles WHERE id = $1 LIMIT 1`,
        [userId],
      ),
      manager.query(`SELECT * FROM public.user_targets WHERE user_id = $1 LIMIT 1`, [userId]),
      manager.query(`SELECT * FROM public.foods WHERE user_id = $1 ORDER BY created_at ASC`, [userId]),
      manager.query(
        `SELECT id, performed_on::text AS performed_on, split, created_at, client_id, workout_mode, program_workout_id, enrollment_id
         FROM public.workouts WHERE user_id = $1 ORDER BY performed_on ASC, created_at ASC`,
        [userId],
      ),
      manager.query(`SELECT * FROM public.workout_sets WHERE user_id = $1 ORDER BY set_number ASC, created_at ASC`, [userId]),
      manager.query(`SELECT * FROM public.cardio_sessions WHERE user_id = $1 ORDER BY created_at ASC`, [userId]),
      manager.query(
        `SELECT id, performed_on::text AS performed_on, meal_type, notes, created_at
         FROM public.meals WHERE user_id = $1 ORDER BY performed_on ASC, created_at ASC`,
        [userId],
      ),
      manager.query(
        `SELECT mi.* FROM public.meal_items mi
         JOIN public.meals m ON m.id = mi.meal_id
         WHERE m.user_id = $1
         ORDER BY mi.created_at ASC`,
        [userId],
      ),
      manager.query(`SELECT * FROM public.meal_templates WHERE user_id = $1 ORDER BY created_at ASC`, [userId]),
      manager.query(`SELECT id, date::text AS date, steps FROM public.daily_steps WHERE user_id = $1 ORDER BY date ASC`, [userId]),
      manager.query(`SELECT date::text AS date, weight_kg FROM public.daily_weight WHERE user_id = $1 ORDER BY date ASC`, [userId]),
      manager.query(`SELECT date::text AS date, energy, satiety, sleep, note FROM public.daily_checkin WHERE user_id = $1 ORDER BY date ASC`, [userId]),
      manager.query(
        `SELECT id, taken_on::text AS taken_on, pose, note, size_bytes, created_at
         FROM public.progress_photos
         WHERE user_id = $1
         ORDER BY taken_on ASC, created_at ASC`,
        [userId],
      ),
    ]);

    const ownFoodIds = new Set((ownFoods as Record<string, unknown>[]).map((f) => String(f.id)));
    const referencedFoodIds = [
      ...new Set((mealItemRows as Record<string, unknown>[]).map((i) => String(i.food_id))),
    ].filter((fid) => !ownFoodIds.has(fid));

    const catalogFoods: Record<string, unknown>[] =
      referencedFoodIds.length > 0
        ? await manager.query(`SELECT * FROM public.foods WHERE id = ANY($1::uuid[])`, [referencedFoodIds])
        : [];

    return {
      mode: "full",
      cursor: serverCursor,
      serverTime,
      upserts: {
        profile: this.mapProfile(profileRows[0]),
        user_targets: this.mapTargets(targetRows[0]),
        foods: [...(ownFoods as Record<string, unknown>[]), ...catalogFoods].map(formatFoodRow),
        workouts: this.assembleWorkouts(workoutRows, setRows, cardioRows),
        meals: this.assembleMeals(mealRows, mealItemRows),
        meal_templates: this.mapTemplates(templates),
        daily_steps: this.mapSteps(stepsRows),
        daily_weight: this.mapWeights(weightRows),
        daily_checkin: this.mapCheckins(checkinRows),
        progress_photos: this.mapPhotos(photoRows),
      },
      deletes: [],
    };
  }

  private async buildDeltaPull(
    manager: EntityManager,
    userId: string,
    cursor: number,
    serverCursor: number,
    serverTime: string,
  ): Promise<SyncPullResponse> {
    const changes: { entity_type: SyncEntityType; entity_id: string; op: "upsert" | "delete"; updated_at: Date | string }[] =
      await manager.query(
        `SELECT entity_type, entity_id, op, updated_at
         FROM public.sync_changes
         WHERE user_id = $1 AND seq > $2
         ORDER BY seq ASC`,
        [userId, cursor],
      );

    const deletes: SyncPullResponse["deletes"] = [];
    let pullProfile = false;
    let pullTargets = false;
    const foodIds: string[] = [];
    const workoutIds: string[] = [];
    const mealIds: string[] = [];
    const templateIds: string[] = [];
    const stepDates: string[] = [];
    const weightDates: string[] = [];
    const checkinDates: string[] = [];
    const photoIds: string[] = [];

    for (const c of changes) {
      if (c.op === "delete") {
        deletes.push({
          entityType: c.entity_type,
          entityId: c.entity_id,
          updatedAt: isoString(c.updated_at),
        });
        continue;
      }

      switch (c.entity_type) {
        case "profile":
          pullProfile = true;
          break;
        case "user_targets":
          pullTargets = true;
          break;
        case "food":
          if (UUID_REGEX.test(c.entity_id)) foodIds.push(c.entity_id);
          break;
        case "workout":
          if (UUID_REGEX.test(c.entity_id)) workoutIds.push(c.entity_id);
          break;
        case "meal":
          if (UUID_REGEX.test(c.entity_id)) mealIds.push(c.entity_id);
          break;
        case "meal_template":
          if (UUID_REGEX.test(c.entity_id)) templateIds.push(c.entity_id);
          break;
        case "daily_steps":
          if (DATE_REGEX.test(c.entity_id)) stepDates.push(c.entity_id);
          break;
        case "daily_weight":
          if (DATE_REGEX.test(c.entity_id)) weightDates.push(c.entity_id);
          break;
        case "daily_checkin":
          if (DATE_REGEX.test(c.entity_id)) checkinDates.push(c.entity_id);
          break;
        case "progress_photo":
          if (UUID_REGEX.test(c.entity_id)) photoIds.push(c.entity_id);
          break;
      }
    }

    const [
      profileRows,
      targetRows,
      directFoods,
      workoutRows,
      setRows,
      cardioRows,
      mealRows,
      mealItemRows,
      templates,
      stepsRows,
      weightRows,
      checkinRows,
      photoRows,
    ] = await Promise.all([
      pullProfile
        ? manager.query(
            `SELECT daily_steps_goal, display_name, height_cm, birth_date::text AS birth_date, sex, weight_unit, activity_level, goal_kg_per_week
             FROM public.profiles WHERE id = $1 LIMIT 1`,
            [userId],
          )
        : Promise.resolve([]),
      pullTargets ? manager.query(`SELECT * FROM public.user_targets WHERE user_id = $1 LIMIT 1`, [userId]) : Promise.resolve([]),
      foodIds.length > 0
        ? manager.query(`SELECT * FROM public.foods WHERE user_id = $1 AND id = ANY($2::uuid[])`, [userId, foodIds])
        : Promise.resolve([]),
      workoutIds.length > 0
        ? manager.query(
            `SELECT id, performed_on::text AS performed_on, split, created_at, client_id, workout_mode, program_workout_id, enrollment_id
             FROM public.workouts WHERE user_id = $1 AND id = ANY($2::uuid[])`,
            [userId, workoutIds],
          )
        : Promise.resolve([]),
      workoutIds.length > 0
        ? manager.query(
            `SELECT * FROM public.workout_sets WHERE user_id = $1 AND workout_id = ANY($2::uuid[]) ORDER BY set_number ASC, created_at ASC`,
            [userId, workoutIds],
          )
        : Promise.resolve([]),
      workoutIds.length > 0
        ? manager.query(
            `SELECT * FROM public.cardio_sessions WHERE user_id = $1 AND workout_id = ANY($2::uuid[]) ORDER BY created_at ASC`,
            [userId, workoutIds],
          )
        : Promise.resolve([]),
      mealIds.length > 0
        ? manager.query(
            `SELECT id, performed_on::text AS performed_on, meal_type, notes, created_at
             FROM public.meals WHERE user_id = $1 AND id = ANY($2::uuid[])`,
            [userId, mealIds],
          )
        : Promise.resolve([]),
      mealIds.length > 0
        ? manager.query(
            `SELECT mi.* FROM public.meal_items mi
             JOIN public.meals m ON m.id = mi.meal_id
             WHERE m.user_id = $1 AND mi.meal_id = ANY($2::uuid[])
             ORDER BY mi.created_at ASC`,
            [userId, mealIds],
          )
        : Promise.resolve([]),
      templateIds.length > 0
        ? manager.query(`SELECT * FROM public.meal_templates WHERE user_id = $1 AND id = ANY($2::uuid[])`, [userId, templateIds])
        : Promise.resolve([]),
      stepDates.length > 0
        ? manager.query(`SELECT id, date::text AS date, steps FROM public.daily_steps WHERE user_id = $1 AND date = ANY($2::date[])`, [userId, stepDates])
        : Promise.resolve([]),
      weightDates.length > 0
        ? manager.query(`SELECT date::text AS date, weight_kg FROM public.daily_weight WHERE user_id = $1 AND date = ANY($2::date[])`, [userId, weightDates])
        : Promise.resolve([]),
      checkinDates.length > 0
        ? manager.query(
            `SELECT date::text AS date, energy, satiety, sleep, note FROM public.daily_checkin WHERE user_id = $1 AND date = ANY($2::date[])`,
            [userId, checkinDates],
          )
        : Promise.resolve([]),
      photoIds.length > 0
        ? manager.query(
            `SELECT id, taken_on::text AS taken_on, pose, note, size_bytes, created_at
             FROM public.progress_photos
             WHERE user_id = $1 AND id = ANY($2::uuid[])`,
            [userId, photoIds],
          )
        : Promise.resolve([]),
    ]);

    // Ensure every food referenced by pulled meal_items is also sent so local FK constraints never fail.
    const includedFoodIds = new Set((directFoods as Record<string, unknown>[]).map((f) => String(f.id)));
    const extraFoodIds = [
      ...new Set((mealItemRows as Record<string, unknown>[]).map((i) => String(i.food_id))),
    ].filter((fid) => !includedFoodIds.has(fid));

    const extraFoods: Record<string, unknown>[] =
      extraFoodIds.length > 0
        ? await manager.query(
            `SELECT * FROM public.foods WHERE id = ANY($1::uuid[]) AND (user_id IS NULL OR user_id = $2)`,
            [extraFoodIds, userId],
          )
        : [];

    return {
      mode: "delta",
      cursor: serverCursor,
      serverTime,
      upserts: {
        profile: this.mapProfile(profileRows[0]),
        user_targets: this.mapTargets(targetRows[0]),
        foods: [...(directFoods as Record<string, unknown>[]), ...extraFoods].map(formatFoodRow),
        workouts: this.assembleWorkouts(workoutRows, setRows, cardioRows),
        meals: this.assembleMeals(mealRows, mealItemRows),
        meal_templates: this.mapTemplates(templates),
        daily_steps: this.mapSteps(stepsRows),
        daily_weight: this.mapWeights(weightRows),
        daily_checkin: this.mapCheckins(checkinRows),
        progress_photos: this.mapPhotos(photoRows),
      },
      deletes,
    };
  }

  private mapProfile(row: Record<string, unknown> | undefined): SyncProfilePayload | null {
    if (!row) return null;
    return {
      daily_steps_goal: toFiniteNumber(row.daily_steps_goal, 10000),
      display_name: row.display_name === null || row.display_name === undefined ? null : String(row.display_name),
      height_cm: row.height_cm === null || row.height_cm === undefined ? null : Number(row.height_cm),
      birth_date: row.birth_date === null || row.birth_date === undefined ? null : dateString(row.birth_date),
      sex: row.sex === "male" || row.sex === "female" ? row.sex : null,
      weight_unit: row.weight_unit === "lb" ? "lb" : "kg",
      activity_level: row.activity_level === null || row.activity_level === undefined ? null : String(row.activity_level),
      goal_kg_per_week: toFiniteNumber(row.goal_kg_per_week, 0),
    };
  }

  private mapTargets(row: Record<string, unknown> | undefined): SyncUserTargetsPayload | null {
    if (!row) return null;
    return {
      kcal: toFiniteNumber(row.kcal, 2200),
      protein: toFiniteNumber(row.protein, 160),
      carbs: toFiniteNumber(row.carbs, 250),
      fat: toFiniteNumber(row.fat, 70),
      fiber: toFiniteNumber(row.fiber, 30),
      updated_at: row.updated_at ? isoString(row.updated_at) : null,
    };
  }

  private assembleWorkouts(
    workouts: Record<string, unknown>[],
    sets: Record<string, unknown>[],
    cardio: Record<string, unknown>[],
  ): SyncWorkoutPayload[] {
    const setsByWorkout = new Map<string, SyncWorkoutSetPayload[]>();
    for (const s of sets) {
      const wid = String(s.workout_id);
      const list = setsByWorkout.get(wid) ?? [];
      list.push({
        id: String(s.id),
        workout_id: wid,
        split: String(s.split),
        exercise: String(s.exercise),
        set_number: toFiniteNumber(s.set_number, 1),
        reps: toFiniteNumber(s.reps, 0),
        rir: s.rir === null || s.rir === undefined ? null : Number(s.rir),
        set_type: String(s.set_type),
        created_at: isoString(s.created_at),
        weight: toFiniteNumber(s.weight, 0),
        notes: s.notes === null || s.notes === undefined ? null : String(s.notes),
      });
      setsByWorkout.set(wid, list);
    }

    const cardioByWorkout = new Map<string, SyncCardioPayload[]>();
    for (const c of cardio) {
      const wid = String(c.workout_id);
      const list = cardioByWorkout.get(wid) ?? [];
      list.push({
        id: String(c.id),
        workout_id: wid,
        activity: String(c.activity),
        duration_min: toFiniteNumber(c.duration_min, 1),
        created_at: isoString(c.created_at),
      });
      cardioByWorkout.set(wid, list);
    }

    return workouts.map((w) => {
      const id = String(w.id);
      return {
        id,
        performed_on: dateString(w.performed_on),
        split: String(w.split),
        created_at: isoString(w.created_at),
        client_id: w.client_id === null || w.client_id === undefined ? null : String(w.client_id),
        workout_mode: w.workout_mode === "cardio" ? "cardio" : "strength",
        program_workout_id:
          w.program_workout_id === null || w.program_workout_id === undefined ? null : String(w.program_workout_id),
        enrollment_id: w.enrollment_id === null || w.enrollment_id === undefined ? null : String(w.enrollment_id),
        workout_sets: setsByWorkout.get(id) ?? [],
        cardio_sessions: cardioByWorkout.get(id) ?? [],
      };
    });
  }

  private assembleMeals(meals: Record<string, unknown>[], items: Record<string, unknown>[]): SyncMealPayload[] {
    const itemsByMeal = new Map<string, SyncMealItemPayload[]>();
    for (const i of items) {
      const mid = String(i.meal_id);
      const list = itemsByMeal.get(mid) ?? [];
      list.push({
        id: String(i.id),
        meal_id: mid,
        food_id: String(i.food_id),
        consumed_weight_g: toFiniteNumber(i.consumed_weight_g, 0),
        total_kcal: toFiniteNumber(i.total_kcal, 0),
        total_protein_g: toFiniteNumber(i.total_protein_g, 0),
        total_carbs_g: toFiniteNumber(i.total_carbs_g, 0),
        total_fat_g: toFiniteNumber(i.total_fat_g, 0),
        created_at: isoString(i.created_at),
      });
      itemsByMeal.set(mid, list);
    }

    return meals.map((m) => {
      const id = String(m.id);
      const mealType = MEAL_TYPES.has(String(m.meal_type))
        ? (String(m.meal_type) as SyncMealPayload["meal_type"])
        : "Snack";
      return {
        id,
        performed_on: dateString(m.performed_on),
        meal_type: mealType,
        notes: m.notes === null || m.notes === undefined ? null : String(m.notes),
        created_at: isoString(m.created_at),
        meal_items: itemsByMeal.get(id) ?? [],
      };
    });
  }

  private mapTemplates(rows: Record<string, unknown>[]): SyncMealTemplatePayload[] {
    return rows.map((t) => ({
      id: String(t.id),
      name: String(t.name),
      items: Array.isArray(t.items) ? t.items : [],
      created_at: isoString(t.created_at),
    }));
  }

  private mapSteps(rows: Record<string, unknown>[]): SyncStepsPayload[] {
    return rows.map((r) => ({
      id: String(r.id),
      date: dateString(r.date),
      steps: toFiniteNumber(r.steps, 0),
    }));
  }

  private mapWeights(rows: Record<string, unknown>[]): SyncWeightPayload[] {
    return rows.map((r) => ({
      date: dateString(r.date),
      weight_kg: toFiniteNumber(r.weight_kg, 0),
    }));
  }

  private mapCheckins(rows: Record<string, unknown>[]): SyncDailyCheckinPayload[] {
    return rows.map((r) => ({
      date: dateString(r.date),
      energy: r.energy === null || r.energy === undefined ? null : Number(r.energy),
      satiety: r.satiety === null || r.satiety === undefined ? null : Number(r.satiety),
      sleep: r.sleep === null || r.sleep === undefined ? null : Number(r.sleep),
      note: r.note === null || r.note === undefined ? null : String(r.note),
    }));
  }

  private mapPhotos(rows: Record<string, unknown>[]): SyncProgressPhotoPayload[] {
    return rows.map((r) => ({
      id: String(r.id),
      taken_on: dateString(r.taken_on),
      pose: isPhotoPose(r.pose) ? r.pose : "other",
      note: r.note === null || r.note === undefined ? null : String(r.note),
      size_bytes: toFiniteNumber(r.size_bytes, 0),
      created_at: isoString(r.created_at),
    }));
  }
}
