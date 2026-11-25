import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { FoodEntity } from "../../database/entities";
import type { CreateCustomFoodDto } from "./dto/food.dto";

export interface SerializedFood {
  id: string;
  userId: string | null;
  name: string;
  brand: string | null;
  barcode: string | null;
  kcalPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  saturatedFatPer100g: number;
  polyunsaturatedFatPer100g: number;
  fiberPer100g: number;
  sodiumMgPer100g: number;
  source?: "local_db" | "open_food_facts" | "usda";
  imageUrl?: string | null;
}

export function serializeFood(food: FoodEntity, source?: "local_db" | "open_food_facts" | "usda"): SerializedFood {
  return {
    id: food.id,
    userId: food.userId ?? null,
    name: food.name,
    brand: food.brand ?? null,
    barcode: food.barcode ?? null,
    kcalPer100g: Number(food.kcalPer100g ?? 0),
    proteinPer100g: Number(food.proteinPer100g ?? 0),
    carbsPer100g: Number(food.carbsPer100g ?? 0),
    fatPer100g: Number(food.fatPer100g ?? 0),
    saturatedFatPer100g: Number(food.saturatedFatPer100g ?? 0),
    polyunsaturatedFatPer100g: Number(food.polyunsaturatedFatPer100g ?? 0),
    fiberPer100g: Number(food.fiberPer100g ?? 0),
    sodiumMgPer100g: Number(food.sodiumMgPer100g ?? 0),
    ...(source ? { source } : {}),
  };
}

interface ExternalFoodCandidate {
  source: "open_food_facts" | "usda";
  barcode: string;
  name: string;
  brand: string;
  kcalPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  fiberPer100g: number;
  imageUrl: string | null;
}

const BARCODE_REGEX = /^\d{4,20}$/;

