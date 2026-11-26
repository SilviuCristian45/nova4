"use server";

import { revalidatePath } from "next/cache";
import { getLanguage } from "@/app/language";
import { localDate } from "@/lib/daily-metrics";
import { getSessionUser, serverApi } from "@/lib/api/server";

export async function getDailySteps(dateStr?: string) {
  const user = await getSessionUser();
  if (!user) return 0;

  const targetDate = dateStr || localDate();
  try {
    const rows = await serverApi<{ date: string; steps: number }[]>(
      `/metrics/steps?date=${encodeURIComponent(targetDate)}`,
    );
    return rows[0]?.steps || 0;
  } catch {
    return 0;
  }
}

export async function saveDailySteps(formData: FormData) {
  const { t } = await getLanguage();

  const user = await getSessionUser();
  if (!user) return { error: t("Neautorizat", "Not signed in") };

  const date = String(formData.get("date") ?? "");
  const steps = parseInt(String(formData.get("steps") ?? ""), 10);

  if (isNaN(steps) || steps < 0) {
    return { error: t("Număr de pași invalid", "Invalid step count") };
  }

  try {
    await serverApi("/metrics/steps", {
      method: "PUT",
      body: { date, steps },
    });
    revalidatePath("/");
    revalidatePath("/stats");
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : t("Eroare la salvare.", "Save failed.") };
  }
}
