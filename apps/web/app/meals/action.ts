"use server";

import { revalidatePath } from "next/cache";
import { getLanguage } from "@/app/language";
import { getSessionUser, serverApi } from "@/lib/api/server";

interface DraftFoodItem {
  food: {
    id?: string;
    barcode?: string | null;
    name: string;
    brand?: string | null;
    kcal_per_100g?: number;
    protein_per_100g?: number;
    carbs_per_100g?: number;
    fat_per_100g?: number;
    fiber_per_100g?: number;
    kcalPer100g?: number;
    proteinPer100g?: number;
    carbsPer100g?: number;
    fatPer100g?: number;
    fiberPer100g?: number;
  };
  grams: number;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveCompleteMeal(mealType: string, items: DraftFoodItem[]) {
  const { t } = await getLanguage();

  const user = await getSessionUser();
  if (!user) return { error: t("Neautorizat", "Not signed in") };

  if (!items || items.length === 0) return { error: t("Masa este goală.", "The meal is empty.") };

  try {
    const today = new Date().toISOString().split("T")[0];
    const mappedItems = items.map((item) => {
      const f = item.food;
      const grams = Number(item.grams);
      if (f.id && UUID_REGEX.test(f.id)) {
        return { foodId: f.id, grams };
      }
      if (f.barcode && /^\d{4,20}$/.test(String(f.barcode))) {
        return {
          barcode: String(f.barcode),
          customFood: {
            name: f.name,
            brand: f.brand || "Creat Manual",
            kcalPer100g: Number(f.kcal_per_100g ?? f.kcalPer100g ?? 0),
            proteinPer100g: Number(f.protein_per_100g ?? f.proteinPer100g ?? 0),
            carbsPer100g: Number(f.carbs_per_100g ?? f.carbsPer100g ?? 0),
            fatPer100g: Number(f.fat_per_100g ?? f.fatPer100g ?? 0),
            fiberPer100g: Number(f.fiber_per_100g ?? f.fiberPer100g ?? 0),
          },
          grams,
        };
      }
      return {
        customFood: {
          name: f.name,
          brand: f.brand || "Creat Manual",
          kcalPer100g: Number(f.kcal_per_100g ?? f.kcalPer100g ?? 0),
          proteinPer100g: Number(f.protein_per_100g ?? f.proteinPer100g ?? 0),
          carbsPer100g: Number(f.carbs_per_100g ?? f.carbsPer100g ?? 0),
          fatPer100g: Number(f.fat_per_100g ?? f.fatPer100g ?? 0),
          fiberPer100g: Number(f.fiber_per_100g ?? f.fiberPer100g ?? 0),
        },
        grams,
      };
    });

    await serverApi("/meals", {
      method: "POST",
      body: {
        mealType,
        performedOn: today,
        items: mappedItems,
      },
    });

    revalidatePath("/meals");
    revalidatePath("/meals/history");
    return { success: true };
  } catch (err) {
    console.error("Eroare la salvarea mesei:", err);
    return {
      error: err instanceof Error ? err.message : t("A apărut o eroare la salvare.", "An error occurred while saving."),
    };
  }
}

export async function saveMealTemplate(name: string, items: unknown[]) {
  const { t } = await getLanguage();

  const user = await getSessionUser();
  if (!user) return { error: t("Neautorizat", "Not signed in") };

  try {
    await serverApi("/meals/templates", {
      method: "POST",
      body: { name, items },
    });
    revalidatePath("/meals/insert");
    return { success: true };
  } catch (err) {
    console.error("Eroare la salvarea șablonului:", err);
    return { error: t("Nu am putut salva șablonul.", "Could not save the template.") };
  }
}

export async function getUserTemplates() {
  const user = await getSessionUser();
  if (!user) return [];

  try {
    return await serverApi<{ id: string; name: string; items: unknown[]; createdAt: string }[]>("/meals/templates");
  } catch (err) {
    console.error("Eroare la preluarea șabloanelor:", err);
    return [];
  }
}

export async function getUserTargets() {
  const { t } = await getLanguage();

  const user = await getSessionUser();
  if (!user) return { error: t("Neautorizat", "Not signed in") };

  try {
    const res = await serverApi<{
      targets: { kcal: number; protein: number; carbs: number; fat: number; fiber: number };
    }>("/meals/targets");
    return {
      targets: res.targets || { kcal: 2200, protein: 160, carbs: 250, fat: 70, fiber: 30 },
    };
  } catch (err) {
    console.error(err);
    return { error: t("Eroare la citire targeturi.", "Could not load goals.") };
  }
}

export async function saveUserTargets(targets: {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}) {
  const { t } = await getLanguage();

  const user = await getSessionUser();
  if (!user) return { error: t("Neautorizat", "Not signed in") };

  try {
    await serverApi("/meals/targets", {
      method: "PUT",
      body: {
        kcal: Math.round(Number(targets.kcal)),
        protein: Math.round(Number(targets.protein)),
        carbs: Math.round(Number(targets.carbs)),
        fat: Math.round(Number(targets.fat)),
        fiber: Math.round(Number(targets.fiber)),
      },
    });
    return { success: true };
  } catch (err) {
    console.error(err);
    return { error: t("Nu s-au putut salva targeturile.", "Could not save goals.") };
  }
}
