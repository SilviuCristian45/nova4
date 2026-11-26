"use server";

import { revalidatePath } from "next/cache";
import { getLanguage } from "@/app/language";
import { getSessionUser, serverApi } from "@/lib/api/server";

export async function logPlanMealTodayAction(
  mealId: string,
): Promise<{ success?: boolean; error?: string }> {
  const { t } = await getLanguage();
  const user = await getSessionUser();
  if (!user) return { error: t("Neautorizat", "Not signed in") };

  try {
    await serverApi(`/meals/plan/meals/${encodeURIComponent(mealId)}/log`, { method: "POST" });
    revalidatePath("/meals");
    revalidatePath("/meals/history");
    revalidatePath("/meals/progress");
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : t("Eroare.", "Failed.") };
  }
}

export async function applyMealPlanTargetsAction(
  planId: string,
): Promise<{ success?: boolean; error?: string }> {
  const { t } = await getLanguage();
  const user = await getSessionUser();
  if (!user) return { error: t("Neautorizat", "Not signed in") };

  try {
    await serverApi(`/meals/plan/${encodeURIComponent(planId)}/apply-targets`, { method: "POST" });
    revalidatePath("/meals");
    revalidatePath("/meals/plan");
    revalidatePath("/meals/progress");
    revalidatePath("/meals/progress/targets");
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : t("Eroare.", "Failed.") };
  }
}