function safeNum(val: unknown): number {
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

@Injectable()
export class FoodsService {
  private readonly logger = new Logger(FoodsService.name);

  constructor(
    @InjectRepository(FoodEntity)
    private readonly foodsRepo: Repository<FoodEntity>,
    private readonly configService: ConfigService,
  ) {}

  async listUserFoods(userId: string): Promise<SerializedFood[]> {
    const rows = await this.foodsRepo.find({
      where: { userId },
      order: { createdAt: "DESC" },
      take: 200,
    });
    return rows.map((f) => serializeFood(f, "local_db"));
  }

  async createCustomFood(userId: string, dto: CreateCustomFoodDto): Promise<SerializedFood> {
    // Manual custom foods are strictly private to the user and never write to the shared barcode catalog.
    const food = this.foodsRepo.create({
      userId,
      name: dto.name.trim(),
      brand: dto.brand?.trim() || "Custom",
      barcode: null,
      kcalPer100g: String(dto.kcalPer100g),
      proteinPer100g: String(dto.proteinPer100g),
      carbsPer100g: String(dto.carbsPer100g),
      fatPer100g: String(dto.fatPer100g),
      saturatedFatPer100g: String(dto.saturatedFatPer100g ?? 0),
      polyunsaturatedFatPer100g: String(dto.polyunsaturatedFatPer100g ?? 0),
      fiberPer100g: String(dto.fiberPer100g ?? 0),
      sodiumMgPer100g: String(dto.sodiumMgPer100g ?? 0),
    });
    const saved = await this.foodsRepo.save(food);
    return serializeFood(saved, "local_db");
  }

  async getByBarcode(barcode: string): Promise<SerializedFood> {
    const food = await this.getOrCacheBarcodeFood(barcode);
    if (!food) {
      throw new NotFoundException("Food not found for barcode");
    }
    return serializeFood(food, "local_db");
  }

  // Shared barcode catalog (user_id = null): always sourced server-side from Open Food Facts, never from client input.
  async getOrCacheBarcodeFood(rawBarcode: string): Promise<FoodEntity | null> {
    const barcode = rawBarcode.trim();
    if (!BARCODE_REGEX.test(barcode)) return null;

    const cached = await this.foodsRepo.findOne({ where: { barcode } });
    if (cached) return cached;

    try {
      const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`, {
        headers: { "User-Agent": "RepLogApp/1.0 - Web/API", Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return null;

      const data = (await response.json()) as {
        status?: number;
        product?: {
          product_name_ro?: string;
          product_name?: string;
          brands?: string;
          nutriments?: Record<string, unknown>;
        };
      };
      if (data.status !== 1 || !data.product) return null;

      const p = data.product;
      const nutriments = p.nutriments ?? {};
      const sodiumMg = safeNum(nutriments["sodium_100g"]) * 1000;

      await this.foodsRepo
        .createQueryBuilder()
        .insert()
        .into(FoodEntity)
        .values({
          userId: null,
          name: (p.product_name_ro || p.product_name || "Unknown Product").trim(),
          brand: p.brands?.trim() || null,
          barcode,
          kcalPer100g: String(safeNum(nutriments["energy-kcal_100g"])),
          proteinPer100g: String(safeNum(nutriments["proteins_100g"])),
          carbsPer100g: String(safeNum(nutriments["carbohydrates_100g"])),
          fatPer100g: String(safeNum(nutriments["fat_100g"])),
          saturatedFatPer100g: String(safeNum(nutriments["saturated-fat_100g"])),
          fiberPer100g: String(safeNum(nutriments["fiber_100g"])),
          sodiumMgPer100g: String(sodiumMg),
        })
        .orIgnore()
        .execute();

      return this.foodsRepo.findOne({ where: { barcode } });
    } catch (err) {
      this.logger.warn(`Open Food Facts barcode lookup failed for ${barcode}: ${String(err)}`);
      return null;
    }
  }

  async search(userId: string, rawQuery: string, includeExternal = true): Promise<{ results: SerializedFood[] }> {
    const query = rawQuery.trim();
    if (query.length < 2) {
      throw new BadRequestException("Search query must be at least 2 characters");
    }

    const localFoods = await this.foodsRepo
      .createQueryBuilder("f")
      .where("(f.user_id IS NULL OR f.user_id = :userId)", { userId })
      .andWhere("(f.name ILIKE :pattern OR f.brand ILIKE :pattern)", { pattern: `%${query}%` })
      .orderBy("CASE WHEN f.user_id = :userId THEN 0 ELSE 1 END", "ASC")
      .addOrderBy("f.created_at", "DESC")
      .limit(15)
      .getMany();

    const localResults: SerializedFood[] = localFoods.map((f) => serializeFood(f, "local_db"));
    if (!includeExternal) {
      return { results: localResults };
    }

    const externalCandidates = await this.fetchExternalFoods(query);
    if (externalCandidates.length > 0) {
      const existingBarcodes = new Set(localFoods.map((f) => f.barcode).filter(Boolean));
      const newExternal = externalCandidates.filter((c) => c.barcode && !existingBarcodes.has(c.barcode));

      if (newExternal.length > 0) {
        await this.foodsRepo
          .createQueryBuilder()
          .insert()
          .into(FoodEntity)
          .values(
            newExternal.map((item) => ({
              userId: null,
              name: item.name,
              brand: item.brand || null,
              barcode: item.barcode,
              kcalPer100g: String(item.kcalPer100g),
              proteinPer100g: String(item.proteinPer100g),
              carbsPer100g: String(item.carbsPer100g),
              fatPer100g: String(item.fatPer100g),
              fiberPer100g: String(item.fiberPer100g),
            })),
          )
          .orIgnore()
          .execute();
      }
    }

    const barcodes = externalCandidates.map((c) => c.barcode).filter(Boolean);
    const cachedExternal =
      barcodes.length > 0
        ? await this.foodsRepo
            .createQueryBuilder("f")
            .where("f.barcode IN (:...barcodes)", { barcodes })
            .getMany()
        : [];
    const byBarcode = new Map(cachedExternal.map((f) => [f.barcode, f]));

    const mergedByKey = new Map<string, SerializedFood>();
    for (const item of localResults) {
      mergedByKey.set(item.barcode ?? item.id, item);
    }
    for (const candidate of externalCandidates) {
      if (mergedByKey.has(candidate.barcode)) continue;
      const persisted = byBarcode.get(candidate.barcode);
      if (persisted) {
        mergedByKey.set(candidate.barcode, {
          ...serializeFood(persisted, candidate.source),
          imageUrl: candidate.imageUrl,
        });
      }
    }

    return { results: [...mergedByKey.values()] };
  }

  private async fetchExternalFoods(query: string): Promise<ExternalFoodCandidate[]> {
    const offResults = await this.searchOpenFoodFacts(query);
    if (offResults.length > 0) return offResults;
    return this.searchUsda(query);
  }

  private async searchOpenFoodFacts(query: string): Promise<ExternalFoodCandidate[]> {
    try {
      const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=15`;
      const res = await fetch(url, {
        headers: { "User-Agent": "RepLogApp/1.0 - Web/API", Accept: "application/json" },
        signal: AbortSignal.timeout(6000),
      });
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok || !contentType.includes("application/json")) return [];

      const data = (await res.json()) as {
        products?: Array<{
          code?: string;
          product_name_ro?: string;
          product_name?: string;
          brands?: string;
          image_front_small_url?: string;
          nutriments?: Record<string, unknown>;
        }>;
      };

      return (data.products ?? [])
        .map((p): ExternalFoodCandidate | null => {
          const name = (p.product_name_ro || p.product_name || "").trim();
          const barcode = String(p.code ?? "").trim();
          if (!name || !barcode) return null;
          const n = p.nutriments ?? {};
          return {
            source: "open_food_facts",
            barcode,
            name,
            brand: p.brands?.trim() || "Fără Brand",
            kcalPer100g: safeNum(n["energy-kcal_100g"]),
            proteinPer100g: safeNum(n["proteins_100g"]),
            carbsPer100g: safeNum(n["carbohydrates_100g"]),
            fatPer100g: safeNum(n["fat_100g"]),
            fiberPer100g: safeNum(n["fiber_100g"]),
            imageUrl: p.image_front_small_url ?? null,
          };
        })
        .filter((x): x is ExternalFoodCandidate => x !== null);
    } catch {
      return [];
    }
  }

  private async searchUsda(query: string): Promise<ExternalFoodCandidate[]> {
    const apiKey = this.configService.get<string>("USDA_API_KEY")?.trim();
    if (!apiKey) return [];

    try {
      const params = new URLSearchParams({ api_key: apiKey, query, pageSize: "15" });
      const res = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?${params.toString()}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return [];

      const data = (await res.json()) as {
        foods?: Array<{
          fdcId?: number;
          description?: string;
          brandOwner?: string;
          foodNutrients?: Array<{ nutrientName?: string; value?: number }>;
        }>;
      };

      return (data.foods ?? [])
        .filter((f) => f.fdcId && f.description)
        .map((food) => {
          const nutrients = food.foodNutrients ?? [];
          const getNutrient = (target: string) => {
            const match = nutrients.find((n) => n.nutrientName?.toLowerCase() === target.toLowerCase());
            return safeNum(match?.value);
          };
          return {
            source: "usda" as const,
            barcode: `USDA-${food.fdcId}`,
            name: food.description!.trim(),
            brand: food.brandOwner?.trim() || "USDA",
            kcalPer100g: getNutrient("Energy"),
            proteinPer100g: getNutrient("Protein"),
            carbsPer100g: getNutrient("Carbohydrate, by difference"),
            fatPer100g: getNutrient("Total lipid (fat)"),
            fiberPer100g: getNutrient("Fiber, total dietary"),
            imageUrl: null,
          };
        });
    } catch {
      return [];
    }
  }
}
