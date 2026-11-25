import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import {
  bestSetAllTime,
  detectPlateau,
  getBestSetFromLastSession,
  getStrengthProgression,
  isStoredSetId,
  isValidWorkoutDate,
  isWarmup,
  recordsByExercise,
  withBodyWeights,
  workoutSplit,
} from "@replog/shared";
import {
  CardioSessionEntity,
  DailyWeightEntity,
  EnrollmentEntity,
  NotificationEntity,
  ProfileEntity,
  WorkoutDraftEntity,
  WorkoutEntity,
  WorkoutSetEntity,
} from "../../database/entities";
import type { CreateWorkoutDto, SaveWorkoutDraftDto, UpdateWorkoutDto } from "./dto/workout.dto";

export interface SerializedWorkoutSet {
  id: string;
  workoutId: string;
  split: string;
  exercise: string;
  setNumber: number;
  reps: number;
  weight: number;
  rir: number | null;
  setType: string;
  notes: string | null;
  isPr: boolean;
  createdAt: string;
}

export interface SerializedCardioSession {
  id: string;
  workoutId: string;
  activity: string;
  durationMin: number;
  createdAt: string;
}

export interface SerializedWorkout {
  id: string;
  performedOn: string;
  split: string;
  workoutMode: "strength" | "cardio";
  programWorkoutId: string | null;
  enrollmentId: string | null;
  createdAt: string;
  sets: SerializedWorkoutSet[];
  cardio: SerializedCardioSession[];
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function serializeWorkout(workout: WorkoutEntity): SerializedWorkout {
  const sets = [...(workout.workoutSets ?? [])]
    .sort((a, b) => a.setNumber - b.setNumber)
    .map((s) => ({
      id: s.id,
      workoutId: s.workoutId,
      split: s.split,
      exercise: s.exercise,
      setNumber: s.setNumber,
      reps: s.reps,
      weight: Number(s.weight),
      rir: s.rir ?? null,
      setType: s.setType,
      notes: s.notes ?? null,
      isPr: Boolean(s.isPr),
      createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : String(s.createdAt),
    }));

  const cardio = [...(workout.cardioSessions ?? [])]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((c) => ({
      id: c.id,
      workoutId: c.workoutId,
      activity: c.activity,
      durationMin: c.durationMin,
      createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt),
    }));

  return {
    id: workout.id,
    performedOn: String(workout.performedOn).slice(0, 10),
    split: workout.split,
    workoutMode: workout.workoutMode,
    programWorkoutId: workout.programWorkoutId ?? null,
    enrollmentId: workout.enrollmentId ?? null,
    createdAt: workout.createdAt instanceof Date ? workout.createdAt.toISOString() : String(workout.createdAt),
    sets,
    cardio,
  };
}

