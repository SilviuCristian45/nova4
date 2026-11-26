"use server";

import { revalidatePath } from "next/cache";
import { getLanguage } from "@/app/language";
import { getSessionUser, serverApi } from "@/lib/api/server";

export async function getDailyGoal() {
  const user = await getSessionUser();
  return user?.profile?.dailyStepsGoal || 10000;
}

export async function updateDailyGoal(formData: FormData) {
  const { t } = await getLanguage();

  const user = await getSessionUser();
  if (!user) return { error: t("Neautorizat", "Not signed in") };

  const goalStr = String(formData.get("dailyGoal") ?? "");
  const goal = parseInt(goalStr, 10);

  if (isNaN(goal) || goal <= 0) {
    return { error: t("Targetul trebuie să fie un număr pozitiv", "The goal must be a positive number") };
  }

  try {
    await serverApi("/profile", {
      method: "PATCH",
      body: { dailyStepsGoal: goal },
    });
    revalidatePath("/");
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : t("Eroare la salvare.", "Failed to save.") };
  }
}
