import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, Repository } from "typeorm";
import {
  generateShareToken,
  isValidShareToken,
  localDate,
  toDiaryMealType,
  validateMealPlanPayload,
} from "@replog/shared";
import {
  CoachProfileEntity,
  EnrollmentEntity,
  FoodEntity,
  MealEntity,
  MealItemEntity,
  MealPlanDayEntity,
  MealPlanEntity,
  MealPlanItemEntity,
  MealPlanMealEntity,
  ProfileEntity,
  UserTargetEntity,
} from "../../database/entities";
import { NotificationsService } from "../notifications/notifications.service";
import type { SaveMealPlanDto } from "./dto/meal-plan.dto";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tEn = (_ro: string, en: string) => en;

function serializeMealPlan(
  plan: MealPlanEntity,
  options: { coachName: string; clientName?: string | null; includeInternal?: boolean },
) {
  const days = [...(plan.days ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((d) => ({
      id: d.id,
      position: d.position,
      title: d.title,
      notes: d.notes ?? null,
      meals: [...(d.meals ?? [])]
        .sort((a, b) => a.position - b.position)
        .map((m) => ({
          id: m.id,
          position: m.position,
          mealType: m.mealType,
          title: m.title,
          timeLabel: m.timeLabel ?? null,
          notes: m.notes ?? null,
          items: [...(m.items ?? [])]
            .sort((a, b) => a.position - b.position)
            .map((i) => ({
              id: i.id,
              position: i.position,
              foodId: options.includeInternal ? (i.foodId ?? null) : null,
              name: i.name,
              brand: i.brand ?? null,
              grams: Number(i.grams),
              kcalPer100g: Number(i.kcalPer100g),
              proteinPer100g: Number(i.proteinPer100g),
              carbsPer100g: Number(i.carbsPer100g),
              fatPer100g: Number(i.fatPer100g),
              fiberPer100g: i.fiberPer100g !== null ? Number(i.fiberPer100g) : null,
              notes: i.notes ?? null,
            })),
        })),
    }));

  return {
    id: plan.id,
    title: plan.title,
    description: plan.description ?? null,
    goal: plan.goal,
    status: plan.status,
    targetKcal: plan.targetKcal ?? null,
    targetProteinG: plan.targetProteinG ?? null,
    targetCarbsG: plan.targetCarbsG ?? null,
    targetFatG: plan.targetFatG ?? null,
    targetFiberG: plan.targetFiberG ?? null,
    waterLiters: plan.waterLiters !== null ? Number(plan.waterLiters) : null,
    notes: plan.notes ?? null,
    coachName: options.coachName,
    updatedAt: plan.updatedAt.toISOString(),
    ...(options.includeInternal
      ? {
          assignedClientId: plan.assignedClientId ?? null,
          clientName: options.clientName ?? null,
          shareToken: plan.shareToken ?? null,
        }
      : {}),
    days,
  };
}

@Injectable()
export class MealPlansService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(MealPlanEntity)
    private readonly plansRepo: Repository<MealPlanEntity>,
    @InjectRepository(MealPlanMealEntity)
    private readonly planMealsRepo: Repository<MealPlanMealEntity>,
    @InjectRepository(EnrollmentEntity)
    private readonly enrollmentsRepo: Repository<EnrollmentEntity>,
    @InjectRepository(CoachProfileEntity)
    private readonly coachProfilesRepo: Repository<CoachProfileEntity>,
    @InjectRepository(ProfileEntity)
    private readonly profilesRepo: Repository<ProfileEntity>,
    @InjectRepository(UserTargetEntity)
    private readonly targetsRepo: Repository<UserTargetEntity>,
    private readonly notifications: NotificationsService,
  ) {}

  private async resolveCoachName(coachId: string): Promise<string> {
    const [coachProfile, profile] = await Promise.all([
      this.coachProfilesRepo.findOne({ where: { userId: coachId }, select: { displayName: true } }),
      this.profilesRepo.findOne({ where: { id: coachId }, select: { displayName: true } }),
    ]);
    return coachProfile?.displayName?.trim() || profile?.displayName?.trim() || "Coach";
  }

  // =========================================================================
  // Coach Meal Plans CRUD, Clone & Share Links
  // =========================================================================

  async listCoachPlans(coachId: string) {
    const plans = await this.plansRepo.find({
      where: { coachId },
      relations: { days: { meals: true } },
      order: { updatedAt: "DESC" },
    });
    const clientIds = [...new Set(plans.map((p) => p.assignedClientId).filter((id): id is string => Boolean(id)))];
    const clientProfiles =
      clientIds.length > 0
        ? await this.profilesRepo.find({ where: { id: In(clientIds) }, select: { id: true, displayName: true } })
        : [];
    const clientMap = new Map(clientProfiles.map((p) => [p.id, p.displayName]));
    const coachName = await this.resolveCoachName(coachId);

    return plans.map((p) =>
      serializeMealPlan(p, {
        coachName,
        clientName: p.assignedClientId ? (clientMap.get(p.assignedClientId) ?? null) : null,
        includeInternal: true,
      }),
    );
  }

  async getCoachPlan(coachId: string, planId: string) {
    if (!UUID_REGEX.test(planId)) throw new NotFoundException("Meal plan not found");
    const plan = await this.plansRepo.findOne({
      where: { id: planId, coachId },
      relations: { days: { meals: { items: true } } },
    });
    if (!plan) throw new NotFoundException("Meal plan not found");

    const [coachName, clientProfile] = await Promise.all([
      this.resolveCoachName(coachId),
      plan.assignedClientId
        ? this.profilesRepo.findOne({ where: { id: plan.assignedClientId }, select: { displayName: true } })
        : Promise.resolve(null),
    ]);

    return serializeMealPlan(plan, {
      coachName,
      clientName: clientProfile?.displayName ?? null,
      includeInternal: true,
    });
  }

  async saveCoachPlan(coachId: string, dto: SaveMealPlanDto, planId?: string) {
    const checked = validateMealPlanPayload(
      {
        id: planId,
        assignedClientId: dto.assignedClientId ?? null,
        title: dto.title,
        description: dto.description ?? "",
        goal: dto.goal,
        status: dto.status,
        targetKcal: dto.targetKcal ?? null,
        targetProteinG: dto.targetProteinG ?? null,
        targetCarbsG: dto.targetCarbsG ?? null,
        targetFatG: dto.targetFatG ?? null,
        targetFiberG: dto.targetFiberG ?? null,
        waterLiters: dto.waterLiters ?? null,
        notes: dto.notes ?? "",
        days: dto.days.map((d) => ({
          id: d.id,
          title: d.title,
          notes: d.notes ?? "",
          meals: d.meals.map((m) => ({
            id: m.id,
            mealType: m.mealType,
            title: m.title,
            timeLabel: m.timeLabel ?? "",
            notes: m.notes ?? "",
            items: m.items.map((i) => ({
              id: i.id,
              foodId: i.foodId ?? null,
              name: i.name,
              brand: i.brand ?? "",
              grams: i.grams,
              kcalPer100g: i.kcalPer100g,
              proteinPer100g: i.proteinPer100g,
              carbsPer100g: i.carbsPer100g,
              fatPer100g: i.fatPer100g,
              fiberPer100g: i.fiberPer100g ?? null,
              notes: i.notes ?? "",
            })),
          })),
        })),
      },
      tEn,
    );
    if (!checked.ok) throw new BadRequestException(checked.error);
    const data = checked.data;

    if (data.assignedClientId) {
      if (data.assignedClientId === coachId) {
        throw new BadRequestException("Cannot assign a meal plan to yourself");
      }
      const activeEnrollment = await this.enrollmentsRepo.findOne({
        where: { coachId, clientId: data.assignedClientId, status: "active" },
        select: { id: true },
      });
      if (!activeEnrollment) {
        throw new ForbiddenException("Can only assign a meal plan to a client with an active enrollment");
      }
    }

    let wasAlreadyActiveForSameClient = false;
    let shouldNotifyAssigned = false;

    const savedId = await this.dataSource.transaction(async (manager) => {
      let targetPlan: MealPlanEntity;
      if (planId) {
        if (!UUID_REGEX.test(planId)) throw new NotFoundException("Meal plan not found");
        const existing = await manager.findOne(MealPlanEntity, { where: { id: planId, coachId } });
        if (!existing) throw new NotFoundException("Meal plan not found");

        wasAlreadyActiveForSameClient =
          existing.status === "active" &&
          existing.assignedClientId !== null &&
          existing.assignedClientId === data.assignedClientId;

        shouldNotifyAssigned =
          data.status === "active" &&
          data.assignedClientId !== null &&
          (existing.assignedClientId !== data.assignedClientId || existing.status !== "active");

        Object.assign(existing, {
          assignedClientId: data.assignedClientId,
          title: data.title,
          description: data.description,
          goal: data.goal,
          status: data.status,
          targetKcal: data.targetKcal,
          targetProteinG: data.targetProteinG,
          targetCarbsG: data.targetCarbsG,
          targetFatG: data.targetFatG,
          targetFiberG: data.targetFiberG,
          waterLiters: data.waterLiters !== null ? data.waterLiters.toFixed(1) : null,
          notes: data.notes,
        });
        targetPlan = await manager.save(existing);
      } else {
        shouldNotifyAssigned = data.status === "active" && data.assignedClientId !== null;
        targetPlan = await manager.save(
          manager.create(MealPlanEntity, {
            coachId,
            assignedClientId: data.assignedClientId,
            title: data.title,
            description: data.description,
            goal: data.goal,
            status: data.status,
            targetKcal: data.targetKcal,
            targetProteinG: data.targetProteinG,
            targetCarbsG: data.targetCarbsG,
            targetFatG: data.targetFatG,
            targetFiberG: data.targetFiberG,
            waterLiters: data.waterLiters !== null ? data.waterLiters.toFixed(1) : null,
            notes: data.notes,
          }),
        );
      }

      await manager.delete(MealPlanDayEntity, { mealPlanId: targetPlan.id });

      for (let di = 0; di < data.days.length; di++) {
        const day = data.days[di];
        const savedDay = await manager.save(
          manager.create(MealPlanDayEntity, {
            mealPlanId: targetPlan.id,
            position: di + 1,
            title: day.title,
            notes: day.notes || null,
          }),
        );

        for (let mi = 0; mi < day.meals.length; mi++) {
          const meal = day.meals[mi];
          const savedMeal = await manager.save(
            manager.create(MealPlanMealEntity, {
              mealPlanDayId: savedDay.id,
              position: mi + 1,
              mealType: meal.mealType,
              title: meal.title,
              timeLabel: meal.timeLabel || null,
              notes: meal.notes || null,
            }),
          );

          if (meal.items.length > 0) {
            await manager.save(
              meal.items.map((item, ii) =>
                manager.create(MealPlanItemEntity, {
                  mealPlanMealId: savedMeal.id,
                  position: ii + 1,
                  foodId: item.foodId,
                  name: item.name,
                  brand: item.brand || null,
                  grams: item.grams.toFixed(1),
                  kcalPer100g: item.kcalPer100g.toFixed(2),
                  proteinPer100g: item.proteinPer100g.toFixed(2),
                  carbsPer100g: item.carbsPer100g.toFixed(2),
                  fatPer100g: item.fatPer100g.toFixed(2),
                  fiberPer100g: item.fiberPer100g !== null ? item.fiberPer100g.toFixed(2) : null,
                  notes: item.notes || null,
                }),
              ),
            );
          }
        }
      }

      return targetPlan.id;
    });

    if (data.assignedClientId && data.status === "active") {
      const coachName = await this.resolveCoachName(coachId);
      if (shouldNotifyAssigned) {
        await this.notifications.notify(
          data.assignedClientId,
          coachId,
          "meal_plan_assigned",
          { meal_plan_id: savedId, plan_title: data.title, coach_name: coachName },
          "/meals/plan",
        );
      } else if (dto.notifyClient && wasAlreadyActiveForSameClient) {
        await this.notifications.notify(
          data.assignedClientId,
          coachId,
          "meal_plan_updated",
          { meal_plan_id: savedId, plan_title: data.title, coach_name: coachName },
          "/meals/plan",
        );
      }
    }

    return this.getCoachPlan(coachId, savedId);
  }

  async clonePlanForClient(coachId: string, planId: string, clientId: string) {
    if (!UUID_REGEX.test(planId)) throw new NotFoundException("Meal plan not found");
    if (coachId === clientId) throw new BadRequestException("Cannot clone a meal plan for yourself");

    const source = await this.plansRepo.findOne({
      where: { id: planId, coachId },
      relations: { days: { meals: { items: true } } },
    });
    if (!source) throw new NotFoundException("Meal plan not found");

    const active = await this.enrollmentsRepo.findOne({
      where: { coachId, clientId, status: "active" },
      select: { id: true },
    });
    if (!active) throw new ForbiddenException("Active coach-client enrollment required");

    const clonedId = await this.dataSource.transaction(async (manager) => {
      const cloned = await manager.save(
        manager.create(MealPlanEntity, {
          coachId,
          assignedClientId: clientId,
          title: source.title,
          description: source.description,
          goal: source.goal,
          status: "active",
          targetKcal: source.targetKcal,
          targetProteinG: source.targetProteinG,
          targetCarbsG: source.targetCarbsG,
          targetFatG: source.targetFatG,
          targetFiberG: source.targetFiberG,
          waterLiters: source.waterLiters,
          notes: source.notes,
          shareToken: null,
        }),
      );

      for (const day of source.days ?? []) {
        const clonedDay = await manager.save(
          manager.create(MealPlanDayEntity, {
            mealPlanId: cloned.id,
            position: day.position,
            title: day.title,
            notes: day.notes,
          }),
        );
        for (const meal of day.meals ?? []) {
          const clonedMeal = await manager.save(
            manager.create(MealPlanMealEntity, {
              mealPlanDayId: clonedDay.id,
              position: meal.position,
              mealType: meal.mealType,
              title: meal.title,
              timeLabel: meal.timeLabel,
              notes: meal.notes,
            }),
          );
          if (meal.items && meal.items.length > 0) {
            await manager.save(
              meal.items.map((item) =>
                manager.create(MealPlanItemEntity, {
                  mealPlanMealId: clonedMeal.id,
                  position: item.position,
                  foodId: item.foodId,
                  name: item.name,
                  brand: item.brand,
                  grams: item.grams,
                  kcalPer100g: item.kcalPer100g,
                  proteinPer100g: item.proteinPer100g,
                  carbsPer100g: item.carbsPer100g,
                  fatPer100g: item.fatPer100g,
                  fiberPer100g: item.fiberPer100g,
                  notes: item.notes,
                }),
              ),
            );
          }
        }
      }

      return cloned.id;
    });

    const coachName = await this.resolveCoachName(coachId);
    await this.notifications.notify(
      clientId,
      coachId,
      "meal_plan_assigned",
      { meal_plan_id: clonedId, plan_title: source.title, coach_name: coachName },
      "/meals/plan",
    );

    return this.getCoachPlan(coachId, clonedId);
  }

  async toggleShareLink(coachId: string, planId: string, enable: boolean): Promise<{ shareToken: string | null }> {
    if (!UUID_REGEX.test(planId)) throw new NotFoundException("Meal plan not found");
    const existing = await this.plansRepo.findOne({ where: { id: planId, coachId }, select: { id: true } });
    if (!existing) throw new NotFoundException("Meal plan not found");

    if (!enable) {
      await this.plansRepo.update({ id: planId, coachId }, { shareToken: null });
      return { shareToken: null };
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const token = generateShareToken(24);
      try {
        await this.plansRepo.update({ id: planId, coachId }, { shareToken: token });
        return { shareToken: token };
      } catch (err) {
        const pgCode = (err as { driverError?: { code?: string } })?.driverError?.code;
        if (pgCode !== "23505") throw err;
      }
    }
    throw new ConflictException("Could not generate a unique share link");
  }

  async deleteCoachPlan(coachId: string, planId: string): Promise<{ deleted: true }> {
    if (!UUID_REGEX.test(planId)) throw new NotFoundException("Meal plan not found");
    const res = await this.plansRepo.delete({ id: planId, coachId });
    if (!res.affected) throw new NotFoundException("Meal plan not found");
    return { deleted: true };
  }

  // =========================================================================
  // Client Meal Plan View, 1-Click Log & Apply Targets
  // =========================================================================

  async listClientActivePlans(clientId: string) {
    const validEnrollments = await this.enrollmentsRepo.find({
      where: { clientId, status: In(["active", "completed"]) },
      select: { coachId: true },
    });
    const coachIds = [...new Set(validEnrollments.map((e) => e.coachId))];
    if (coachIds.length === 0) return [];

    const plans = await this.plansRepo.find({
      where: { assignedClientId: clientId, status: "active", coachId: In(coachIds) },
      relations: { days: { meals: { items: true } } },
      order: { updatedAt: "DESC" },
    });

    const coachProfiles = await this.coachProfilesRepo.find({ where: { userId: In(coachIds) } });
    const coachMap = new Map(coachProfiles.map((c) => [c.userId, c.displayName]));

    return plans.map((plan) =>
      serializeMealPlan(plan, {
        coachName: coachMap.get(plan.coachId) ?? "Coach",
        includeInternal: false,
      }),
    );
  }

  async logPlanMealToday(clientId: string, planMealId: string) {
    if (!UUID_REGEX.test(planMealId)) throw new NotFoundException("Plan meal not found");

    const planMeal = await this.planMealsRepo.findOne({
      where: { id: planMealId },
      relations: { day: { mealPlan: true }, items: true },
    });
    const plan = planMeal?.day?.mealPlan;
    if (!planMeal || !plan || plan.assignedClientId !== clientId || plan.status !== "active") {
      throw new NotFoundException("Plan meal not found");
    }

    const enrollment = await this.enrollmentsRepo.findOne({
      where: { coachId: plan.coachId, clientId, status: In(["active", "completed"]) },
      select: { id: true },
    });
    if (!enrollment) throw new ForbiddenException("Active or completed coach enrollment required");

    const items = [...(planMeal.items ?? [])].sort((a, b) => a.position - b.position);
    if (items.length === 0) {
      throw new BadRequestException("This meal has no foods");
    }

    const today = localDate();
    const mealId = await this.dataSource.transaction(async (manager) => {
      const createdMeal = await manager.save(
        manager.create(MealEntity, {
          userId: clientId,
          performedOn: today,
          mealType: toDiaryMealType(planMeal.mealType, planMeal.position),
          notes: planMeal.title,
        }),
      );

      for (const item of items) {
        let resolvedFoodId: string | null = null;
        if (item.foodId) {
          const readable = await manager
            .createQueryBuilder(FoodEntity, "f")
            .where("f.id = :id AND (f.user_id IS NULL OR f.user_id = :clientId)", {
              id: item.foodId,
              clientId,
            })
            .getOne();
          if (readable) resolvedFoodId = readable.id;
        }

        if (!resolvedFoodId) {
          const privateFood = await manager.save(
            manager.create(FoodEntity, {
              userId: clientId,
              name: item.name,
              brand: item.brand || "Meal Plan",
              barcode: null,
              kcalPer100g: item.kcalPer100g,
              proteinPer100g: item.proteinPer100g,
              carbsPer100g: item.carbsPer100g,
              fatPer100g: item.fatPer100g,
              fiberPer100g: item.fiberPer100g ?? "0",
            }),
          );
          resolvedFoodId = privateFood.id;
        }

        const grams = Number(item.grams);
        const mult = grams / 100;
        await manager.save(
          manager.create(MealItemEntity, {
            mealId: createdMeal.id,
            foodId: resolvedFoodId,
            consumedWeightG: String(grams),
            totalKcal: String(Math.round(Number(item.kcalPer100g) * mult)),
            totalProteinG: String(Math.round(Number(item.proteinPer100g) * mult * 10) / 10),
            totalCarbsG: String(Math.round(Number(item.carbsPer100g) * mult * 10) / 10),
            totalFatG: String(Math.round(Number(item.fatPer100g) * mult * 10) / 10),
          }),
        );
      }

      return createdMeal.id;
    });

    return { success: true, mealId };
  }

  async applyPlanTargets(clientId: string, planId: string) {
    if (!UUID_REGEX.test(planId)) throw new NotFoundException("Meal plan not found");
    const plan = await this.plansRepo.findOne({
      where: { id: planId, assignedClientId: clientId, status: "active" },
    });
    if (!plan) throw new NotFoundException("Meal plan not found");

    const enrollment = await this.enrollmentsRepo.findOne({
      where: { coachId: plan.coachId, clientId, status: In(["active", "completed"]) },
      select: { id: true },
    });
    if (!enrollment) throw new ForbiddenException("Active or completed coach enrollment required");

    const existing = await this.targetsRepo.findOne({ where: { userId: clientId } });
    const next = {
      kcal: plan.targetKcal ?? existing?.kcal ?? 2200,
      protein: plan.targetProteinG ?? existing?.protein ?? 160,
      carbs: plan.targetCarbsG ?? existing?.carbs ?? 250,
      fat: plan.targetFatG ?? existing?.fat ?? 70,
      fiber: plan.targetFiberG ?? existing?.fiber ?? 30,
    };

    const now = new Date();
    await this.targetsRepo
      .createQueryBuilder()
      .insert()
      .into(UserTargetEntity)
      .values({ userId: clientId, ...next, updatedAt: now })
      .orUpdate(["kcal", "protein", "carbs", "fat", "fiber", "updated_at"], ["user_id"])
      .execute();

    return { success: true, targets: { ...next, updatedAt: now.toISOString() } };
  }

  // =========================================================================
  // Public Share Link Endpoint (NO Auth, ZERO PII)
  // =========================================================================

  async getPublicByToken(rawToken: string) {
    if (!isValidShareToken(rawToken)) {
      throw new NotFoundException("Shared meal plan not found");
    }

    const plan = await this.plansRepo.findOne({
      where: { shareToken: rawToken },
      relations: { days: { meals: { items: true } } },
    });
    if (!plan) {
      throw new NotFoundException("Shared meal plan not found");
    }

    const coachName = await this.resolveCoachName(plan.coachId);
    // Explicitly omits assignedClientId, clientName, shareToken, and foodId — zero PII leaked.
    return serializeMealPlan(plan, { coachName, includeInternal: false });
  }
}
