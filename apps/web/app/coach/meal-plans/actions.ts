"use server";

import { revalidatePath } from "next/cache";
import { getLanguage } from "@/app/language";
import { requireCoach } from "@/lib/coach/auth";
import { serverApi } from "@/lib/api/server";
import { validateMealPlanPayload, type MealPlanPayloadInput } from "@/lib/coach/meal-plans";

export type SaveMealPlanResult = {
  error?: string;
  success?: boolean;
  planId?: string;
};

export async function saveMealPlanAction(
  input: MealPlanPayloadInput,
  options?: { notifyClient?: boolean },
): Promise<SaveMealPlanResult> {
  const { t } = await getLanguage();
  await requireCoach();
  const checked = validateMealPlanPayload(input, t);
  if (!checked.ok) return { error: checked.error };

  const data = checked.data;
  const payload = {
    assignedClientId: data.assignedClientId ?? null,
    title: data.title,
    description: data.description ?? "",
    goal: data.goal,
    status: data.status,
    targetKcal: data.targetKcal ?? null,
    targetProteinG: data.targetProteinG ?? null,
    targetCarbsG: data.targetCarbsG ?? null,
    targetFatG: data.targetFatG ?? null,
    targetFiberG: data.targetFiberG ?? null,
    waterLiters: data.waterLiters ?? null,
    notes: data.notes ?? "",
    notifyClient: Boolean(options?.notifyClient),
    days: data.days.map((d) => ({
      ...(d.id ? { id: d.id } : {}),
      title: d.title,
      notes: d.notes ?? "",
      meals: d.meals.map((m) => ({
        ...(m.id ? { id: m.id } : {}),
        mealType: m.mealType,
        title: m.title,
        timeLabel: m.timeLabel ?? "",
        notes: m.notes ?? "",
        items: m.items.map((i) => ({
          ...(i.id ? { id: i.id } : {}),
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
  };

  try {
    const saved = data.id
      ? await serverApi<{ id: string }>(`/coach/meal-plans/${encodeURIComponent(data.id)}`, {
          method: "PUT",
          body: payload,
        })
      : await serverApi<{ id: string }>("/coach/meal-plans", {
          method: "POST",
          body: payload,
        });

    revalidatePath("/coach");
    revalidatePath("/coach/meal-plans");
    revalidatePath(`/coach/meal-plans/${saved.id}`);
    if (data.assignedClientId) {
      revalidatePath(`/coach/clients/${data.assignedClientId}`);
    }
    revalidatePath("/meals");
    revalidatePath("/meals/plan");
    revalidatePath("/");

    return { success: true, planId: saved.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : t("Eroare la salvare.", "Save failed.") };
  }
}

export async function deleteMealPlanAction(
  planId: string,
): Promise<{ error?: string; success?: boolean }> {
  await requireCoach();
  try {
    await serverApi(`/coach/meal-plans/${encodeURIComponent(planId)}`, { method: "DELETE" });
    revalidatePath("/coach");
    revalidatePath("/coach/meal-plans");
    revalidatePath("/meals");
    revalidatePath("/meals/plan");
    revalidatePath("/");
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Delete failed" };
  }
}

export async function cloneMealPlanForClientAction(
  planId: string,
  clientId: string,
): Promise<{ error?: string; success?: boolean; planId?: string }> {
  await requireCoach();
  try {
    const res = await serverApi<{ id?: string; planId?: string }>(
      `/coach/meal-plans/${encodeURIComponent(planId)}/clone`,
      {
        method: "POST",
        body: { clientId },
      },
    );
    const newPlanId = res.id ?? res.planId;
    revalidatePath("/coach");
    revalidatePath("/coach/meal-plans");
    revalidatePath(`/coach/clients/${clientId}`);
    revalidatePath("/meals");
    revalidatePath("/meals/plan");
    revalidatePath("/");
    return { success: true, planId: newPlanId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Clone failed" };
  }
}

export async function toggleMealPlanShareLinkAction(
  planId: string,
  enable: boolean,
): Promise<{ error?: string; shareToken?: string | null }> {
  await requireCoach();
  try {
    const res = await serverApi<{ shareToken: string | null }>(
      `/coach/meal-plans/${encodeURIComponent(planId)}/share-link`,
      {
        method: "POST",
        body: { enable },
      },
    );
    revalidatePath("/coach/meal-plans");
    revalidatePath(`/coach/meal-plans/${planId}`);
    return { shareToken: res.shareToken ?? null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed" };
  }
}
