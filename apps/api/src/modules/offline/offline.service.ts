import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import {
  isWarmup,
  localDate,
  validOfflinePayload,
  type OfflinePayload,
  type OfflineSnapshot,
} from "@replog/shared";
import {
  CardioSessionEntity,
  DailyCheckinEntity,
  DailyStepsEntity,
  DailyWeightEntity,
  WorkoutEntity,
  WorkoutSetEntity,
} from "../../database/entities";
import type { OfflineSyncDto } from "./dto/offline.dto";

@Injectable()
export class OfflineService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(WorkoutEntity)
    private readonly workoutsRepo: Repository<WorkoutEntity>,
    @InjectRepository(DailyStepsEntity)
    private readonly stepsRepo: Repository<DailyStepsEntity>,
    @InjectRepository(DailyWeightEntity)
    private readonly weightsRepo: Repository<DailyWeightEntity>,
    @InjectRepository(DailyCheckinEntity)
    private readonly checkinsRepo: Repository<DailyCheckinEntity>,
  ) {}

  async getSnapshot(userId: string): Promise<{ snapshot: OfflineSnapshot; warning: null }> {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - 90);
    const start = localDate(cutoff);

    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const end = localDate(tomorrow);

    const [workouts, steps, weights, checkins] = await Promise.all([
      this.workoutsRepo
        .createQueryBuilder("w")
        .leftJoinAndSelect("w.workoutSets", "s")
        .leftJoinAndSelect("w.cardioSessions", "c")
        .where("w.userId = :userId AND w.performedOn >= :start AND w.performedOn <= :end", {
          userId,
          start,
          end,
        })
        .orderBy("w.performedOn", "DESC")
        .addOrderBy("w.id", "ASC")
        .getMany(),
      this.stepsRepo
        .createQueryBuilder("s")
        .where("s.userId = :userId AND s.date >= :start AND s.date <= :end", { userId, start, end })
        .orderBy("s.date", "ASC")
        .getMany(),
      this.weightsRepo
        .createQueryBuilder("w")
        .where("w.userId = :userId AND w.date >= :start AND w.date <= :end", { userId, start, end })
        .orderBy("w.date", "ASC")
        .getMany(),
      this.checkinsRepo
        .createQueryBuilder("c")
        .where("c.userId = :userId AND c.date >= :start AND c.date <= :end", { userId, start, end })
        .orderBy("c.date", "ASC")
        .getMany(),
    ]);

    const snapshot: OfflineSnapshot = {
      ownerId: userId,
      downloadedAt: new Date().toISOString(),
      workouts: workouts.map((w) => ({
        id: w.id,
        performed_on: String(w.performedOn).slice(0, 10),
        workout_mode: w.workoutMode,
        split: w.split,
        workout_sets: [...(w.workoutSets ?? [])]
          .sort((a, b) => a.setNumber - b.setNumber)
          .map((s) => ({
            id: s.id,
            exercise: s.exercise,
            weight: Number(s.weight),
            reps: s.reps,
            rir: s.rir ?? null,
            set_type: s.setType,
            set_number: s.setNumber,
            notes: s.notes ?? null,
          })),
        cardio_sessions: (w.cardioSessions ?? []).map((c) => ({
          id: c.id,
          activity: c.activity,
          duration_min: c.durationMin,
        })),
      })),
      steps: steps.map((s) => ({ date: String(s.date).slice(0, 10), steps: s.steps })),
      weights: weights.map((w) => ({ date: String(w.date).slice(0, 10), weight_kg: Number(w.weightKg) })),
      checkins: checkins.map((c) => ({
        date: String(c.date).slice(0, 10),
        energy: c.energy ?? null,
        satiety: c.satiety ?? null,
        sleep: c.sleep ?? null,
        note: c.note ?? "",
      })),
    };

    return { snapshot, warning: null };
  }

  async syncMutation(userId: string, dto: OfflineSyncDto): Promise<{ success: true; id: string; deduplicated?: boolean }> {
    if (dto.ownerId !== userId) {
      throw new ConflictException("This entry belongs to another account. Sign in to its original account.");
    }

    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    if (!validOfflinePayload(dto.payload, localDate(tomorrow))) {
      throw new BadRequestException("Invalid offline values. Entries have not been discarded.");
    }

    const payload: OfflinePayload = dto.payload;
    const serializedPayload = JSON.stringify(payload);
    if (Buffer.byteLength(serializedPayload, "utf8") > 2_000_000) {
      throw new BadRequestException("Offline entry is too large");
    }

    const deduplicated = await this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [userId]);

      const existingRows: { same_payload: boolean }[] = await manager.query(
        `SELECT (payload = $3::jsonb) AS same_payload
         FROM public.offline_sync_receipts
         WHERE user_id = $1 AND mutation_id = $2`,
        [userId, dto.id, serializedPayload],
      );

      if (existingRows.length > 0) {
        if (!existingRows[0].same_payload) {
          throw new BadRequestException("Mutation ID already used for another entry");
        }
        return true;
      }

      if (payload.kind === "steps") {
        await manager.query(
          `INSERT INTO public.daily_steps (user_id, date, steps)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, date) DO UPDATE SET steps = EXCLUDED.steps`,
          [userId, payload.date, payload.steps],
        );
      } else if (payload.kind === "weight") {
        await manager.query(
          `INSERT INTO public.daily_weight (user_id, date, weight_kg)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, date) DO UPDATE SET weight_kg = EXCLUDED.weight_kg`,
          [userId, payload.date, payload.weightKg.toFixed(2)],
        );
      } else if (payload.kind === "checkin") {
        await manager.query(
          `INSERT INTO public.daily_checkin (user_id, date, energy, satiety, sleep, note)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (user_id, date) DO UPDATE
             SET energy = EXCLUDED.energy,
                 satiety = EXCLUDED.satiety,
                 sleep = EXCLUDED.sleep,
                 note = EXCLUDED.note`,
          [userId, payload.date, payload.energy, payload.satiety, payload.sleep, payload.note || null],
        );
      } else if (payload.kind === "workout") {
        const split = payload.mode === "strength" ? payload.split : "CARDIO";
        const [workout] = await manager.query(
          `INSERT INTO public.workouts (user_id, performed_on, workout_mode, split, client_id)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id, client_id) WHERE client_id IS NOT NULL DO NOTHING
           RETURNING id`,
          [userId, payload.date, payload.mode, split, dto.id],
        );

        if (workout?.id) {
          if (payload.mode === "strength") {
            const setEntities = payload.sets.map((s) =>
              manager.create(WorkoutSetEntity, {
                workoutId: workout.id,
                userId,
                split: s.split,
                exercise: s.exercise,
                setNumber: s.setNumber,
                reps: s.reps,
                weight: s.weight.toFixed(2),
                rir: s.rir,
                setType: s.setType,
                notes: s.notes || null,
                isPr: !isWarmup(s.setType) && false,
              }),
            );
            await manager.save(setEntities);
          } else {
            const cardioEntities = payload.cardio.map((c) =>
              manager.create(CardioSessionEntity, {
                workoutId: workout.id,
                userId,
                activity: c.activity,
                durationMin: c.durationMin,
              }),
            );
            await manager.save(cardioEntities);
          }
        }
      }

      await manager.query(
        `INSERT INTO public.offline_sync_receipts (user_id, mutation_id, payload)
         VALUES ($1, $2, $3::jsonb)`,
        [userId, dto.id, serializedPayload],
      );

      return false;
    });

    return deduplicated ? { success: true, id: dto.id, deduplicated: true } : { success: true, id: dto.id };
  }
}
