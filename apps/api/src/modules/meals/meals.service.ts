import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { recommendEnergy } from "@replog/shared";
import {
  DailyWeightEntity,
  FoodEntity,
  MealEntity,
  MealItemEntity,
  MealTemplateEntity,
  ProfileEntity,
  UserTargetEntity,
} from "../../database/entities";
import { FoodsService, serializeFood } from "../foods/foods.service";
import type { CreateMealDto, CreateMealTemplateDto, UpsertUserTargetsDto } from "./dto/meal.dto";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const DEFAULT_TARGETS = {
  kcal: 2200,
  protein: 160,
  carbs: 250,
  fat: 70,
  fiber: 30,
};

function serializeMeal(meal: MealEntity) {
  return {
    id: meal.id,
    performedOn: String(meal.performedOn).slice(0, 10),
    mealType: meal.mealType,
    notes: meal.notes ?? null,
    createdAt: meal.createdAt instanceof Date ? meal.createdAt.toISOString() : String(meal.createdAt),
    items: (meal.items ?? []).map((item) => ({
      id: item.id,
      mealId: item.mealId,
      foodId: item.foodId,
      consumedWeightG: Number(item.consumedWeightG),
      totalKcal: Number(item.totalKcal),
      totalProteinG: Number(item.totalProteinG),
      totalCarbsG: Number(item.totalCarbsG),
      totalFatG: Number(item.totalFatG),
      food: item.food ? serializeFood(item.food, "local_db") : null,
    })),
  };
}

