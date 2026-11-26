"use server";

import { getLanguage } from "@/app/language";
import { getSessionUser, serverApi } from "@/lib/api/server";
import { ACTIVITY_LEVELS, WINDOW_DAYS, type ActivityLevel, type EnergyInput } from "@/lib/energy";
import { isMeasurementDate } from "@/lib/daily-metrics";

interface ApiMeal {
  performedOn: string;
  items: { totalKcal: number }[];
}

export async function getEnergyData(today: string): Promise<{ error?: string; input?: Omit<EnergyInput, "today"> }> {
  const { t } = await getLanguage();
  if (!isMeasurementDate(today, "9999-12-31")) return { error: t("Dată invalidă.", "Invalid date.") };

  const user = await getSessionUser();
  if (!user) return { error: t("Neautorizat", "Not signed in") };

  const start = new Date(Date.parse(`${today}T00:00:00Z`) - (WINDOW_DAYS - 1) * 86400000).toISOString().slice(0, 10);

  try {
    const q = new URLSearchParams({ from: start, to: today }).toString();
    const [weights, meals] = await Promise.all([
      serverApi<{ date: string; weightKg: number }[]>(`/metrics/weight?${q}`),
      serverApi<ApiMeal[]>(`/meals?${q}`),
    ]);

    const kcalByDay = new Map<string, number>();
    for (const meal of meals) {
      let sum = 0;
      for (const item of meal.items ?? []) sum += Number(item.totalKcal) || 0;
      kcalByDay.set(meal.performedOn, (kcalByDay.get(meal.performedOn) ?? 0) + sum);
    }

    const p = user.profile;
    return {
      input: {
        sex: p?.sex === "male" || p?.sex === "female" ? p.sex : null,
        heightCm: p?.heightCm ? Number(p.heightCm) : null,
        birthDate: p?.birthDate ?? null,
        activityLevel: p?.activityLevel && p.activityLevel in ACTIVITY_LEVELS ? (p.activityLevel as ActivityLevel) : null,
        goalKgPerWeek: Number(p?.goalKgPerWeek ?? 0),
        weights: weights.map((w) => ({ date: w.date, weightKg: Number(w.weightKg) })),
        intake: [...kcalByDay].map(([date, kcal]) => ({ date, kcal })).sort((a, b) => a.date.localeCompare(b.date)),
      },
    };
  } catch (err) {
    console.error(err);
    return { error: t("Nu am putut încărca datele.", "Could not load your data.") };
  }
}

export async function saveEnergyGoal(activityLevel: string, goalKgPerWeek: number) {
  const { t } = await getLanguage();

  const user = await getSessionUser();
  if (!user) return { error: t("Neautorizat", "Not signed in") };

  if (!(activityLevel in ACTIVITY_LEVELS)) return { error: t("Nivel de activitate invalid.", "Invalid activity level.") };
  if (!Number.isFinite(goalKgPerWeek) || goalKgPerWeek < -1 || goalKgPerWeek > 1) {
    return { error: t("Ritm invalid.", "Invalid rate.") };
  }

  try {
    await serverApi("/profile", {
      method: "PATCH",
      body: {
        activityLevel,
        goalKgPerWeek: Math.round(goalKgPerWeek * 100) / 100,
      },
    });
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : t("Eroare la salvare.", "Save failed.") };
  }
}
