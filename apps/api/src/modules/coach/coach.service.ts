import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import { DataSource, In, IsNull, Repository } from "typeorm";
import {
  PHOTO_MAX_BYTES,
  checkinPhotoPath,
  checkinPhotoPathsFromRow,
  classifyClientAdherence,
  cutoffDateYmd,
  diffRemovedCheckinPhotoPaths,
  generateInviteCode,
  isValidInviteCode,
  localDate,
  mondayOfWeek,
  normalizeInviteCode,
  parseRangeDays,
  pickNextProgramWorkout,
  summarizeNutritionByDay,
  validateCheckinPhotoPaths,
  validateFeedbackInput,
  validateProgramPayload,
  validateWeeklyCheckinInput,
} from "@replog/shared";
import { isJpegBuffer } from "../../storage/photo-crypto";
import {
  CoachClientNoteEntity,
  CoachProfileEntity,
  DailyCheckinEntity,
  DailyStepsEntity,
  DailyWeightEntity,
  EnrollmentEntity,
  MealEntity,
  MealPlanEntity,
  ProfileEntity,
  ProgramEntity,
  ProgramWorkoutCardioEntity,
  ProgramWorkoutEntity,
  ProgramWorkoutExerciseEntity,
  UserTargetEntity,
  WeeklyCheckinEntity,
  WorkoutEntity,
  WorkoutFeedbackEntity,
} from "../../database/entities";
import { StorageService } from "../../storage/storage.service";
import { NotificationsService } from "../notifications/notifications.service";
import type {
  AddWorkoutFeedbackDto,
  EnrollInProgramDto,
  ReviewWeeklyCheckinDto,
  SaveProgramDto,
  SubmitWeeklyCheckinDto,
} from "./dto/coach.dto";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tEn = (_ro: string, en: string) => en;

function serializeProgram(program: ProgramEntity) {
  return {
    id: program.id,
    coachId: program.coachId,
    assignedClientId: program.assignedClientId ?? null,
    title: program.title,
    description: program.description ?? null,
    difficulty: program.difficulty,
    durationWeeks: program.durationWeeks,
    goal: program.goal,
    status: program.status,
    accessType: program.accessType,
    requiresApproval: program.requiresApproval,
    inviteCode: program.inviteCode ?? null,
    createdAt: program.createdAt.toISOString(),
    updatedAt: program.updatedAt.toISOString(),
    ...(program.workouts
      ? {
          workouts: [...program.workouts]
            .sort((a, b) => a.weekNumber - b.weekNumber || a.dayNumber - b.dayNumber || a.position - b.position)
            .map((w) => ({
              id: w.id,
              weekNumber: w.weekNumber,
              dayNumber: w.dayNumber,
              position: w.position,
              title: w.title,
              workoutMode: w.workoutMode,
              split: w.split,
              notes: w.notes ?? null,
              exercises: [...(w.exercises ?? [])]
                .sort((a, b) => a.position - b.position)
                .map((e) => ({
                  id: e.id,
                  position: e.position,
                  exercise: e.exercise,
                  setType: e.setType,
                  targetSets: e.targetSets,
                  targetRepsMin: e.targetRepsMin,
                  targetRepsMax: e.targetRepsMax,
                  targetRir: e.targetRir ?? null,
                  targetWeightKg: e.targetWeightKg !== null ? Number(e.targetWeightKg) : null,
                  restSeconds: e.restSeconds ?? null,
                  notes: e.notes ?? null,
                })),
              cardio: [...(w.cardio ?? [])]
                .sort((a, b) => a.position - b.position)
                .map((c) => ({
                  id: c.id,
                  position: c.position,
                  activity: c.activity,
                  targetDurationMin: c.targetDurationMin,
                  notes: c.notes ?? null,
                })),
            })),
        }
      : {}),
  };
}