@Injectable()
export class MealsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(MealEntity)
    private readonly mealsRepo: Repository<MealEntity>,
    @InjectRepository(MealItemEntity)
    private readonly mealItemsRepo: Repository<MealItemEntity>,
    @InjectRepository(MealTemplateEntity)
    private readonly templatesRepo: Repository<MealTemplateEntity>,
    @InjectRepository(UserTargetEntity)
    private readonly targetsRepo: Repository<UserTargetEntity>,
    @InjectRepository(ProfileEntity)
    private readonly profilesRepo: Repository<ProfileEntity>,
    @InjectRepository(DailyWeightEntity)
    private readonly weightsRepo: Repository<DailyWeightEntity>,
    private readonly foodsService: FoodsService,
  ) {}

  async listMeals(userId: string, query: { date?: string; from?: string; to?: string }) {
    const qb = this.mealsRepo
      .createQueryBuilder("m")
      .leftJoinAndSelect("m.items", "i")
      .leftJoinAndSelect("i.food", "f")
      .where("m.userId = :userId", { userId })
      .orderBy("m.performedOn", "DESC")
      .addOrderBy("m.createdAt", "DESC");

    if (query.date && DATE_REGEX.test(query.date)) {
      qb.andWhere("m.performedOn = :date", { date: query.date });
    } else {
      if (query.from && DATE_REGEX.test(query.from)) qb.andWhere("m.performedOn >= :from", { from: query.from });
      if (query.to && DATE_REGEX.test(query.to)) qb.andWhere("m.performedOn <= :to", { to: query.to });
    }

    const rows = await qb.getMany();
    return rows.map(serializeMeal);
  }

  async createMeal(userId: string, dto: CreateMealDto) {
    const performedOn = dto.performedOn ?? new Date().toISOString().slice(0, 10);

    // Pre-resolve any barcode lookups outside the DB transaction to avoid holding a transaction over HTTP.
    const resolvedFoods = new Map<number, FoodEntity>();
    for (let idx = 0; idx < dto.items.length; idx++) {
      const item = dto.items[idx];
      if (!item.foodId && item.barcode) {
        const cached = await this.foodsService.getOrCacheBarcodeFood(item.barcode);
        if (cached) {
          resolvedFoods.set(idx, cached);
        }
      }
    }

    const mealId = await this.dataSource.transaction(async (manager) => {
      const meal = manager.create(MealEntity, {
        userId,
        performedOn,
        mealType: dto.mealType,
        notes: dto.notes?.trim() || null,
      });
      await manager.save(meal);

      for (let idx = 0; idx < dto.items.length; idx++) {
        const input = dto.items[idx];
        let food: FoodEntity | null = null;

        if (input.foodId) {
          food = await manager
            .createQueryBuilder(FoodEntity, "f")
            .where("f.id = :id AND (f.user_id IS NULL OR f.user_id = :userId)", {
              id: input.foodId,
              userId,
            })
            .getOne();
          if (!food) {
            throw new BadRequestException(`Food ${input.foodId} is not accessible`);
          }
        } else if (resolvedFoods.has(idx)) {
          food = resolvedFoods.get(idx)!;
        } else if (input.customFood) {
          food = manager.create(FoodEntity, {
            userId,
            name: input.customFood.name.trim(),
            brand: input.customFood.brand?.trim() || "Custom",
            barcode: null,
            kcalPer100g: String(input.customFood.kcalPer100g),
            proteinPer100g: String(input.customFood.proteinPer100g),
            carbsPer100g: String(input.customFood.carbsPer100g),
            fatPer100g: String(input.customFood.fatPer100g),
            saturatedFatPer100g: String(input.customFood.saturatedFatPer100g ?? 0),
            polyunsaturatedFatPer100g: String(input.customFood.polyunsaturatedFatPer100g ?? 0),
            fiberPer100g: String(input.customFood.fiberPer100g ?? 0),
            sodiumMgPer100g: String(input.customFood.sodiumMgPer100g ?? 0),
          });
          await manager.save(food);
        } else {
          throw new BadRequestException("Each meal item requires foodId, barcode, or customFood");
        }

        const mult = input.grams / 100;
        const totalKcal = Math.round(Number(food.kcalPer100g) * mult);
        const totalProteinG = Math.round(Number(food.proteinPer100g) * mult * 10) / 10;
        const totalCarbsG = Math.round(Number(food.carbsPer100g) * mult * 10) / 10;
        const totalFatG = Math.round(Number(food.fatPer100g) * mult * 10) / 10;

        const mealItem = manager.create(MealItemEntity, {
          mealId: meal.id,
          foodId: food.id,
          consumedWeightG: String(input.grams),
          totalKcal: String(totalKcal),
          totalProteinG: String(totalProteinG),
          totalCarbsG: String(totalCarbsG),
          totalFatG: String(totalFatG),
        });
        await manager.save(mealItem);
      }

      return meal.id;
    });

    const created = await this.mealsRepo.findOneOrFail({
      where: { id: mealId, userId },
      relations: { items: { food: true } },
    });
    return serializeMeal(created);
  }

  async deleteMeal(userId: string, id: string): Promise<{ deleted: true }> {
    if (!UUID_REGEX.test(id)) throw new NotFoundException("Meal not found");
    const result = await this.mealsRepo.delete({ id, userId });
    if (!result.affected) throw new NotFoundException("Meal not found");
    return { deleted: true };
  }

  async deleteMealItem(userId: string, itemId: string): Promise<{ deleted: true }> {
    if (!UUID_REGEX.test(itemId)) throw new NotFoundException("Meal item not found");
    const item = await this.mealItemsRepo.findOne({
      where: { id: itemId },
      relations: { meal: true },
    });
    if (!item || item.meal?.userId !== userId) {
      throw new NotFoundException("Meal item not found");
    }
    await this.mealItemsRepo.delete({ id: itemId });
    return { deleted: true };
  }

  async listTemplates(userId: string) {
    const rows = await this.templatesRepo.find({
      where: { userId },
      order: { createdAt: "DESC" },
    });
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      items: t.items,
      createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : String(t.createdAt),
    }));
  }

  async createTemplate(userId: string, dto: CreateMealTemplateDto) {
    const tpl = this.templatesRepo.create({
      userId,
      name: dto.name.trim(),
      items: dto.items,
    });
    const saved = await this.templatesRepo.save(tpl);
    return {
      id: saved.id,
      name: saved.name,
      items: saved.items,
      createdAt: saved.createdAt.toISOString(),
    };
  }

  async deleteTemplate(userId: string, id: string): Promise<{ deleted: true }> {
    if (!UUID_REGEX.test(id)) throw new NotFoundException("Meal template not found");
    const result = await this.templatesRepo.delete({ id, userId });
    if (!result.affected) throw new NotFoundException("Meal template not found");
    return { deleted: true };
  }

  async getTargets(userId: string) {
    const [stored, profile, weights] = await Promise.all([
      this.targetsRepo.findOne({ where: { userId } }),
      this.profilesRepo.findOne({ where: { id: userId } }),
      this.weightsRepo.find({ where: { userId }, order: { date: "ASC" } }),
    ]);

    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - 28);
    const cutoffYmd = cutoff.toISOString().slice(0, 10);

    const dailyCalorieRows: { date: string; kcal: string }[] = await this.dataSource.query(
      `SELECT m.performed_on::text AS date, COALESCE(SUM(mi.total_kcal), 0)::text AS kcal
       FROM public.meals m
       JOIN public.meal_items mi ON mi.meal_id = m.id
       WHERE m.user_id = $1 AND m.performed_on >= $2
       GROUP BY m.performed_on
       ORDER BY m.performed_on ASC`,
      [userId, cutoffYmd],
    );

    const recentWeights = weights
      .filter((w) => String(w.date).slice(0, 10) >= cutoffYmd)
      .map((w) => ({ date: String(w.date).slice(0, 10), weightKg: Number(w.weightKg) }));

    const recommendation = recommendEnergy({
      sex: profile?.sex ?? null,
      heightCm: profile?.heightCm ? Number(profile.heightCm) : null,
      birthDate: profile?.birthDate ?? null,
      activityLevel: profile?.activityLevel ?? null,
      goalKgPerWeek: Number(profile?.goalKgPerWeek ?? 0),
      weights: recentWeights,
      intake: dailyCalorieRows.map((r) => ({ date: r.date.slice(0, 10), kcal: Number(r.kcal) })),
      today: new Date().toISOString().slice(0, 10),
    });

    return {
      targets: stored
        ? {
            kcal: stored.kcal,
            protein: stored.protein,
            carbs: stored.carbs,
            fat: stored.fat,
            fiber: stored.fiber,
            updatedAt: stored.updatedAt?.toISOString() ?? null,
          }
        : { ...DEFAULT_TARGETS, updatedAt: null },
      recommendation,
    };
  }

  async upsertTargets(userId: string, dto: UpsertUserTargetsDto) {
    const now = new Date();
    await this.targetsRepo
      .createQueryBuilder()
      .insert()
      .into(UserTargetEntity)
      .values({
        userId,
        kcal: dto.kcal,
        protein: dto.protein,
        carbs: dto.carbs,
        fat: dto.fat,
        fiber: dto.fiber,
        updatedAt: now,
      })
      .orUpdate(["kcal", "protein", "carbs", "fat", "fiber", "updated_at"], ["user_id"])
      .execute();

    return {
      kcal: dto.kcal,
      protein: dto.protein,
      carbs: dto.carbs,
      fat: dto.fat,
      fiber: dto.fiber,
      updatedAt: now.toISOString(),
    };
  }
}