@Injectable()
export class WorkoutsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(WorkoutEntity)
    private readonly workoutsRepo: Repository<WorkoutEntity>,
    @InjectRepository(WorkoutSetEntity)
    private readonly setsRepo: Repository<WorkoutSetEntity>,
    @InjectRepository(WorkoutDraftEntity)
    private readonly draftsRepo: Repository<WorkoutDraftEntity>,
    @InjectRepository(DailyWeightEntity)
    private readonly weightsRepo: Repository<DailyWeightEntity>,
  ) {}

  async list(
    userId: string,
    query: { from?: string; to?: string; mode?: string; limit?: number; offset?: number },
  ): Promise<{ items: SerializedWorkout[]; total: number }> {
    const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
    const offset = Math.max(Number(query.offset) || 0, 0);

    const qb = this.workoutsRepo
      .createQueryBuilder("w")
      .leftJoinAndSelect("w.workoutSets", "s")
      .leftJoinAndSelect("w.cardioSessions", "c")
      .where("w.userId = :userId", { userId })
      .orderBy("w.performedOn", "DESC")
      .addOrderBy("w.createdAt", "DESC")
      .skip(offset)
      .take(limit);

    if (query.from && DATE_REGEX.test(query.from)) {
      qb.andWhere("w.performedOn >= :from", { from: query.from });
    }
    if (query.to && DATE_REGEX.test(query.to)) {
      qb.andWhere("w.performedOn <= :to", { to: query.to });
    }
    if (query.mode === "strength" || query.mode === "cardio") {
      qb.andWhere("w.workoutMode = :mode", { mode: query.mode });
    }

    const [rows, total] = await qb.getManyAndCount();
    return { items: rows.map(serializeWorkout), total };
  }

  async findOne(userId: string, id: string): Promise<SerializedWorkout> {
    if (!UUID_REGEX.test(id)) {
      throw new NotFoundException("Workout not found");
    }
    const workout = await this.workoutsRepo.findOne({
      where: { id, userId },
      relations: { workoutSets: true, cardioSessions: true },
    });
    if (!workout) {
      throw new NotFoundException("Workout not found");
    }
    return serializeWorkout(workout);
  }

  async create(userId: string, dto: CreateWorkoutDto): Promise<SerializedWorkout & { prExercises: string[] }> {
    const today = new Date().toISOString().slice(0, 10);
    if (!isValidWorkoutDate(dto.date, today)) {
      throw new BadRequestException("Invalid workout date");
    }
    this.validateModeEntries(dto.mode, dto.sets.length, dto.cardio.length);

    const resolvedSplit = dto.mode === "strength" ? workoutSplit(dto.sets, dto.split.trim()) : "CARDIO";

    const { workoutId, prExercises } = await this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [userId]);

      if (dto.enrollmentId) {
        const enrollment = await manager.findOne(EnrollmentEntity, {
          where: { id: dto.enrollmentId, clientId: userId },
          select: { id: true },
        });
        if (!enrollment) {
          throw new BadRequestException("Invalid enrollment");
        }
      }

      if (dto.programWorkoutId) {
        const [pw] = await manager.query(
          `SELECT id FROM public.program_workouts WHERE id = $1 LIMIT 1`,
          [dto.programWorkoutId],
        );
        if (!pw) {
          throw new BadRequestException("Invalid program workout");
        }
      }

      const workout = manager.create(WorkoutEntity, {
        userId,
        performedOn: dto.date,
        workoutMode: dto.mode,
        split: resolvedSplit,
        programWorkoutId: dto.programWorkoutId ?? null,
        enrollmentId: dto.enrollmentId ?? null,
      });
      await manager.save(workout);

      const detectedPrExercises: string[] = [];

      if (dto.mode === "strength") {
        // Compute previous best per exercise once before inserting this workout's sets.
        const uniqueExercises = [...new Set(dto.sets.map((s) => s.exercise.trim()))];
        const baselineByExercise = new Map<string, { weight: number; reps: number }>();

        for (const exercise of uniqueExercises) {
          const prevRows: { weight: string; reps: number }[] = await manager.query(
            `SELECT weight, reps
             FROM public.workout_sets
             WHERE user_id = $1 AND exercise = $2 AND set_type <> 'Warmup'
             ORDER BY weight DESC, reps DESC
             LIMIT 1`,
            [userId, exercise],
          );
          if (prevRows.length > 0) {
            baselineByExercise.set(exercise, {
              weight: Number(prevRows[0].weight),
              reps: Number(prevRows[0].reps),
            });
          }
        }

        const setEntities: WorkoutSetEntity[] = [];
        for (const s of dto.sets) {
          const exercise = s.exercise.trim();
          const setType = s.setType.trim();
          let setIsPr = false;

          if (!isWarmup(setType)) {
            const prev = baselineByExercise.get(exercise);
            if (prev && (s.weight > prev.weight || (s.weight === prev.weight && s.reps > prev.reps))) {
              setIsPr = true;
              baselineByExercise.set(exercise, { weight: s.weight, reps: s.reps });
              if (!detectedPrExercises.includes(exercise)) {
                detectedPrExercises.push(exercise);
              }
            }
          }

          setEntities.push(
            manager.create(WorkoutSetEntity, {
              workoutId: workout.id,
              userId,
              split: s.split.trim(),
              exercise,
              setNumber: s.setNumber,
              reps: s.reps,
              weight: s.weight.toFixed(2),
              rir: s.rir ?? null,
              setType,
              notes: s.notes?.trim() ? s.notes.trim() : null,
              isPr: setIsPr,
            }),
          );
        }
        await manager.save(setEntities);
      } else {
        const cardioEntities = dto.cardio.map((c) =>
          manager.create(CardioSessionEntity, {
            workoutId: workout.id,
            userId,
            activity: c.activity.trim(),
            durationMin: c.durationMin,
          }),
        );
        await manager.save(cardioEntities);
      }

      if (detectedPrExercises.length > 0) {
        const activeEnrollments = await manager.find(EnrollmentEntity, {
          where: { clientId: userId, status: "active" },
          select: { coachId: true },
        });
        const uniqueCoachIds = [...new Set(activeEnrollments.map((e) => e.coachId))].filter((id) => id !== userId);

        if (uniqueCoachIds.length > 0) {
          const profile = await manager.findOne(ProfileEntity, {
            where: { id: userId },
            select: { displayName: true },
          });
          const clientName = profile?.displayName ?? "";

          const notifications = uniqueCoachIds.map((coachId) =>
            manager.create(NotificationEntity, {
              userId: coachId,
              actorId: userId,
              type: "client_pr",
              payload: {
                client_name: clientName,
                workout_id: workout.id,
                exercises: detectedPrExercises,
              },
              link: `/coach/clients/${userId}`,
            }),
          );
          await manager.save(notifications);
        }
      }

      return { workoutId: workout.id, prExercises: detectedPrExercises };
    });

    const created = await this.findOne(userId, workoutId);
    return { ...created, prExercises };
  }

  async update(userId: string, id: string, dto: UpdateWorkoutDto): Promise<SerializedWorkout> {
    if (!UUID_REGEX.test(id)) {
      throw new NotFoundException("Workout not found");
    }
    const today = new Date().toISOString().slice(0, 10);
    if (!isValidWorkoutDate(dto.date, today)) {
      throw new BadRequestException("Invalid workout date");
    }
    this.validateModeEntries(dto.mode, dto.sets.length, dto.cardio.length);

    await this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [userId]);

      const workout = await manager.findOne(WorkoutEntity, { where: { id, userId } });
      if (!workout) {
        throw new NotFoundException("Workout not found");
      }

      workout.workoutMode = dto.mode;
      workout.split = dto.mode === "strength" ? dto.split.trim() : "CARDIO";
      workout.performedOn = dto.date;
      await manager.save(workout);

      if (dto.mode === "strength") {
        await manager.delete(CardioSessionEntity, { workoutId: id, userId });

        const existingSets = await manager.find(WorkoutSetEntity, { where: { workoutId: id, userId } });
        const existingById = new Map(existingSets.map((row) => [row.id, row]));
        const keptIds = new Set<string>();

        const toUpdate: WorkoutSetEntity[] = [];
        const toInsert: WorkoutSetEntity[] = [];

        dto.sets.forEach((s, index) => {
          const setNumber = index + 1;
          const notes = s.notes?.trim() ? s.notes.trim() : null;

          if (isStoredSetId(s.id) && existingById.has(s.id)) {
            const existing = existingById.get(s.id)!;
            keptIds.add(existing.id);
            existing.split = s.split.trim();
            existing.exercise = s.exercise.trim();
            existing.setNumber = setNumber;
            existing.reps = s.reps;
            existing.weight = s.weight.toFixed(2);
            existing.rir = s.rir ?? null;
            existing.setType = s.setType.trim();
            existing.notes = notes;
            toUpdate.push(existing);
          } else {
            toInsert.push(
              manager.create(WorkoutSetEntity, {
                workoutId: id,
                userId,
                split: s.split.trim(),
                exercise: s.exercise.trim(),
                setNumber,
                reps: s.reps,
                weight: s.weight.toFixed(2),
                rir: s.rir ?? null,
                setType: s.setType.trim(),
                notes,
                isPr: false,
              }),
            );
          }
        });

        const toDeleteIds = existingSets.filter((row) => !keptIds.has(row.id)).map((row) => row.id);
        if (toDeleteIds.length > 0) {
          await manager
            .createQueryBuilder()
            .delete()
            .from(WorkoutSetEntity)
            .where("user_id = :userId AND workout_id = :workoutId AND id IN (:...ids)", {
              userId,
              workoutId: id,
              ids: toDeleteIds,
            })
            .execute();
        }
        if (toUpdate.length > 0) await manager.save(toUpdate);
        if (toInsert.length > 0) await manager.save(toInsert);
      } else {
        await manager.delete(WorkoutSetEntity, { workoutId: id, userId });
        await manager.delete(CardioSessionEntity, { workoutId: id, userId });

        const cardioEntities = dto.cardio.map((c) =>
          manager.create(CardioSessionEntity, {
            workoutId: id,
            userId,
            activity: c.activity.trim(),
            durationMin: c.durationMin,
          }),
        );
        await manager.save(cardioEntities);
      }
    });

    return this.findOne(userId, id);
  }

  async remove(userId: string, id: string): Promise<{ deleted: true }> {
    if (!UUID_REGEX.test(id)) {
      throw new NotFoundException("Workout not found");
    }
    const result = await this.workoutsRepo.delete({ id, userId });
    if (!result.affected) {
      throw new NotFoundException("Workout not found");
    }
    return { deleted: true };
  }

  async getDraft(userId: string) {
    const draft = await this.draftsRepo.findOne({ where: { userId } });
    if (!draft) return null;
    return {
      draft: draft.draft,
      clientUpdatedAt: draft.clientUpdatedAt.toISOString(),
      updatedAt: draft.updatedAt.toISOString(),
    };
  }

  async saveDraft(userId: string, dto: SaveWorkoutDraftDto): Promise<{ saved: boolean }> {
    const serialized = JSON.stringify(dto.draft);
    if (Buffer.byteLength(serialized, "utf8") > 1_000_000) {
      throw new BadRequestException("Workout draft is too large");
    }

    const clientUpdatedAt = new Date(dto.clientUpdatedAt);
    if (!Number.isFinite(clientUpdatedAt.getTime()) || clientUpdatedAt.getTime() > Date.now() + 86_400_000) {
      throw new BadRequestException("Invalid draft timestamp");
    }

    const insertedOrUpdated: { user_id: string }[] = await this.dataSource.query(
      `INSERT INTO public.workout_drafts AS existing (user_id, draft, client_updated_at)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (user_id) DO UPDATE
         SET draft = EXCLUDED.draft,
             client_updated_at = EXCLUDED.client_updated_at,
             updated_at = now()
         WHERE existing.client_updated_at < EXCLUDED.client_updated_at
       RETURNING user_id`,
      [userId, serialized, clientUpdatedAt.toISOString()],
    );

    if (insertedOrUpdated.length > 0) {
      return { saved: true };
    }

    const [same] = await this.dataSource.query(
      `SELECT 1 FROM public.workout_drafts
       WHERE user_id = $1 AND client_updated_at = $2 AND draft = $3::jsonb
       LIMIT 1`,
      [userId, clientUpdatedAt.toISOString(), serialized],
    );
    return { saved: Boolean(same) };
  }

  async deleteDraft(userId: string): Promise<{ deleted: true }> {
    await this.draftsRepo.delete({ userId });
    return { deleted: true };
  }

  async getRecords(userId: string) {
    const rows: { exercise: string; weight: string; reps: number; rir: number | null; set_type: string; performed_on: string }[] =
      await this.dataSource.query(
        `SELECT s.exercise, s.weight, s.reps, s.rir, s.set_type, w.performed_on::text AS performed_on
         FROM public.workout_sets s
         JOIN public.workouts w ON w.id = s.workout_id
         WHERE s.user_id = $1`,
        [userId],
      );

    return recordsByExercise(
      rows.map((r) => ({
        exercise: r.exercise,
        weight: Number(r.weight),
        reps: Number(r.reps),
        rir: r.rir ?? null,
        set_type: r.set_type,
        performed_on: r.performed_on.slice(0, 10),
      })),
    );
  }

  async getStats(userId: string, query: { exercise?: string; from?: string; to?: string }) {
    const params: unknown[] = [userId];
    const conditions = ["w.user_id = $1"];
    if (query.from && DATE_REGEX.test(query.from)) {
      params.push(query.from);
      conditions.push(`w.performed_on >= $${params.length}`);
    }
    if (query.to && DATE_REGEX.test(query.to)) {
      params.push(query.to);
      conditions.push(`w.performed_on <= $${params.length}`);
    }
    const whereSql = conditions.join(" AND ");

    const [summaryRow] = await this.dataSource.query(
      `SELECT
         COUNT(DISTINCT w.id)::int AS total_workouts,
         COUNT(DISTINCT w.id) FILTER (WHERE w.workout_mode = 'strength')::int AS strength_workouts,
         COUNT(DISTINCT w.id) FILTER (WHERE w.workout_mode = 'cardio')::int AS cardio_workouts
       FROM public.workouts w
       WHERE ${whereSql}`,
      params,
    );

    const [setTotals] = await this.dataSource.query(
      `SELECT
         COUNT(s.id)::int AS total_sets,
         COALESCE(SUM(CASE WHEN s.set_type <> 'Warmup' THEN s.weight * s.reps ELSE 0 END), 0)::float8 AS total_volume_kg
       FROM public.workout_sets s
       JOIN public.workouts w ON w.id = s.workout_id
       WHERE ${whereSql}`,
      params,
    );

    const [cardioTotals] = await this.dataSource.query(
      `SELECT COALESCE(SUM(c.duration_min), 0)::int AS total_cardio_min
       FROM public.cardio_sessions c
       JOIN public.workouts w ON w.id = c.workout_id
       WHERE ${whereSql}`,
      params,
    );

    let progression: ReturnType<typeof withBodyWeights> | null = null;
    if (query.exercise?.trim()) {
      const exerciseName = query.exercise.trim();
      const setParams = [...params, exerciseName];
      const exerciseSets: {
        workout_id: string;
        exercise: string;
        weight: string;
        reps: number;
        set_type: string;
        performed_on: string;
      }[] = await this.dataSource.query(
        `SELECT w.id AS workout_id, s.exercise, s.weight, s.reps, s.set_type, w.performed_on::text AS performed_on
         FROM public.workout_sets s
         JOIN public.workouts w ON w.id = s.workout_id
         WHERE ${whereSql} AND w.workout_mode = 'strength' AND s.exercise = $${setParams.length}
         ORDER BY w.performed_on ASC, s.set_number ASC`,
        setParams,
      );

      const byWorkout = new Map<
        string,
        { performed_on: string; workout_mode: string; workout_sets: { exercise: string; weight: number; reps: number; set_type: string }[] }
      >();
      for (const s of exerciseSets) {
        let bucket = byWorkout.get(s.workout_id);
        if (!bucket) {
          bucket = { performed_on: s.performed_on.slice(0, 10), workout_mode: "strength", workout_sets: [] };
          byWorkout.set(s.workout_id, bucket);
        }
        bucket.workout_sets.push({
          exercise: s.exercise,
          weight: Number(s.weight),
          reps: Number(s.reps),
          set_type: s.set_type,
        });
      }

      const points = getStrengthProgression([...byWorkout.values()], exerciseName);

      const weights = await this.weightsRepo.find({
        where: { userId },
        order: { date: "ASC" },
      });
      progression = withBodyWeights(
        points,
        weights.map((w) => ({ date: String(w.date).slice(0, 10), weight_kg: Number(w.weightKg) })),
      );
    }

    return {
      totalWorkouts: summaryRow?.total_workouts ?? 0,
      strengthWorkouts: summaryRow?.strength_workouts ?? 0,
      cardioWorkouts: summaryRow?.cardio_workouts ?? 0,
      totalSets: setTotals?.total_sets ?? 0,
      totalVolumeKg: Math.round((setTotals?.total_volume_kg ?? 0) * 100) / 100,
      totalCardioMin: cardioTotals?.total_cardio_min ?? 0,
      progression,
    };
  }

  async getExerciseHistory(userId: string, exercise: string) {
    const cleanExercise = exercise.trim();
    if (!cleanExercise) {
      throw new BadRequestException("Exercise name is required");
    }

    const rows: {
      weight: string;
      reps: number;
      rir: number | null;
      set_type: string;
      notes: string | null;
      performed_on: string;
      created_at: Date;
    }[] = await this.dataSource.query(
      `SELECT s.weight, s.reps, s.rir, s.set_type, s.notes, w.performed_on::text AS performed_on, s.created_at
       FROM public.workout_sets s
       JOIN public.workouts w ON w.id = s.workout_id
       WHERE s.user_id = $1 AND s.exercise = $2
       ORDER BY w.performed_on DESC, s.set_number ASC`,
      [userId, cleanExercise],
    );

    const mapped = rows.map((r) => ({
      weight: Number(r.weight),
      reps: Number(r.reps),
      rir: r.rir,
      set_type: r.set_type,
      notes: r.notes,
      performed_on: r.performed_on.slice(0, 10),
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      workouts: { performed_on: r.performed_on.slice(0, 10) },
    }));

    return {
      exercise: cleanExercise,
      bestAllTime: bestSetAllTime(mapped),
      lastSessionBest: getBestSetFromLastSession(mapped),
      plateau: detectPlateau(mapped),
      recentSets: mapped.slice(0, 50),
    };
  }

  private validateModeEntries(mode: "strength" | "cardio", setsCount: number, cardioCount: number): void {
    if (mode === "strength" && (setsCount === 0 || cardioCount > 0)) {
      throw new BadRequestException("Strength workouts require at least one set and no cardio sessions");
    }
    if (mode === "cardio" && (cardioCount === 0 || setsCount > 0)) {
      throw new BadRequestException("Cardio workouts require at least one cardio session and no sets");
    }
  }
}
