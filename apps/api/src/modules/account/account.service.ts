import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
  forwardRef,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import {
  CardioSessionEntity,
  DailyCheckinEntity,
  DailyStepsEntity,
  DailyWeightEntity,
  FoodEntity,
  GoogleDriveBackupEntity,
  MealEntity,
  MealItemEntity,
  MealTemplateEntity,
  ProfileEntity,
  UserEntity,
  UserTargetEntity,
  WorkoutEntity,
  WorkoutSetEntity,
} from "../../database/entities";
import { StorageService } from "../../storage/storage.service";

export interface DriveCleanupHook {
  purgeDrivePhotos(userId: string): Promise<void>;
  removeDriveLink(userId: string): Promise<void>;
}

export const DRIVE_CLEANUP_HOOK = "DRIVE_CLEANUP_HOOK";

export interface ReplogExportV1 {
  format: "replog-export";
  version: 1;
  exported_at: string;
  account: { id: string; email: string; created_at: string };
  profile: Record<string, unknown> | null;
  user_targets: Record<string, unknown> | null;
  workout_draft: Record<string, unknown> | null;
  workouts: Record<string, unknown>[];
  workout_sets: Record<string, unknown>[];
  cardio_sessions: Record<string, unknown>[];
  meals: Record<string, unknown>[];
  meal_items: Record<string, unknown>[];
  foods: Record<string, unknown>[];
  meal_templates: Record<string, unknown>[];
  daily_steps: Record<string, unknown>[];
  daily_weight: Record<string, unknown>[];
  daily_checkin: Record<string, unknown>[];
  progress_photos: Record<string, unknown>[];
  enrollments: Record<string, unknown>[];
  weekly_checkins: Record<string, unknown>[];
  workout_feedback: Record<string, unknown>[];
  notifications: Record<string, unknown>[];
  meal_plans: Record<string, unknown>[];
  google_drive_backup: { email: string | null; frequency: string; last_backup_at: string | null } | null;
}

export interface ImportCounts {
  workouts: number;
  workout_sets: number;
  cardio_sessions: number;
  meals: number;
  meal_items: number;
  foods: number;
  meal_templates: number;
  daily_steps: number;
  daily_weight: number;
  daily_checkin: number;
}

function asArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null);
}

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(UserEntity)
    private readonly usersRepo: Repository<UserEntity>,
    @InjectRepository(GoogleDriveBackupEntity)
    private readonly driveBackupsRepo: Repository<GoogleDriveBackupEntity>,
    private readonly storage: StorageService,
    @Optional()
    @Inject(forwardRef(() => DRIVE_CLEANUP_HOOK))
    private readonly driveCleanup?: DriveCleanupHook,
  ) {}

  async buildExport(userId: string): Promise<ReplogExportV1> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("Account not found");

    const [
      profileRows,
      targetRows,
      draftRows,
      workouts,
      workoutSets,
      cardioSessions,
      meals,
      mealItems,
      ownFoods,
      mealTemplates,
      dailySteps,
      dailyWeight,
      dailyCheckin,
      progressPhotos,
      enrollments,
      weeklyCheckins,
      workoutFeedback,
      notifications,
      assignedMealPlans,
      driveBackup,
    ] = await Promise.all([
      this.dataSource.query(`SELECT * FROM public.profiles WHERE id = $1`, [userId]),
      this.dataSource.query(`SELECT * FROM public.user_targets WHERE user_id = $1`, [userId]),
      this.dataSource.query(`SELECT draft, client_updated_at, updated_at FROM public.workout_drafts WHERE user_id = $1`, [userId]),
      this.dataSource.query(`SELECT * FROM public.workouts WHERE user_id = $1 ORDER BY id ASC`, [userId]),
      this.dataSource.query(`SELECT * FROM public.workout_sets WHERE user_id = $1 ORDER BY id ASC`, [userId]),
      this.dataSource.query(`SELECT * FROM public.cardio_sessions WHERE user_id = $1 ORDER BY id ASC`, [userId]),
      this.dataSource.query(`SELECT * FROM public.meals WHERE user_id = $1 ORDER BY id ASC`, [userId]),
      this.dataSource.query(
        `SELECT mi.*
         FROM public.meal_items mi
         JOIN public.meals m ON m.id = mi.meal_id
         WHERE m.user_id = $1
         ORDER BY mi.id ASC`,
        [userId],
      ),
      this.dataSource.query(`SELECT * FROM public.foods WHERE user_id = $1 ORDER BY id ASC`, [userId]),
      this.dataSource.query(`SELECT * FROM public.meal_templates WHERE user_id = $1 ORDER BY id ASC`, [userId]),
      this.dataSource.query(`SELECT * FROM public.daily_steps WHERE user_id = $1 ORDER BY date ASC`, [userId]),
      this.dataSource.query(`SELECT * FROM public.daily_weight WHERE user_id = $1 ORDER BY date ASC`, [userId]),
      this.dataSource.query(`SELECT * FROM public.daily_checkin WHERE user_id = $1 ORDER BY date ASC`, [userId]),
      this.dataSource.query(`SELECT * FROM public.progress_photos WHERE user_id = $1 ORDER BY taken_on ASC`, [userId]),
      // Never export coach_client_notes (private to the coach); only export user's own coaching records.
      this.dataSource.query(`SELECT * FROM public.enrollments WHERE client_id = $1 ORDER BY created_at ASC`, [userId]),
      this.dataSource.query(`SELECT * FROM public.weekly_checkins WHERE client_id = $1 ORDER BY week_start ASC`, [userId]),
      this.dataSource.query(`SELECT * FROM public.workout_feedback WHERE author_id = $1 ORDER BY created_at ASC`, [userId]),
      this.dataSource.query(`SELECT * FROM public.notifications WHERE user_id = $1 ORDER BY created_at ASC`, [userId]),
      this.dataSource.query(`SELECT * FROM public.meal_plans WHERE assigned_client_id = $1 ORDER BY created_at ASC`, [userId]),
      this.driveBackupsRepo.findOne({ where: { userId } }),
    ]);

    const ownFoodIds = new Set((ownFoods as Record<string, unknown>[]).map((f) => String(f.id)));
    const catalogFoodIds = [
      ...new Set((mealItems as Record<string, unknown>[]).map((i) => String(i.food_id))),
    ].filter((id) => !ownFoodIds.has(id));

    const catalogFoods: Record<string, unknown>[] =
      catalogFoodIds.length > 0
        ? await this.dataSource.query(`SELECT * FROM public.foods WHERE id = ANY($1::uuid[])`, [catalogFoodIds])
        : [];

    // Omit share_token from meal_plans so revocable share links never leak in backups.
    const sanitizedMealPlans = (assignedMealPlans as Record<string, unknown>[]).map((plan) => {
      const clone = { ...plan };
      delete clone.share_token;
      return clone;
    });

    return {
      format: "replog-export",
      version: 1,
      exported_at: new Date().toISOString(),
      account: {
        id: user.id,
        email: user.email,
        created_at: user.createdAt.toISOString(),
      },
      profile: (profileRows[0] as Record<string, unknown> | undefined) ?? null,
      user_targets: (targetRows[0] as Record<string, unknown> | undefined) ?? null,
      workout_draft: (draftRows[0] as Record<string, unknown> | undefined) ?? null,
      workouts,
      workout_sets: workoutSets,
      cardio_sessions: cardioSessions,
      meals,
      meal_items: mealItems,
      foods: [...(ownFoods as Record<string, unknown>[]), ...catalogFoods],
      meal_templates: mealTemplates,
      daily_steps: dailySteps,
      daily_weight: dailyWeight,
      daily_checkin: dailyCheckin,
      progress_photos: progressPhotos,
      enrollments,
      weekly_checkins: weeklyCheckins,
      workout_feedback: workoutFeedback,
      notifications,
      meal_plans: sanitizedMealPlans,
      google_drive_backup: driveBackup
        ? {
            email: driveBackup.email ?? null,
            frequency: driveBackup.frequency,
            last_backup_at: driveBackup.lastBackupAt?.toISOString() ?? null,
          }
        : null,
    };
  }

  // Transactional all-or-nothing import of a replog-export v1 payload.
  // Intentionally skips progress_photos (restored separately via Drive) and google_drive_backup.
  async importData(userId: string, rawData: Record<string, unknown>): Promise<ImportCounts> {
    if (!rawData || rawData.format !== "replog-export" || rawData.version !== 1) {
      throw new BadRequestException("Not a valid RepLog v1 export file");
    }

    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [userId]);

      const counts: ImportCounts = {
        workouts: 0,
        workout_sets: 0,
        cardio_sessions: 0,
        meals: 0,
        meal_items: 0,
        foods: 0,
        meal_templates: 0,
        daily_steps: 0,
        daily_weight: 0,
        daily_checkin: 0,
      };

      // 1. Profile personal fields (never overwrite role!)
      const profile = rawData.profile as Record<string, unknown> | null | undefined;
      if (profile && typeof profile === "object") {
        const existingProfile = await manager.findOne(ProfileEntity, { where: { id: userId } });
        if (existingProfile) {
          if (typeof profile.display_name === "string" && profile.display_name.trim().length > 0 && profile.display_name.trim().length <= 80) {
            existingProfile.displayName = profile.display_name.trim();
          }
          const h = Number(profile.height_cm);
          if (Number.isFinite(h) && h >= 50 && h <= 272) existingProfile.heightCm = h.toFixed(1);
          if (typeof profile.birth_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(profile.birth_date) && profile.birth_date >= "1900-01-01") {
            existingProfile.birthDate = profile.birth_date;
          }
          if (profile.sex === "male" || profile.sex === "female") existingProfile.sex = profile.sex;
          if (profile.weight_unit === "kg" || profile.weight_unit === "lb") existingProfile.weightUnit = profile.weight_unit;
          const stepsGoal = Number(profile.daily_steps_goal);
          if (Number.isInteger(stepsGoal) && stepsGoal > 0 && stepsGoal <= 1_000_000) {
            existingProfile.dailyStepsGoal = stepsGoal;
          }
          if (
            profile.activity_level === "sedentary" ||
            profile.activity_level === "light" ||
            profile.activity_level === "moderate" ||
            profile.activity_level === "active" ||
            profile.activity_level === "very_active"
          ) {
            existingProfile.activityLevel = profile.activity_level;
          }
          const goalRate = Number(profile.goal_kg_per_week);
          if (Number.isFinite(goalRate) && goalRate >= -1 && goalRate <= 1) {
            existingProfile.goalKgPerWeek = goalRate.toFixed(2);
          }
          await manager.save(existingProfile);
        }
      }

      // 2. User Targets
      const targets = rawData.user_targets as Record<string, unknown> | null | undefined;
      if (targets && typeof targets === "object") {
        await manager
          .createQueryBuilder()
          .insert()
          .into(UserTargetEntity)
          .values({
            userId,
            kcal: Number(targets.kcal) || 2200,
            protein: Number(targets.protein) || 160,
            carbs: Number(targets.carbs) || 250,
            fat: Number(targets.fat) || 70,
            fiber: Number(targets.fiber) || 30,
            updatedAt: new Date(),
          })
          .orUpdate(["kcal", "protein", "carbs", "fat", "fiber", "updated_at"], ["user_id"])
          .execute();
      }

      // 3. Workout Draft
      const draft = rawData.workout_draft as Record<string, unknown> | null | undefined;
      if (draft && typeof draft === "object" && typeof draft.draft === "object" && draft.draft !== null) {
        const ts = typeof draft.client_updated_at === "string" ? new Date(draft.client_updated_at) : new Date();
        if (Number.isFinite(ts.getTime())) {
          await manager.query(
            `INSERT INTO public.workout_drafts (user_id, draft, client_updated_at, updated_at)
             VALUES ($1, $2::jsonb, $3, now())
             ON CONFLICT (user_id) DO UPDATE
               SET draft = EXCLUDED.draft,
                   client_updated_at = EXCLUDED.client_updated_at,
                   updated_at = now()`,
            [userId, JSON.stringify(draft.draft), ts.toISOString()],
          );
        }
      }

      // 4. Foods (map old food IDs -> imported/existing food IDs)
      const foodIdMap = new Map<string, string>();
      for (const f of asArray(rawData.foods)) {
        const oldId = typeof f.id === "string" ? f.id : null;
        const name = typeof f.name === "string" ? f.name.trim() : "";
        if (!name) continue;
        const barcode = typeof f.barcode === "string" && f.barcode.trim() ? f.barcode.trim() : null;

        if (barcode) {
          const existing = await manager.findOne(FoodEntity, { where: { barcode } });
          if (existing) {
            if (oldId) foodIdMap.set(oldId, existing.id);
            continue;
          }
          const created = await manager.save(
            manager.create(FoodEntity, {
              userId: null,
              name,
              brand: typeof f.brand === "string" ? f.brand : null,
              barcode,
              kcalPer100g: String(Number(f.kcal_per_100g) || 0),
              proteinPer100g: String(Number(f.protein_per_100g) || 0),
              carbsPer100g: String(Number(f.carbs_per_100g) || 0),
              fatPer100g: String(Number(f.fat_per_100g) || 0),
              saturatedFatPer100g: String(Number(f.saturated_fat_per_100g) || 0),
              polyunsaturatedFatPer100g: String(Number(f.polyunsaturated_fat_per_100g) || 0),
              fiberPer100g: String(Number(f.fiber_per_100g) || 0),
              sodiumMgPer100g: String(Number(f.sodium_mg_per_100g) || 0),
            }),
          );
          if (oldId) foodIdMap.set(oldId, created.id);
          counts.foods++;
        } else {
          const created = await manager.save(
            manager.create(FoodEntity, {
              userId,
              name,
              brand: typeof f.brand === "string" ? f.brand : null,
              barcode: null,
              kcalPer100g: String(Number(f.kcal_per_100g) || 0),
              proteinPer100g: String(Number(f.protein_per_100g) || 0),
              carbsPer100g: String(Number(f.carbs_per_100g) || 0),
              fatPer100g: String(Number(f.fat_per_100g) || 0),
              saturatedFatPer100g: String(Number(f.saturated_fat_per_100g) || 0),
              polyunsaturatedFatPer100g: String(Number(f.polyunsaturated_fat_per_100g) || 0),
              fiberPer100g: String(Number(f.fiber_per_100g) || 0),
              sodiumMgPer100g: String(Number(f.sodium_mg_per_100g) || 0),
            }),
          );
          if (oldId) foodIdMap.set(oldId, created.id);
          counts.foods++;
        }
      }

      // 5. Workouts, Sets & Cardio
      const workoutIdMap = new Map<string, string>();
      for (const w of asArray(rawData.workouts)) {
        const oldId = typeof w.id === "string" ? w.id : null;
        const performedOn = typeof w.performed_on === "string" ? w.performed_on.slice(0, 10) : null;
        const split = typeof w.split === "string" && w.split.trim() ? w.split.trim() : "Workout";
        const mode = w.workout_mode === "cardio" ? "cardio" : "strength";
        if (!performedOn || !/^\d{4}-\d{2}-\d{2}$/.test(performedOn)) continue;

        const created = await manager.save(
          manager.create(WorkoutEntity, {
            userId,
            performedOn,
            split,
            workoutMode: mode,
            clientId: null,
            programWorkoutId: null,
            enrollmentId: null,
          }),
        );
        if (oldId) workoutIdMap.set(oldId, created.id);
        counts.workouts++;
      }

      for (const s of asArray(rawData.workout_sets)) {
        const mappedWorkoutId = typeof s.workout_id === "string" ? workoutIdMap.get(s.workout_id) : undefined;
        if (!mappedWorkoutId) continue;
        const exercise = typeof s.exercise === "string" ? s.exercise.trim() : "";
        if (!exercise) continue;
        const rirRaw = s.rir === null || s.rir === undefined ? null : Number(s.rir);
        const rir = rirRaw !== null && Number.isInteger(rirRaw) && rirRaw >= 0 && rirRaw <= 5 ? rirRaw : null;

        await manager.save(
          manager.create(WorkoutSetEntity, {
            workoutId: mappedWorkoutId,
            userId,
            split: typeof s.split === "string" && s.split.trim() ? s.split.trim() : "Workout",
            exercise,
            setNumber: Math.max(1, Number(s.set_number) || 1),
            reps: Math.max(0, Number(s.reps) || 0),
            weight: Math.min(10000, Math.max(0, Number(s.weight) || 0)).toFixed(2),
            rir,
            setType: typeof s.set_type === "string" && s.set_type.trim() ? s.set_type.trim() : "Working Set",
            notes: typeof s.notes === "string" && s.notes.length < 100 && s.notes.trim() ? s.notes : null,
            isPr: Boolean(s.is_pr),
          }),
        );
        counts.workout_sets++;
      }

      for (const c of asArray(rawData.cardio_sessions)) {
        const mappedWorkoutId = typeof c.workout_id === "string" ? workoutIdMap.get(c.workout_id) : undefined;
        if (!mappedWorkoutId) continue;
        const activity = typeof c.activity === "string" ? c.activity.trim().slice(0, 120) : "";
        const durationMin = Math.round(Number(c.duration_min));
        if (!activity || !Number.isFinite(durationMin) || durationMin < 1 || durationMin > 1440) continue;

        await manager.save(
          manager.create(CardioSessionEntity, {
            workoutId: mappedWorkoutId,
            userId,
            activity,
            durationMin,
          }),
        );
        counts.cardio_sessions++;
      }

      // 6. Meals & Meal Items
      const mealIdMap = new Map<string, string>();
      const validMealTypes = new Set(["Breakfast", "Lunch", "Dinner", "Snack"]);
      for (const m of asArray(rawData.meals)) {
        const oldId = typeof m.id === "string" ? m.id : null;
        const performedOn = typeof m.performed_on === "string" ? m.performed_on.slice(0, 10) : null;
        const mealType = typeof m.meal_type === "string" && validMealTypes.has(m.meal_type) ? m.meal_type : "Snack";
        if (!performedOn || !/^\d{4}-\d{2}-\d{2}$/.test(performedOn)) continue;

        const created = await manager.save(
          manager.create(MealEntity, {
            userId,
            performedOn,
            mealType: mealType as "Breakfast" | "Lunch" | "Dinner" | "Snack",
            notes: typeof m.notes === "string" ? m.notes : null,
          }),
        );
        if (oldId) mealIdMap.set(oldId, created.id);
        counts.meals++;
      }

      for (const mi of asArray(rawData.meal_items)) {
        const mappedMealId = typeof mi.meal_id === "string" ? mealIdMap.get(mi.meal_id) : undefined;
        const mappedFoodId = typeof mi.food_id === "string" ? foodIdMap.get(mi.food_id) : undefined;
        if (!mappedMealId || !mappedFoodId) continue;

        await manager.save(
          manager.create(MealItemEntity, {
            mealId: mappedMealId,
            foodId: mappedFoodId,
            consumedWeightG: String(Number(mi.consumed_weight_g) || 0),
            totalKcal: String(Number(mi.total_kcal) || 0),
            totalProteinG: String(Number(mi.total_protein_g) || 0),
            totalCarbsG: String(Number(mi.total_carbs_g) || 0),
            totalFatG: String(Number(mi.total_fat_g) || 0),
          }),
        );
        counts.meal_items++;
      }

      // 7. Meal Templates
      for (const tpl of asArray(rawData.meal_templates)) {
        const name = typeof tpl.name === "string" ? tpl.name.trim() : "";
        if (!name) continue;
        await manager.save(
          manager.create(MealTemplateEntity, {
            userId,
            name,
            items: Array.isArray(tpl.items) ? tpl.items : [],
          }),
        );
        counts.meal_templates++;
      }

      // 8. Daily Metrics (Steps, Weight, Check-in)
      for (const st of asArray(rawData.daily_steps)) {
        const date = typeof st.date === "string" ? st.date.slice(0, 10) : null;
        const steps = Number(st.steps);
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(steps) || steps < 0) continue;
        await manager
          .createQueryBuilder()
          .insert()
          .into(DailyStepsEntity)
          .values({ userId, date, steps })
          .orUpdate(["steps"], ["user_id", "date"])
          .execute();
        counts.daily_steps++;
      }

      for (const wt of asArray(rawData.daily_weight)) {
        const date = typeof wt.date === "string" ? wt.date.slice(0, 10) : null;
        const weightKg = Number(wt.weight_kg);
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(weightKg) || weightKg <= 0 || weightKg >= 10000) continue;
        await manager
          .createQueryBuilder()
          .insert()
          .into(DailyWeightEntity)
          .values({ userId, date, weightKg: weightKg.toFixed(2) })
          .orUpdate(["weight_kg"], ["user_id", "date"])
          .execute();
        counts.daily_weight++;
      }

      for (const ch of asArray(rawData.daily_checkin)) {
        const date = typeof ch.date === "string" ? ch.date.slice(0, 10) : null;
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        const score = (v: unknown) => {
          const n = v === null || v === undefined ? null : Number(v);
          return n !== null && Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
        };
        const energy = score(ch.energy);
        const satiety = score(ch.satiety);
        const sleep = score(ch.sleep);
        const note = typeof ch.note === "string" && ch.note.trim() ? ch.note.trim().slice(0, 280) : null;
        if (energy === null && satiety === null && sleep === null && note === null) continue;

        await manager
          .createQueryBuilder()
          .insert()
          .into(DailyCheckinEntity)
          .values({ userId, date, energy, satiety, sleep, note })
          .orUpdate(["energy", "satiety", "sleep", "note"], ["user_id", "date"])
          .execute();
        counts.daily_checkin++;
      }

      return counts;
    });
  }

  private async verifyConfirmEmail(userId: string, confirmEmail: string): Promise<UserEntity> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("Account not found");
    if (confirmEmail.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
      throw new BadRequestException("Confirmation email does not match your account email");
    }
    return user;
  }

  // CRITICAL GDPR INVARIANT: S3 storage files do not cascade on DB delete, so purge S3 FIRST and abort on failure.
  private async purgeUserStorageOrAbort(userId: string): Promise<void> {
    try {
      await this.storage.deleteUserPrefix(this.storage.getProgressPhotosBucket(), userId);
      await this.storage.deleteUserPrefix(this.storage.getCheckinPhotosBucket(), userId);
    } catch (err) {
      this.logger.error(`Aborted erasure for ${userId}: S3 photo purge failed`, err);
      throw new InternalServerErrorException("Failed to remove stored photo files; no database data was deleted");
    }
  }

  private async cleanupDriveBestEffort(userId: string): Promise<void> {
    if (!this.driveCleanup) return;
    await this.driveCleanup.purgeDrivePhotos(userId).catch((err) => this.logger.warn(`Drive photo purge warning: ${String(err)}`));
    await this.driveCleanup.removeDriveLink(userId).catch((err) => this.logger.warn(`Drive link cleanup warning: ${String(err)}`));
  }

  async deleteAllData(userId: string, confirmEmail: string): Promise<{ success: true }> {
    await this.verifyConfirmEmail(userId, confirmEmail);
    await this.purgeUserStorageOrAbort(userId);
    await this.cleanupDriveBestEffort(userId);

    await this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [userId]);
      await manager.query(`DELETE FROM public.workouts WHERE user_id = $1`, [userId]);
      await manager.query(`DELETE FROM public.workout_sets WHERE user_id = $1`, [userId]);
      await manager.query(`DELETE FROM public.cardio_sessions WHERE user_id = $1`, [userId]);
      await manager.query(`DELETE FROM public.workout_drafts WHERE user_id = $1`, [userId]);
      await manager.query(`DELETE FROM public.meals WHERE user_id = $1`, [userId]);
      await manager.query(`DELETE FROM public.meal_templates WHERE user_id = $1`, [userId]);
      await manager.query(`DELETE FROM public.foods WHERE user_id = $1`, [userId]);
      await manager.query(`DELETE FROM public.user_targets WHERE user_id = $1`, [userId]);
      await manager.query(`DELETE FROM public.daily_steps WHERE user_id = $1`, [userId]);
      await manager.query(`DELETE FROM public.daily_weight WHERE user_id = $1`, [userId]);
      await manager.query(`DELETE FROM public.daily_checkin WHERE user_id = $1`, [userId]);
      await manager.query(`DELETE FROM public.progress_photos WHERE user_id = $1`, [userId]);
      await manager.query(`DELETE FROM public.offline_sync_receipts WHERE user_id = $1`, [userId]);
      await manager.query(`DELETE FROM public.google_drive_backups WHERE user_id = $1`, [userId]);
      await manager.query(`DELETE FROM public.notifications WHERE user_id = $1`, [userId]);
      await manager.query(`DELETE FROM public.weekly_checkins WHERE client_id = $1`, [userId]);
      await manager.query(`DELETE FROM public.workout_feedback WHERE author_id = $1`, [userId]);
    });

    return { success: true };
  }

  async deleteAccount(userId: string, confirmEmail: string): Promise<{ success: true }> {
    await this.verifyConfirmEmail(userId, confirmEmail);
    return this.deleteAccountUnchecked(userId);
  }

  async deleteAccountUnchecked(userId: string): Promise<{ success: true }> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("Account not found");

    await this.purgeUserStorageOrAbort(userId);
    await this.cleanupDriveBestEffort(userId);

    // Every user-data table has ON DELETE CASCADE to public.users(id).
    await this.usersRepo.delete({ id: userId });
    return { success: true };
  }
}