@Injectable()
export class CoachService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ProgramEntity)
    private readonly programsRepo: Repository<ProgramEntity>,
    @InjectRepository(ProgramWorkoutEntity)
    private readonly programWorkoutsRepo: Repository<ProgramWorkoutEntity>,
    @InjectRepository(EnrollmentEntity)
    private readonly enrollmentsRepo: Repository<EnrollmentEntity>,
    @InjectRepository(CoachProfileEntity)
    private readonly coachProfilesRepo: Repository<CoachProfileEntity>,
    @InjectRepository(ProfileEntity)
    private readonly profilesRepo: Repository<ProfileEntity>,
    @InjectRepository(CoachClientNoteEntity)
    private readonly notesRepo: Repository<CoachClientNoteEntity>,
    @InjectRepository(WorkoutEntity)
    private readonly workoutsRepo: Repository<WorkoutEntity>,
    @InjectRepository(WorkoutFeedbackEntity)
    private readonly feedbackRepo: Repository<WorkoutFeedbackEntity>,
    @InjectRepository(WeeklyCheckinEntity)
    private readonly checkinsRepo: Repository<WeeklyCheckinEntity>,
    @InjectRepository(DailyStepsEntity)
    private readonly stepsRepo: Repository<DailyStepsEntity>,
    @InjectRepository(DailyWeightEntity)
    private readonly weightRepo: Repository<DailyWeightEntity>,
    @InjectRepository(DailyCheckinEntity)
    private readonly dailyCheckinRepo: Repository<DailyCheckinEntity>,
    @InjectRepository(MealEntity)
    private readonly mealsRepo: Repository<MealEntity>,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  // =========================================================================
  // Coach Programs CRUD & Cloning
  // =========================================================================

  async listCoachPrograms(coachId: string) {
    const rows = await this.programsRepo.find({
      where: { coachId },
      relations: { workouts: true },
      order: { updatedAt: "DESC" },
    });
    const programIds = rows.map((p) => p.id);
    const enrollments =
      programIds.length > 0
        ? await this.enrollmentsRepo.find({
            where: { coachId, programId: In(programIds) },
            select: { id: true, programId: true, status: true },
          })
        : [];
    const byProgram = new Map<string, { active: number; pending: number }>();
    for (const e of enrollments) {
      if (!e.programId) continue;
      const entry = byProgram.get(e.programId) ?? { active: 0, pending: 0 };
      if (e.status === "active") entry.active++;
      else if (e.status === "pending") entry.pending++;
      byProgram.set(e.programId, entry);
    }
    return rows.map((p) => {
      const counts = byProgram.get(p.id) ?? { active: 0, pending: 0 };
      return {
        ...serializeProgram(p),
        workoutCount: p.workouts?.length ?? 0,
        activeEnrollmentsCount: counts.active,
        pendingEnrollmentsCount: counts.pending,
      };
    });
  }

  async getCoachProgram(coachId: string, id: string) {
    if (!UUID_REGEX.test(id)) throw new NotFoundException("Program not found");
    const program = await this.programsRepo.findOne({
      where: { id, coachId },
      relations: { workouts: { exercises: true, cardio: true } },
    });
    if (!program) throw new NotFoundException("Program not found");
    return serializeProgram(program);
  }

  async saveProgram(coachId: string, dto: SaveProgramDto, programId?: string) {
    const checked = validateProgramPayload(
      {
        id: programId,
        title: dto.title,
        description: dto.description ?? "",
        difficulty: dto.difficulty,
        durationWeeks: dto.durationWeeks,
        goal: dto.goal,
        status: dto.status,
        accessType: dto.accessType,
        requiresApproval: dto.requiresApproval,
        inviteCode: dto.inviteCode ?? null,
        workouts: dto.workouts.map((w) => ({
          id: w.id,
          weekNumber: w.weekNumber,
          dayNumber: w.dayNumber,
          title: w.title,
          workoutMode: w.workoutMode,
          split: w.split,
          notes: w.notes ?? "",
          exercises: w.exercises.map((e) => ({
            id: e.id,
            exercise: e.exercise,
            setType: e.setType,
            targetSets: e.targetSets,
            targetRepsMin: e.targetRepsMin,
            targetRepsMax: e.targetRepsMax,
            targetRir: e.targetRir ?? null,
            targetWeightKg: e.targetWeightKg ?? null,
            restSeconds: e.restSeconds ?? null,
            notes: e.notes ?? "",
          })),
          cardio: w.cardio.map((c) => ({
            id: c.id,
            activity: c.activity,
            targetDurationMin: c.targetDurationMin,
            notes: c.notes ?? "",
          })),
        })),
      },
      tEn,
    );

    if (!checked.ok) {
      throw new BadRequestException(checked.error);
    }
    const data = checked.data;

    try {
      const savedId = await this.dataSource.transaction(async (manager) => {
        let targetProgram: ProgramEntity;
        if (programId) {
          if (!UUID_REGEX.test(programId)) throw new NotFoundException("Program not found");
          const existing = await manager.findOne(ProgramEntity, { where: { id: programId, coachId } });
          if (!existing) throw new NotFoundException("Program not found");
          Object.assign(existing, {
            title: data.title,
            description: data.description,
            difficulty: data.difficulty,
            durationWeeks: data.durationWeeks,
            goal: data.goal,
            status: data.status,
            accessType: data.accessType,
            requiresApproval: data.requiresApproval,
            inviteCode: data.inviteCode,
          });
          targetProgram = await manager.save(existing);
        } else {
          targetProgram = await manager.save(
            manager.create(ProgramEntity, {
              coachId,
              title: data.title,
              description: data.description,
              difficulty: data.difficulty,
              durationWeeks: data.durationWeeks,
              goal: data.goal,
              status: data.status,
              accessType: data.accessType,
              requiresApproval: data.requiresApproval,
              inviteCode: data.inviteCode,
            }),
          );
        }

        const existingWorkouts = await manager.find(ProgramWorkoutEntity, {
          where: { programId: targetProgram.id },
          select: { id: true },
        });
        const existingIds = new Set(existingWorkouts.map((w) => w.id));
        const keptIds = new Set<string>();

        for (let i = 0; i < data.workouts.length; i++) {
          const w = data.workouts[i];
          let workoutId: string;

          if (w.id && existingIds.has(w.id)) {
            await manager.update(
              ProgramWorkoutEntity,
              { id: w.id, programId: targetProgram.id },
              {
                weekNumber: w.weekNumber,
                dayNumber: w.dayNumber,
                position: i + 1,
                title: w.title,
                workoutMode: w.workoutMode,
                split: w.split,
                notes: w.notes || null,
              },
            );
            workoutId = w.id;
          } else {
            const inserted = await manager.save(
              manager.create(ProgramWorkoutEntity, {
                programId: targetProgram.id,
                weekNumber: w.weekNumber,
                dayNumber: w.dayNumber,
                position: i + 1,
                title: w.title,
                workoutMode: w.workoutMode,
                split: w.split,
                notes: w.notes || null,
              }),
            );
            workoutId = inserted.id;
          }
          keptIds.add(workoutId);

          await manager.delete(ProgramWorkoutExerciseEntity, { programWorkoutId: workoutId });
          await manager.delete(ProgramWorkoutCardioEntity, { programWorkoutId: workoutId });

          if (w.workoutMode === "strength" && w.exercises.length > 0) {
            await manager.save(
              w.exercises.map((ex, idx) =>
                manager.create(ProgramWorkoutExerciseEntity, {
                  programWorkoutId: workoutId,
                  position: idx + 1,
                  exercise: ex.exercise,
                  setType: ex.setType,
                  targetSets: ex.targetSets,
                  targetRepsMin: ex.targetRepsMin,
                  targetRepsMax: ex.targetRepsMax,
                  targetRir: ex.targetRir,
                  targetWeightKg: ex.targetWeightKg !== null ? ex.targetWeightKg.toFixed(2) : null,
                  restSeconds: ex.restSeconds,
                  notes: ex.notes || null,
                }),
              ),
            );
          }

          if (w.workoutMode === "cardio" && w.cardio.length > 0) {
            await manager.save(
              w.cardio.map((c, idx) =>
                manager.create(ProgramWorkoutCardioEntity, {
                  programWorkoutId: workoutId,
                  position: idx + 1,
                  activity: c.activity,
                  targetDurationMin: c.targetDurationMin,
                  notes: c.notes || null,
                }),
              ),
            );
          }
        }

        const toDelete = [...existingIds].filter((id) => !keptIds.has(id));
        if (toDelete.length > 0) {
          await manager.delete(ProgramWorkoutEntity, { id: In(toDelete), programId: targetProgram.id });
        }

        return targetProgram.id;
      });

      return this.getCoachProgram(coachId, savedId);
    } catch (err) {
      const code = (err as { driverError?: { code?: string }; code?: string })?.driverError?.code;
      if (code === "23505") {
        throw new ConflictException("Invite code is already in use");
      }
      throw err;
    }
  }

  async regenerateInviteCode(coachId: string, programId: string): Promise<{ inviteCode: string }> {
    if (!UUID_REGEX.test(programId)) throw new NotFoundException("Program not found");
    const existing = await this.programsRepo.findOne({ where: { id: programId, coachId } });
    if (!existing) throw new NotFoundException("Program not found");

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateInviteCode(8);
      try {
        await this.programsRepo.update({ id: programId, coachId }, { inviteCode: code });
        return { inviteCode: code };
      } catch (err) {
        const pgCode = (err as { driverError?: { code?: string } })?.driverError?.code;
        if (pgCode !== "23505") throw err;
      }
    }
    throw new ConflictException("Could not generate a unique invite code");
  }

  async cloneProgramForClient(coachId: string, programId: string, clientId: string) {
    if (!UUID_REGEX.test(programId)) throw new NotFoundException("Program not found");
    if (coachId === clientId) throw new BadRequestException("Cannot clone a program for yourself");

    const source = await this.programsRepo.findOne({
      where: { id: programId, coachId },
      relations: { workouts: { exercises: true, cardio: true } },
    });
    if (!source) throw new NotFoundException("Program not found");

    const activeEnrollment = await this.enrollmentsRepo.findOne({
      where: { coachId, clientId, status: "active" },
      order: { createdAt: "DESC" },
    });
    if (!activeEnrollment) {
      throw new ForbiddenException("Active coach-client enrollment required");
    }

    const clonedId = await this.dataSource.transaction(async (manager) => {
      const cloned = await manager.save(
        manager.create(ProgramEntity, {
          coachId,
          assignedClientId: clientId,
          title: source.title,
          description: source.description,
          difficulty: source.difficulty,
          durationWeeks: source.durationWeeks,
          goal: source.goal,
          status: "published",
          accessType: "invite_only",
          requiresApproval: false,
          inviteCode: null,
        }),
      );

      for (const w of source.workouts ?? []) {
        const clonedWorkout = await manager.save(
          manager.create(ProgramWorkoutEntity, {
            programId: cloned.id,
            weekNumber: w.weekNumber,
            dayNumber: w.dayNumber,
            position: w.position,
            title: w.title,
            workoutMode: w.workoutMode,
            split: w.split,
            notes: w.notes,
          }),
        );

        if (w.exercises && w.exercises.length > 0) {
          await manager.save(
            w.exercises.map((e) =>
              manager.create(ProgramWorkoutExerciseEntity, {
                programWorkoutId: clonedWorkout.id,
                position: e.position,
                exercise: e.exercise,
                setType: e.setType,
                targetSets: e.targetSets,
                targetRepsMin: e.targetRepsMin,
                targetRepsMax: e.targetRepsMax,
                targetRir: e.targetRir,
                targetWeightKg: e.targetWeightKg,
                restSeconds: e.restSeconds,
                notes: e.notes,
              }),
            ),
          );
        }

        if (w.cardio && w.cardio.length > 0) {
          await manager.save(
            w.cardio.map((c) =>
              manager.create(ProgramWorkoutCardioEntity, {
                programWorkoutId: clonedWorkout.id,
                position: c.position,
                activity: c.activity,
                targetDurationMin: c.targetDurationMin,
                notes: c.notes,
              }),
            ),
          );
        }
      }

      await manager.update(
        EnrollmentEntity,
        { id: activeEnrollment.id },
        { programId: cloned.id, currentWeek: 1, assignedByCoach: true },
      );

      return cloned.id;
    });

    await this.notifications.notify(
      clientId,
      coachId,
      "program_assigned",
      { program_id: clonedId, program_title: source.title },
      "/",
    );

    return this.getCoachProgram(coachId, clonedId);
  }

  async deleteProgram(coachId: string, programId: string): Promise<{ deleted: true }> {
    if (!UUID_REGEX.test(programId)) throw new NotFoundException("Program not found");
    const res = await this.programsRepo.delete({ id: programId, coachId });
    if (!res.affected) throw new NotFoundException("Program not found");
    return { deleted: true };
  }

  // =========================================================================
  // Coach Dashboard, Clients & Enrollments Management
  // =========================================================================

  async getDashboard(coachId: string) {
    const today = localDate();
    const recentCutoff = cutoffDateYmd(today, 14);
    const [enrollments, unreviewedCheckinRows, programs, mealPlansCount] = await Promise.all([
      this.enrollmentsRepo.find({ where: { coachId }, order: { createdAt: "DESC" } }),
      this.checkinsRepo.find({
        where: { coachId, reviewedAt: IsNull() },
        order: { createdAt: "DESC" },
        take: 20,
      }),
      this.programsRepo.find({ where: { coachId }, select: { id: true, title: true, status: true } }),
      this.dataSource.getRepository(MealPlanEntity).count({ where: { coachId } }),
    ]);

    const programMap = new Map(programs.map((p) => [p.id, p.title]));
    const publishedProgramsCount = programs.filter((p) => p.status === "published").length;

    const activeEnrollments = enrollments.filter((e) => e.status === "active");
    const pendingEnrollments = enrollments.filter((e) => e.status === "pending");
    const activeClientIds = [...new Set(activeEnrollments.map((e) => e.clientId))];
    const allClientIds = [...new Set(enrollments.map((e) => e.clientId))];

    const [profiles, coachProfile] = await Promise.all([
      allClientIds.length > 0
        ? this.profilesRepo.find({ where: { id: In(allClientIds) }, select: { id: true, displayName: true } })
        : Promise.resolve([]),
      this.coachProfilesRepo.findOne({ where: { userId: coachId }, select: { displayName: true } }),
    ]);
    const clientNameMap = new Map(profiles.map((p) => [p.id, p.displayName?.trim() || null]));
    const coachName = coachProfile?.displayName?.trim() || "Coach";

    const lastWorkoutByClient = new Map<string, string>();
    let recentWorkoutsRaw: WorkoutEntity[] = [];
    if (activeClientIds.length > 0) {
      const [lastRows, recentData] = await Promise.all([
        this.dataSource.query<{ user_id: string; last_date: string }[]>(
          `SELECT user_id, MAX(performed_on)::text AS last_date
           FROM public.workouts
           WHERE user_id = ANY($1::uuid[])
           GROUP BY user_id`,
          [activeClientIds],
        ),
        this.workoutsRepo
          .createQueryBuilder("w")
          .leftJoinAndSelect("w.workoutSets", "s")
          .leftJoinAndSelect("w.cardioSessions", "c")
          .where("w.userId IN (:...ids) AND w.performedOn >= :cutoff", {
            ids: activeClientIds,
            cutoff: recentCutoff,
          })
          .orderBy("w.performedOn", "DESC")
          .addOrderBy("w.createdAt", "DESC")
          .take(20)
          .getMany(),
      ]);
      for (const row of lastRows) {
        lastWorkoutByClient.set(row.user_id, row.last_date.slice(0, 10));
      }
      recentWorkoutsRaw = recentData;
    }

    const recentWorkoutIds = recentWorkoutsRaw.map((w) => w.id);
    const feedbackByWorkout = new Map<
      string,
      {
        id: string;
        workoutId: string;
        authorId: string;
        authorName: string;
        isCoachAuthor: boolean;
        body: string;
        reaction: string | null;
        createdAt: string;
      }[]
    >();
    if (recentWorkoutIds.length > 0) {
      const fbRows = await this.feedbackRepo.find({
        where: { workoutId: In(recentWorkoutIds) },
        order: { createdAt: "ASC" },
      });
      for (const row of fbRows) {
        const isCoachAuthor = row.authorId === coachId;
        const list = feedbackByWorkout.get(row.workoutId) ?? [];
        list.push({
          id: row.id,
          workoutId: row.workoutId,
          authorId: row.authorId,
          authorName: isCoachAuthor ? coachName : (clientNameMap.get(row.authorId) ?? `Client #${row.authorId.slice(0, 6)}`),
          isCoachAuthor,
          body: row.body,
          reaction: row.reaction ?? null,
          createdAt: row.createdAt.toISOString(),
        });
        feedbackByWorkout.set(row.workoutId, list);
      }
    }

    const activeStartByClient = new Map<string, string>();
    for (const e of activeEnrollments) {
      const start = (e.startedAt ?? e.createdAt).toISOString();
      const prev = activeStartByClient.get(e.clientId);
      if (!prev || start < prev) activeStartByClient.set(e.clientId, start);
    }

    const inactiveClients: string[] = [];
    const pausedAlerts: { clientId: string; name: string | null; days: number; lastDate: string }[] = [];
    const newNoWorkouts: { clientId: string; name: string | null; daysSinceStart: number; overdue: boolean }[] = [];

    for (const clientId of activeClientIds) {
      const lastWorkoutDate = lastWorkoutByClient.get(clientId) ?? null;
      const adherence = classifyClientAdherence(
        {
          lastWorkoutDate,
          enrollmentStartedAt: activeStartByClient.get(clientId) ?? null,
        },
        today,
      );
      if (adherence.kind === "inactive" && lastWorkoutDate) {
        inactiveClients.push(clientId);
        pausedAlerts.push({
          clientId,
          name: clientNameMap.get(clientId) ?? null,
          days: adherence.daysSinceWorkout,
          lastDate: lastWorkoutDate,
        });
      } else if (adherence.kind === "new_no_workouts" || adherence.kind === "new_overdue") {
        if (adherence.kind === "new_overdue") inactiveClients.push(clientId);
        newNoWorkouts.push({
          clientId,
          name: clientNameMap.get(clientId) ?? null,
          daysSinceStart: adherence.daysSinceStart,
          overdue: adherence.kind === "new_overdue",
        });
      }
    }
    pausedAlerts.sort((a, b) => b.days - a.days);
    newNoWorkouts.sort((a, b) => b.daysSinceStart - a.daysSinceStart);

    const unreviewedCheckins = (await this.attachCheckinPhotoUrls(unreviewedCheckinRows)).map((item) => ({
      ...item,
      clientName: clientNameMap.get(item.clientId) ?? null,
    }));

    return {
      activeClientsCount: activeClientIds.length,
      pendingRequestsCount: pendingEnrollments.length,
      unreviewedCheckinsCount: unreviewedCheckinRows.length,
      programsCount: programs.length,
      publishedProgramsCount,
      mealPlansCount,
      inactiveClientsCount: inactiveClients.length,
      inactiveClientIds: inactiveClients,
      pendingRequests: pendingEnrollments.map((e) => ({
        id: e.id,
        clientId: e.clientId,
        clientName: clientNameMap.get(e.clientId) ?? null,
        programTitle: e.programId ? (programMap.get(e.programId) ?? null) : null,
        createdAt: e.createdAt.toISOString(),
      })),
      unreviewedCheckins,
      pausedAlerts,
      newNoWorkouts,
      recentWorkouts: recentWorkoutsRaw.map((w) => ({
        id: w.id,
        userId: w.userId,
        clientName: clientNameMap.get(w.userId) ?? null,
        performedOn: String(w.performedOn).slice(0, 10),
        split: w.split,
        workoutMode: w.workoutMode,
        createdAt: w.createdAt.toISOString(),
        sets: (w.workoutSets ?? []).map((s) => ({
          exercise: s.exercise,
          weight: Number(s.weight),
          reps: s.reps,
          rir: s.rir ?? null,
          setType: s.setType,
          isPr: Boolean(s.isPr),
        })),
        cardio: (w.cardioSessions ?? []).map((c) => ({
          activity: c.activity,
          durationMin: c.durationMin,
        })),
        feedback: feedbackByWorkout.get(w.id) ?? [],
      })),
    };
  }

  async listCoachClients(coachId: string) {
    const today = localDate();
    const enrollments = await this.enrollmentsRepo.find({
      where: { coachId },
      order: { createdAt: "DESC" },
    });
    if (enrollments.length === 0) return [];

    const clientIds = [...new Set(enrollments.map((e) => e.clientId))];
    const programIds = [...new Set(enrollments.map((e) => e.programId).filter((id): id is string => Boolean(id)))];

    const [profiles, programs, lastWorkouts] = await Promise.all([
      this.profilesRepo.find({ where: { id: In(clientIds) }, select: { id: true, displayName: true, weightUnit: true } }),
      programIds.length > 0
        ? this.programsRepo.find({ where: { id: In(programIds) }, select: { id: true, title: true } })
        : Promise.resolve([]),
      this.dataSource.query<{ user_id: string; last_date: string }[]>(
        `SELECT user_id, MAX(performed_on)::text AS last_date
         FROM public.workouts
         WHERE user_id = ANY($1::uuid[])
         GROUP BY user_id`,
        [clientIds],
      ),
    ]);

    const profileMap = new Map(profiles.map((p) => [p.id, p]));
    const programMap = new Map(programs.map((p) => [p.id, p.title]));
    const lastMap = new Map(lastWorkouts.map((r) => [r.user_id, r.last_date.slice(0, 10)]));

    return enrollments.map((e) => {
      const lastWorkoutDate = lastMap.get(e.clientId) ?? null;
      return {
        enrollmentId: e.id,
        clientId: e.clientId,
        clientName: profileMap.get(e.clientId)?.displayName ?? null,
        programId: e.programId,
        programTitle: e.programId ? (programMap.get(e.programId) ?? null) : null,
        status: e.status,
        shareNutrition: e.shareNutrition,
        currentWeek: e.currentWeek,
        assignedByCoach: e.assignedByCoach,
        startedAt: e.startedAt?.toISOString() ?? null,
        createdAt: e.createdAt.toISOString(),
        lastWorkoutDate,
        adherence: classifyClientAdherence(
          {
            lastWorkoutDate,
            enrollmentStartedAt: (e.startedAt ?? e.createdAt).toISOString(),
          },
          today,
        ),
      };
    });
  }

  async respondEnrollment(coachId: string, enrollmentId: string, decision: "active" | "rejected") {
    if (!UUID_REGEX.test(enrollmentId)) throw new NotFoundException("Enrollment not found");
    const enrollment = await this.enrollmentsRepo.findOne({
      where: { id: enrollmentId, coachId, status: "pending" },
    });
    if (!enrollment) throw new NotFoundException("Pending enrollment not found");

    enrollment.status = decision;
    if (decision === "active") {
      enrollment.startedAt = new Date();
    }
    await this.enrollmentsRepo.save(enrollment);

    await this.notifications.notify(
      enrollment.clientId,
      coachId,
      decision === "active" ? "enroll_approved" : "enroll_rejected",
      { enrollment_id: enrollment.id, program_id: enrollment.programId },
      "/explore",
    );

    return { id: enrollment.id, status: enrollment.status };
  }

  async updateEnrollmentStatus(
    coachId: string,
    enrollmentId: string,
    status: "active" | "paused" | "completed",
  ) {
    if (!UUID_REGEX.test(enrollmentId)) throw new NotFoundException("Enrollment not found");
    const enrollment = await this.enrollmentsRepo.findOne({ where: { id: enrollmentId, coachId } });
    if (!enrollment) throw new NotFoundException("Enrollment not found");

    enrollment.status = status;
    if (status === "active" && !enrollment.startedAt) enrollment.startedAt = new Date();
    if (status === "completed") enrollment.completedAt = new Date();
    await this.enrollmentsRepo.save(enrollment);

    return { id: enrollment.id, status: enrollment.status };
  }

  async updateEnrollmentWeek(coachId: string, enrollmentId: string, currentWeek: number) {
    if (!UUID_REGEX.test(enrollmentId)) throw new NotFoundException("Enrollment not found");
    const enrollment = await this.enrollmentsRepo.findOne({ where: { id: enrollmentId, coachId } });
    if (!enrollment) throw new NotFoundException("Enrollment not found");

    enrollment.currentWeek = currentWeek;
    await this.enrollmentsRepo.save(enrollment);
    return { id: enrollment.id, currentWeek: enrollment.currentWeek };
  }

  async assignProgramToEnrollment(coachId: string, enrollmentId: string, programId: string) {
    if (!UUID_REGEX.test(enrollmentId)) throw new NotFoundException("Enrollment not found");
    const [enrollment, program] = await Promise.all([
      this.enrollmentsRepo.findOne({ where: { id: enrollmentId, coachId } }),
      this.programsRepo.findOne({ where: { id: programId, coachId } }),
    ]);
    if (!enrollment) throw new NotFoundException("Enrollment not found");
    if (!program) throw new NotFoundException("Program not found");

    enrollment.programId = program.id;
    enrollment.currentWeek = 1;
    enrollment.assignedByCoach = true;
    await this.enrollmentsRepo.save(enrollment);

    await this.notifications.notify(
      enrollment.clientId,
      coachId,
      "program_assigned",
      { program_id: program.id, program_title: program.title },
      "/",
    );

    return { id: enrollment.id, programId: program.id };
  }

  async getClientDetail(coachId: string, clientId: string, rangeRaw?: string) {
    const rangeDays = parseRangeDays(rangeRaw);
    const cutoff = cutoffDateYmd(localDate(), rangeDays);

    const [profile, enrollments, note, workouts, steps, weights, dailyCheckins, weeklyCheckins, latestWorkoutRows] =
      await Promise.all([
        this.profilesRepo.findOne({
          where: { id: clientId },
          select: { id: true, displayName: true, weightUnit: true, dailyStepsGoal: true },
        }),
        this.enrollmentsRepo.find({ where: { coachId, clientId }, order: { createdAt: "DESC" } }),
        this.notesRepo.findOne({ where: { coachId, clientId } }),
        this.workoutsRepo
          .createQueryBuilder("w")
          .leftJoinAndSelect("w.workoutSets", "s")
          .leftJoinAndSelect("w.cardioSessions", "c")
          .where("w.userId = :clientId AND w.performedOn >= :cutoff", { clientId, cutoff })
          .orderBy("w.performedOn", "DESC")
          .getMany(),
        this.stepsRepo
          .createQueryBuilder("s")
          .where("s.userId = :clientId AND s.date >= :cutoff", { clientId, cutoff })
          .orderBy("s.date", "ASC")
          .getMany(),
        this.weightRepo
          .createQueryBuilder("w")
          .where("w.userId = :clientId AND w.date >= :cutoff", { clientId, cutoff })
          .orderBy("w.date", "ASC")
          .getMany(),
        this.dailyCheckinRepo
          .createQueryBuilder("c")
          .where("c.userId = :clientId AND c.date >= :cutoff", { clientId, cutoff })
          .orderBy("c.date", "DESC")
          .getMany(),
        this.checkinsRepo.find({
          where: { clientId },
          order: { weekStart: "DESC" },
          take: 24,
        }),
        this.dataSource.query<{ last_date: string }[]>(
          `SELECT MAX(performed_on)::text AS last_date FROM public.workouts WHERE user_id = $1`,
          [clientId],
        ),
      ]);

    const shareNutrition = enrollments.some((e) => e.status === "active" && e.shareNutrition);
    const pwIds = [...new Set(workouts.map((w) => w.programWorkoutId).filter((x): x is string => Boolean(x)))];
    const workoutIds = workouts.map((w) => w.id);

    const [enrichedCheckins, pwRows, fbRows, targets, coachProfile] = await Promise.all([
      this.attachCheckinPhotoUrls(weeklyCheckins),
      pwIds.length > 0
        ? this.programWorkoutsRepo.find({ where: { id: In(pwIds) }, select: { id: true, title: true } })
        : Promise.resolve([]),
      workoutIds.length > 0
        ? this.feedbackRepo.find({ where: { workoutId: In(workoutIds) }, order: { createdAt: "ASC" } })
        : Promise.resolve([]),
      shareNutrition
        ? this.dataSource.getRepository(UserTargetEntity).findOne({ where: { userId: clientId } })
        : Promise.resolve(null),
      this.coachProfilesRepo.findOne({ where: { userId: coachId }, select: { displayName: true } }),
    ]);

    const pwTitleMap = new Map(pwRows.map((p) => [p.id, p.title]));
    const clientName = profile?.displayName?.trim() || `Client #${clientId.slice(0, 6)}`;
    const coachName = coachProfile?.displayName?.trim() || "Coach";
    const feedbackByWorkout = new Map<
      string,
      {
        id: string;
        workoutId: string;
        authorId: string;
        authorName: string;
        isCoachAuthor: boolean;
        body: string;
        reaction: string | null;
        createdAt: string;
      }[]
    >();
    for (const row of fbRows) {
      const isCoachAuthor = row.authorId === coachId;
      const list = feedbackByWorkout.get(row.workoutId) ?? [];
      list.push({
        id: row.id,
        workoutId: row.workoutId,
        authorId: row.authorId,
        authorName: isCoachAuthor ? coachName : clientName,
        isCoachAuthor,
        body: row.body,
        reaction: row.reaction ?? null,
        createdAt: row.createdAt.toISOString(),
      });
      feedbackByWorkout.set(row.workoutId, list);
    }

    return {
      client: profile
        ? {
            id: profile.id,
            displayName: profile.displayName ?? null,
            weightUnit: profile.weightUnit,
            dailyStepsGoal: profile.dailyStepsGoal,
          }
        : null,
      rangeDays,
      latestWorkoutDate: latestWorkoutRows[0]?.last_date ? latestWorkoutRows[0].last_date.slice(0, 10) : null,
      targets: targets
        ? {
            kcal: targets.kcal,
            protein: targets.protein,
            carbs: targets.carbs,
            fat: targets.fat,
            fiber: targets.fiber,
          }
        : null,
      enrollments: enrollments.map((e) => ({
        id: e.id,
        programId: e.programId,
        status: e.status,
        shareNutrition: e.shareNutrition,
        currentWeek: e.currentWeek,
        startedAt: e.startedAt?.toISOString() ?? null,
        createdAt: e.createdAt.toISOString(),
      })),
      note: note ? { note: note.note, updatedAt: note.updatedAt.toISOString() } : { note: "", updatedAt: null },
      workouts: workouts.map((w) => ({
        id: w.id,
        performedOn: String(w.performedOn).slice(0, 10),
        split: w.split,
        workoutMode: w.workoutMode,
        programWorkoutTitle: w.programWorkoutId ? (pwTitleMap.get(w.programWorkoutId) ?? null) : null,
        setsCount: w.workoutSets?.length ?? 0,
        cardioMin: (w.cardioSessions ?? []).reduce((sum, c) => sum + c.durationMin, 0),
        sets: [...(w.workoutSets ?? [])]
          .sort((a, b) => a.setNumber - b.setNumber)
          .map((s) => ({
            id: s.id,
            exercise: s.exercise,
            setNumber: s.setNumber,
            setType: s.setType,
            weight: Number(s.weight),
            reps: s.reps,
            rir: s.rir ?? null,
            notes: s.notes ?? null,
            isPr: Boolean(s.isPr),
          })),
        cardio: (w.cardioSessions ?? []).map((c) => ({
          id: c.id,
          activity: c.activity,
          durationMin: c.durationMin,
        })),
        feedback: feedbackByWorkout.get(w.id) ?? [],
      })),
      steps: steps.map((s) => ({ date: String(s.date).slice(0, 10), steps: s.steps })),
      weights: weights.map((w) => ({ date: String(w.date).slice(0, 10), weightKg: Number(w.weightKg) })),
      dailyCheckins: dailyCheckins.map((c) => ({
        date: String(c.date).slice(0, 10),
        energy: c.energy,
        satiety: c.satiety,
        sleep: c.sleep,
        note: c.note ?? "",
      })),
      weeklyCheckins: enrichedCheckins,
    };
  }

  async getClientNutrition(clientId: string, rangeRaw?: string) {
    const rangeDays = parseRangeDays(rangeRaw);
    const cutoff = cutoffDateYmd(localDate(), rangeDays);

    const meals = await this.mealsRepo
      .createQueryBuilder("m")
      .leftJoinAndSelect("m.items", "i")
      .where("m.userId = :clientId AND m.performedOn >= :cutoff", { clientId, cutoff })
      .orderBy("m.performedOn", "DESC")
      .getMany();

    const summary = summarizeNutritionByDay(
      meals.map((m) => ({
        performed_on: String(m.performedOn).slice(0, 10),
        meal_items: (m.items ?? []).map((i) => ({
          total_kcal: Number(i.totalKcal),
          total_protein_g: Number(i.totalProteinG),
          total_carbs_g: Number(i.totalCarbsG),
          total_fat_g: Number(i.totalFatG),
        })),
      })),
    );

    return { rangeDays, ...summary };
  }

  async saveCoachNote(coachId: string, clientId: string, note: string) {
    const now = new Date();
    await this.notesRepo
      .createQueryBuilder()
      .insert()
      .into(CoachClientNoteEntity)
      .values({ coachId, clientId, note, updatedAt: now })
      .orUpdate(["note", "updated_at"], ["coach_id", "client_id"])
      .execute();
    return { clientId, note, updatedAt: now.toISOString() };
  }

  // =========================================================================
  // Explore & Client Enrollment Flows
  // =========================================================================

  async listPublicCoaches() {
    const coaches = await this.coachProfilesRepo.find({
      where: { isPublic: true },
      order: { displayName: "ASC" },
    });
    return coaches.map((c) => ({
      userId: c.userId,
      displayName: c.displayName,
      bio: c.bio ?? null,
      specialties: c.specialties ?? [],
      isPublic: c.isPublic,
      acceptingClients: c.acceptingClients,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    }));
  }

  async listPublicPrograms() {
    const programs = await this.programsRepo.find({
      where: { status: "published", accessType: "public", assignedClientId: IsNull() },
      relations: { workouts: true },
      order: { updatedAt: "DESC" },
    });
    if (programs.length === 0) return [];

    const coachIds = [...new Set(programs.map((p) => p.coachId))];
    const coachProfiles = await this.coachProfilesRepo.find({ where: { userId: In(coachIds) } });
    const coachNameMap = new Map(coachProfiles.map((c) => [c.userId, c.displayName]));

    return programs.map((p) => ({
      ...serializeProgram(p),
      workoutCount: p.workouts?.length ?? 0,
      coachName: coachNameMap.get(p.coachId) ?? "Coach",
    }));
  }

  async previewProgramByInvite(rawCode: string) {
    const code = normalizeInviteCode(rawCode);
    if (!isValidInviteCode(code)) {
      throw new BadRequestException("Invite code must be 6-16 letters or digits");
    }

    const program = await this.programsRepo.findOne({
      where: {
        inviteCode: code,
        status: "published",
        assignedClientId: IsNull(),
      },
    });
    if (!program) {
      throw new NotFoundException("No published program found for this invite code");
    }

    const coachProfile = await this.coachProfilesRepo.findOne({ where: { userId: program.coachId } });
    return {
      id: program.id,
      coachId: program.coachId,
      coachName: coachProfile?.displayName ?? "Coach",
      title: program.title,
      description: program.description ?? null,
      difficulty: program.difficulty,
      durationWeeks: program.durationWeeks,
      goal: program.goal,
      requiresApproval: program.requiresApproval,
    };
  }

  async enrollInProgram(clientId: string, dto: EnrollInProgramDto) {
    const program = await this.programsRepo.findOne({
      where: { id: dto.programId, status: "published", assignedClientId: IsNull() },
    });
    if (!program) throw new NotFoundException("Program not found");
    if (program.coachId === clientId) {
      throw new BadRequestException("You cannot enroll in your own program");
    }

    if (program.accessType === "invite_only") {
      const normalized = normalizeInviteCode(dto.inviteCode ?? "");
      if (!program.inviteCode || normalized !== program.inviteCode) {
        throw new ForbiddenException("Invalid invite code");
      }
    }

    const existingOpen = await this.enrollmentsRepo.findOne({
      where: {
        clientId,
        programId: program.id,
        status: In(["pending", "active", "paused"]),
      },
    });
    if (existingOpen) {
      throw new ConflictException("Already enrolled in this program");
    }

    const initialStatus = program.requiresApproval ? "pending" : "active";
    const enrollment = await this.enrollmentsRepo.save(
      this.enrollmentsRepo.create({
        clientId,
        coachId: program.coachId,
        programId: program.id,
        status: initialStatus,
        shareNutrition: dto.shareNutrition ?? true,
        currentWeek: 1,
        assignedByCoach: false,
        startedAt: initialStatus === "active" ? new Date() : null,
      }),
    );

    const clientProfile = await this.profilesRepo.findOne({
      where: { id: clientId },
      select: { displayName: true },
    });

    await this.notifications.notify(
      program.coachId,
      clientId,
      "enroll_requested",
      {
        enrollment_id: enrollment.id,
        program_id: program.id,
        program_title: program.title,
        client_name: clientProfile?.displayName ?? "",
        status: initialStatus,
      },
      "/coach/clients",
    );

    return { id: enrollment.id, status: enrollment.status, programId: program.id, coachId: program.coachId };
  }

  async listClientEnrollments(clientId: string) {
    const rows = await this.enrollmentsRepo.find({
      where: { clientId },
      order: { createdAt: "DESC" },
    });
    if (rows.length === 0) return [];

    const programIds = [...new Set(rows.map((e) => e.programId).filter((id): id is string => Boolean(id)))];
    const coachIds = [...new Set(rows.map((e) => e.coachId))];
    const [programs, coachProfiles, pWorkouts, loggedWorkouts] = await Promise.all([
      programIds.length > 0
        ? this.programsRepo.find({ where: { id: In(programIds) }, select: { id: true, title: true } })
        : Promise.resolve([]),
      coachIds.length > 0
        ? this.coachProfilesRepo.find({ where: { userId: In(coachIds) }, select: { userId: true, displayName: true } })
        : Promise.resolve([]),
      programIds.length > 0
        ? this.programWorkoutsRepo.find({
            where: { programId: In(programIds) },
            select: { id: true, programId: true, weekNumber: true, dayNumber: true, position: true },
          })
        : Promise.resolve([]),
      rows.length > 0
        ? this.workoutsRepo
            .createQueryBuilder("w")
            .select("w.enrollment_id", "enrollment_id")
            .addSelect("w.program_workout_id", "program_workout_id")
            .where("w.user_id = :clientId AND w.enrollment_id IN (:...eids) AND w.program_workout_id IS NOT NULL", {
              clientId,
              eids: rows.map((r) => r.id),
            })
            .getRawMany<{ enrollment_id: string; program_workout_id: string }>()
        : Promise.resolve([]),
    ]);
    const progMap = new Map(programs.map((p) => [p.id, p.title]));
    const coachMap = new Map(coachProfiles.map((c) => [c.userId, c.displayName]));
    const workoutsByProgram = new Map<string, { id: string; week_number: number; day_number: number; position: number }[]>();
    for (const w of pWorkouts) {
      const list = workoutsByProgram.get(w.programId) ?? [];
      list.push({ id: w.id, week_number: w.weekNumber, day_number: w.dayNumber, position: w.position });
      workoutsByProgram.set(w.programId, list);
    }
    const completedByEnrollment = new Map<string, Set<string>>();
    for (const lw of loggedWorkouts) {
      const set = completedByEnrollment.get(lw.enrollment_id) ?? new Set<string>();
      set.add(lw.program_workout_id);
      completedByEnrollment.set(lw.enrollment_id, set);
    }

    return rows.map((e) => {
      const nextWorkout =
        e.status === "active" && e.programId
          ? pickNextProgramWorkout(
              workoutsByProgram.get(e.programId) ?? [],
              completedByEnrollment.get(e.id) ?? new Set(),
              e.currentWeek,
            )
          : null;
      return {
        id: e.id,
        coachId: e.coachId,
        coachName: coachMap.get(e.coachId) ?? null,
        programId: e.programId,
        programTitle: e.programId ? (progMap.get(e.programId) ?? null) : null,
        status: e.status,
        shareNutrition: e.shareNutrition,
        currentWeek: e.currentWeek,
        nextWorkoutId: nextWorkout?.id ?? null,
        startedAt: e.startedAt?.toISOString() ?? null,
        createdAt: e.createdAt.toISOString(),
      };
    });
  }

  async getActiveProgramSummary(clientId: string) {
    const activeEnrollments = await this.enrollmentsRepo.find({
      where: { clientId, status: "active" },
      order: { startedAt: "DESC" },
      take: 5,
    });
    const activeEnrollment = activeEnrollments.find((e) => e.programId !== null);
    if (!activeEnrollment || !activeEnrollment.programId) {
      return { hasActiveCoach: activeEnrollments.length > 0, assignedProgram: null };
    }

    const [prog, coachProf, pWorkouts, doneRows] = await Promise.all([
      this.programsRepo.findOne({ where: { id: activeEnrollment.programId }, select: { id: true, title: true } }),
      this.coachProfilesRepo.findOne({ where: { userId: activeEnrollment.coachId }, select: { displayName: true } }),
      this.programWorkoutsRepo.find({
        where: { programId: activeEnrollment.programId },
        relations: { exercises: true, cardio: true },
        order: { weekNumber: "ASC", dayNumber: "ASC", position: "ASC" },
      }),
      this.workoutsRepo
        .createQueryBuilder("w")
        .select("w.program_workout_id", "program_workout_id")
        .where("w.user_id = :clientId AND w.enrollment_id = :enrollmentId AND w.program_workout_id IS NOT NULL", {
          clientId,
          enrollmentId: activeEnrollment.id,
        })
        .getRawMany<{ program_workout_id: string }>(),
    ]);

    if (!prog) {
      return { hasActiveCoach: activeEnrollments.length > 0, assignedProgram: null };
    }

    const completedIds = doneRows.map((r) => r.program_workout_id);
    const workouts = pWorkouts.map((w) => ({
      id: w.id,
      weekNumber: w.weekNumber,
      dayNumber: w.dayNumber,
      position: w.position,
      title: w.title,
      workoutMode: w.workoutMode,
      itemCount: w.workoutMode === "cardio" ? (w.cardio?.length ?? 0) : (w.exercises?.length ?? 0),
    }));

    return {
      hasActiveCoach: true,
      assignedProgram: {
        enrollmentId: activeEnrollment.id,
        programId: prog.id,
        programTitle: prog.title,
        coachName: coachProf?.displayName ?? null,
        currentWeek: activeEnrollment.currentWeek,
        completedProgramWorkoutIds: completedIds,
        workouts,
      },
    };
  }

  async getProgramWorkoutForClient(userId: string, programWorkoutId: string) {
    if (!UUID_REGEX.test(programWorkoutId)) throw new NotFoundException("Program workout not found");
    const pw = await this.programWorkoutsRepo.findOne({
      where: { id: programWorkoutId },
      relations: { exercises: true, cardio: true },
    });
    if (!pw) throw new NotFoundException("Program workout not found");

    const program = await this.programsRepo.findOne({ where: { id: pw.programId } });
    if (!program) throw new NotFoundException("Program not found");

    if (program.coachId !== userId && program.accessType !== "public") {
      const enrollment = await this.enrollmentsRepo.findOne({
        where: { clientId: userId, programId: program.id, status: "active" },
        select: { id: true },
      });
      if (!enrollment) {
        throw new ForbiddenException("You do not have access to this program workout");
      }
    }

    return {
      id: pw.id,
      programId: program.id,
      programTitle: program.title,
      title: pw.title,
      weekNumber: pw.weekNumber,
      dayNumber: pw.dayNumber,
      workoutMode: pw.workoutMode,
      split: pw.split,
      notes: pw.notes ?? null,
      exercises: [...(pw.exercises ?? [])]
        .sort((a, b) => a.position - b.position)
        .map((e) => ({
          id: e.id,
          program_workout_id: e.programWorkoutId,
          position: e.position,
          exercise: e.exercise,
          set_type: e.setType,
          target_sets: e.targetSets,
          target_reps_min: e.targetRepsMin,
          target_reps_max: e.targetRepsMax,
          target_rir: e.targetRir ?? null,
          target_weight_kg: e.targetWeightKg !== null ? Number(e.targetWeightKg) : null,
          rest_seconds: e.restSeconds ?? null,
          notes: e.notes ?? null,
        })),
      cardio: [...(pw.cardio ?? [])]
        .sort((a, b) => a.position - b.position)
        .map((c) => ({
          id: c.id,
          program_workout_id: c.programWorkoutId,
          position: c.position,
          activity: c.activity,
          target_duration_min: c.targetDurationMin,
          notes: c.notes ?? null,
        })),
    };
  }

  async cancelPendingEnrollment(clientId: string, enrollmentId: string) {
    if (!UUID_REGEX.test(enrollmentId)) throw new NotFoundException("Enrollment not found");
    const res = await this.enrollmentsRepo.delete({ id: enrollmentId, clientId, status: "pending" });
    if (!res.affected) throw new NotFoundException("Pending enrollment not found");
    return { deleted: true };
  }

  async toggleEnrollmentNutrition(clientId: string, enrollmentId: string, shareNutrition: boolean) {
    if (!UUID_REGEX.test(enrollmentId)) throw new NotFoundException("Enrollment not found");
    const enrollment = await this.enrollmentsRepo.findOne({ where: { id: enrollmentId, clientId } });
    if (!enrollment) throw new NotFoundException("Enrollment not found");
    enrollment.shareNutrition = shareNutrition;
    await this.enrollmentsRepo.save(enrollment);
    return { id: enrollment.id, shareNutrition: enrollment.shareNutrition };
  }

  async updateClientEnrollmentStatus(clientId: string, enrollmentId: string, status: "paused" | "completed") {
    if (!UUID_REGEX.test(enrollmentId)) throw new NotFoundException("Enrollment not found");
    const enrollment = await this.enrollmentsRepo.findOne({ where: { id: enrollmentId, clientId } });
    if (!enrollment) throw new NotFoundException("Enrollment not found");
    if (enrollment.status === "pending") {
      throw new ForbiddenException("Pending enrollments can only be cancelled");
    }
    enrollment.status = status;
    if (status === "completed") enrollment.completedAt = new Date();
    await this.enrollmentsRepo.save(enrollment);
    return { id: enrollment.id, status: enrollment.status };
  }

  // =========================================================================
  // Bidirectional Workout Feedback
  // =========================================================================

  private async assertWorkoutFeedbackAccess(callerId: string, workoutId: string): Promise<WorkoutEntity> {
    if (!UUID_REGEX.test(workoutId)) throw new NotFoundException("Workout not found");
    const workout = await this.workoutsRepo.findOne({ where: { id: workoutId } });
    if (!workout) throw new NotFoundException("Workout not found");
    if (workout.userId === callerId) return workout;

    const activeCoach = await this.enrollmentsRepo.findOne({
      where: { coachId: callerId, clientId: workout.userId, status: "active" },
      select: { id: true },
    });
    if (!activeCoach) {
      throw new ForbiddenException("You do not have access to this workout");
    }
    return workout;
  }

  async listWorkoutFeedback(callerId: string, workoutId: string) {
    await this.assertWorkoutFeedbackAccess(callerId, workoutId);
    const items = await this.feedbackRepo.find({
      where: { workoutId },
      order: { createdAt: "ASC" },
    });
    if (items.length === 0) return [];

    const authorIds = [...new Set(items.map((i) => i.authorId))];
    const profiles = await this.profilesRepo.find({
      where: { id: In(authorIds) },
      select: { id: true, displayName: true, role: true },
    });
    const profileMap = new Map(profiles.map((p) => [p.id, p]));

    return items.map((item) => {
      const author = profileMap.get(item.authorId);
      return {
        id: item.id,
        workoutId: item.workoutId,
        authorId: item.authorId,
        authorName: author?.displayName ?? (author?.role === "coach" ? "Coach" : "Client"),
        isCoachAuthor: author?.role === "coach",
        body: item.body,
        reaction: item.reaction ?? null,
        createdAt: item.createdAt.toISOString(),
      };
    });
  }

  async addWorkoutFeedback(callerId: string, workoutId: string, dto: AddWorkoutFeedbackDto) {
    const workout = await this.assertWorkoutFeedbackAccess(callerId, workoutId);
    const checked = validateFeedbackInput(dto.body, dto.reaction ?? null, tEn);
    if (!checked.ok) throw new BadRequestException(checked.error);

    const saved = await this.feedbackRepo.save(
      this.feedbackRepo.create({
        workoutId,
        authorId: callerId,
        body: checked.body,
        reaction: checked.reaction,
      }),
    );

    const authorProfile = await this.profilesRepo.findOne({
      where: { id: callerId },
      select: { displayName: true, role: true },
    });
    const authorName = authorProfile?.displayName ?? (authorProfile?.role === "coach" ? "Coach" : "Client");

    if (callerId !== workout.userId) {
      // Coach commented on client's workout -> notify client
      await this.notifications.notify(
        workout.userId,
        callerId,
        "workout_feedback",
        {
          workout_id: workout.id,
          author_name: authorName,
          split: workout.split,
          performed_on: String(workout.performedOn).slice(0, 10),
          reaction: checked.reaction,
        },
        "/history",
      );
    } else {
      // Client commented on own workout -> notify active coaches
      const activeCoaches = await this.enrollmentsRepo.find({
        where: { clientId: callerId, status: "active" },
        select: { coachId: true },
      });
      for (const coachId of new Set(activeCoaches.map((e) => e.coachId))) {
        await this.notifications.notify(
          coachId,
          callerId,
          "workout_feedback",
          {
            workout_id: workout.id,
            author_name: authorName,
            split: workout.split,
            performed_on: String(workout.performedOn).slice(0, 10),
            reaction: checked.reaction,
          },
          `/coach/clients/${callerId}`,
        );
      }
    }

    return {
      id: saved.id,
      workoutId: saved.workoutId,
      authorId: saved.authorId,
      authorName,
      isCoachAuthor: authorProfile?.role === "coach",
      body: saved.body,
      reaction: saved.reaction ?? null,
      createdAt: saved.createdAt.toISOString(),
    };
  }

  async deleteWorkoutFeedback(callerId: string, feedbackId: string) {
    if (!UUID_REGEX.test(feedbackId)) throw new NotFoundException("Feedback not found");
    const res = await this.feedbackRepo.delete({ id: feedbackId, authorId: callerId });
    if (!res.affected) throw new NotFoundException("Feedback not found");
    return { deleted: true };
  }

  // =========================================================================
  // Weekly Check-ins + Check-in Photos
  // =========================================================================

  private isEncryptedPhotoMode(): boolean {
    return typeof this.storage.isPhotoEncryptionEnabled === "function" && this.storage.isPhotoEncryptionEnabled();
  }

  async requestCheckinPhotoUploadUrl(clientId: string, sizeBytes: number) {
    const id = randomUUID().toLowerCase();
    const path = checkinPhotoPath(clientId, id);

    if (this.isEncryptedPhotoMode()) {
      return {
        id,
        path,
        uploadUrl: `/api/v1/checkins/weekly/photo-upload/${id}`,
        expiresIn: 600,
      };
    }

    const bucket = this.storage.getCheckinPhotosBucket();
    const { url, expiresIn } = await this.storage.createPresignedUploadUrl(bucket, path, {
      contentType: "image/jpeg",
      contentLength: sizeBytes,
      expiresInSeconds: 600,
    });
    return { id, path, uploadUrl: url, expiresIn };
  }

  async uploadCheckinPhotoFile(clientId: string, idRaw: string, rawBody: unknown) {
    if (!UUID_REGEX.test(idRaw)) {
      throw new BadRequestException("Invalid check-in photo ID");
    }
    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
      throw new BadRequestException("JPEG image body is required");
    }
    if (rawBody.length > PHOTO_MAX_BYTES) {
      throw new BadRequestException("Check-in photo exceeds maximum allowed size");
    }
    if (!isJpegBuffer(rawBody)) {
      throw new BadRequestException("Only valid JPEG images are supported");
    }

    const id = idRaw.toLowerCase();
    const path = checkinPhotoPath(clientId, id);
    const bucket = this.storage.getCheckinPhotosBucket();
    await this.storage.uploadObject(bucket, path, rawBody, "image/jpeg");
    return { id, path, sizeBytes: rawBody.length };
  }

  async getCheckinPhotoFile(requesterUserId: string, checkinIdRaw: string, slot: string): Promise<Buffer> {
    if (!UUID_REGEX.test(checkinIdRaw)) throw new NotFoundException("Weekly check-in not found");
    if (slot !== "front" && slot !== "back" && slot !== "side") {
      throw new BadRequestException("Invalid check-in photo slot");
    }

    const checkin = await this.checkinsRepo.findOne({ where: { id: checkinIdRaw.toLowerCase() } });
    if (!checkin) throw new NotFoundException("Weekly check-in not found");

    // Strictly allow ONLY the client themselves or their CURRENT active coach (supports switching coaches seamlessly).
    if (requesterUserId !== checkin.clientId) {
      const activeEnrollment = await this.enrollmentsRepo.findOne({
        where: { clientId: checkin.clientId, coachId: requesterUserId, status: "active" },
        select: { id: true },
      });
      if (!activeEnrollment) {
        throw new ForbiddenException("Only the client or their currently active coach can view this check-in photo");
      }
    }

    const path =
      slot === "front"
        ? checkin.photoFrontPath
        : slot === "back"
          ? checkin.photoBackPath
          : checkin.photoSidePath;
    if (!path) throw new NotFoundException("Check-in photo not found for this slot");

    const bucket = this.storage.getCheckinPhotosBucket();
    const bytes = await this.storage.downloadObject(bucket, path);
    if (!bytes) throw new NotFoundException("Check-in photo file not found in storage");
    return bytes;
  }

  async listClientWeeklyCheckins(clientId: string) {
    const rows = await this.checkinsRepo.find({
      where: { clientId },
      order: { weekStart: "DESC" },
      take: 52,
    });
    return this.attachCheckinPhotoUrls(rows);
  }

  async submitWeeklyCheckin(clientId: string, dto: SubmitWeeklyCheckinDto) {
    const checked = validateWeeklyCheckinInput(
      {
        weightKg: dto.weightKg ?? null,
        energy: dto.energy,
        sleep: dto.sleep,
        stress: dto.stress,
        clientNotes: dto.clientNotes ?? "",
      },
      tEn,
    );
    if (!checked.ok) throw new BadRequestException(checked.error);

    const activeEnrollment = await this.enrollmentsRepo.findOne({
      where: { clientId, coachId: dto.coachId, status: "active" },
    });
    if (!activeEnrollment) {
      throw new ForbiddenException("Active enrollment with this coach is required");
    }

    const photoCheck = validateCheckinPhotoPaths(
      {
        front: dto.photoFrontPath,
        back: dto.photoBackPath,
        side: dto.photoSidePath,
      },
      clientId,
      tEn,
    );
    if (!photoCheck.ok) throw new BadRequestException(photoCheck.error);

    const weekStart = mondayOfWeek(dto.weekStart || localDate());
    const existing = await this.checkinsRepo.findOne({
      where: { clientId, coachId: dto.coachId, weekStart },
    });

    if (existing) {
      if (existing.reviewedAt) {
        throw new BadRequestException("This weekly check-in has already been reviewed by your coach");
      }

      const prevPaths = checkinPhotoPathsFromRow({
        photo_front_path: existing.photoFrontPath,
        photo_back_path: existing.photoBackPath,
        photo_side_path: existing.photoSidePath,
      });

      existing.weightKg = checked.data.weightKg !== null ? checked.data.weightKg.toFixed(2) : null;
      existing.energy = checked.data.energy;
      existing.sleep = checked.data.sleep;
      existing.stress = checked.data.stress;
      existing.clientNotes = checked.data.clientNotes;
      existing.photoFrontPath = photoCheck.paths.front;
      existing.photoBackPath = photoCheck.paths.back;
      existing.photoSidePath = photoCheck.paths.side;
      const saved = await this.checkinsRepo.save(existing);

      const removedPaths = diffRemovedCheckinPhotoPaths(prevPaths, photoCheck.paths);
      if (removedPaths.length > 0) {
        await this.storage.deleteObjects(this.storage.getCheckinPhotosBucket(), removedPaths).catch(() => undefined);
      }

      const [enriched] = await this.attachCheckinPhotoUrls([saved]);
      return enriched;
    }

    const saved = await this.checkinsRepo.save(
      this.checkinsRepo.create({
        clientId,
        coachId: dto.coachId,
        enrollmentId: dto.enrollmentId ?? activeEnrollment.id,
        weekStart,
        weightKg: checked.data.weightKg !== null ? checked.data.weightKg.toFixed(2) : null,
        energy: checked.data.energy,
        sleep: checked.data.sleep,
        stress: checked.data.stress,
        clientNotes: checked.data.clientNotes,
        photoFrontPath: photoCheck.paths.front,
        photoBackPath: photoCheck.paths.back,
        photoSidePath: photoCheck.paths.side,
      }),
    );

    const clientProfile = await this.profilesRepo.findOne({
      where: { id: clientId },
      select: { displayName: true },
    });

    await this.notifications.notify(
      dto.coachId,
      clientId,
      "weekly_checkin_submitted",
      {
        checkin_id: saved.id,
        week_start: weekStart,
        client_name: clientProfile?.displayName ?? "",
      },
      `/coach/clients/${clientId}`,
    );

    const [enriched] = await this.attachCheckinPhotoUrls([saved]);
    return enriched;
  }

  async reviewWeeklyCheckin(coachId: string, checkinId: string, dto: ReviewWeeklyCheckinDto) {
    if (!UUID_REGEX.test(checkinId)) throw new NotFoundException("Weekly check-in not found");
    const trimmed = dto.reply.trim();
    if (trimmed.length < 1 || trimmed.length > 1500) {
      throw new BadRequestException("Reply must be between 1 and 1500 characters");
    }

    const checkin = await this.checkinsRepo.findOne({ where: { id: checkinId, coachId } });
    if (!checkin) throw new NotFoundException("Weekly check-in not found");

    const active = await this.enrollmentsRepo.findOne({
      where: { coachId, clientId: checkin.clientId, status: "active" },
      select: { id: true },
    });
    if (!active) throw new ForbiddenException("Active coach-client relationship required");

    checkin.coachReply = trimmed;
    checkin.reviewedAt = new Date();
    const saved = await this.checkinsRepo.save(checkin);

    await this.notifications.notify(
      checkin.clientId,
      coachId,
      "weekly_checkin_reviewed",
      {
        checkin_id: checkin.id,
        week_start: String(checkin.weekStart).slice(0, 10),
      },
      "/checkin/weekly",
    );

    const [enriched] = await this.attachCheckinPhotoUrls([saved]);
    return enriched;
  }

  private async attachCheckinPhotoUrls(rows: WeeklyCheckinEntity[]) {
    const encryptedMode = this.isEncryptedPhotoMode();
    const paths: string[] = [];
    if (!encryptedMode) {
      for (const r of rows) {
        if (r.photoFrontPath) paths.push(r.photoFrontPath);
        if (r.photoBackPath) paths.push(r.photoBackPath);
        if (r.photoSidePath) paths.push(r.photoSidePath);
      }
    }

    const signed =
      !encryptedMode && paths.length > 0
        ? await this.storage.createPresignedDownloadUrls(this.storage.getCheckinPhotosBucket(), paths, 600)
        : new Map<string, string>();

    return rows.map((r) => ({
      id: r.id,
      clientId: r.clientId,
      coachId: r.coachId,
      enrollmentId: r.enrollmentId ?? null,
      weekStart: String(r.weekStart).slice(0, 10),
      weightKg: r.weightKg !== null ? Number(r.weightKg) : null,
      energy: r.energy,
      sleep: r.sleep,
      stress: r.stress,
      clientNotes: r.clientNotes ?? null,
      coachReply: r.coachReply ?? null,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      photoFrontPath: r.photoFrontPath ?? null,
      photoBackPath: r.photoBackPath ?? null,
      photoSidePath: r.photoSidePath ?? null,
      photoUrls: encryptedMode
        ? {
            ...(r.photoFrontPath ? { front: `/api/v1/checkins/weekly/${r.id}/photo/front` } : {}),
            ...(r.photoBackPath ? { back: `/api/v1/checkins/weekly/${r.id}/photo/back` } : {}),
            ...(r.photoSidePath ? { side: `/api/v1/checkins/weekly/${r.id}/photo/side` } : {}),
          }
        : {
            ...(r.photoFrontPath && signed.has(r.photoFrontPath) ? { front: signed.get(r.photoFrontPath) } : {}),
            ...(r.photoBackPath && signed.has(r.photoBackPath) ? { back: signed.get(r.photoBackPath) } : {}),
            ...(r.photoSidePath && signed.has(r.photoSidePath) ? { side: signed.get(r.photoSidePath) } : {}),
          },
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }
}
