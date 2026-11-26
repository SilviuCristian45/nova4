"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser, serverApi } from "@/lib/api/server";
import { ApiError } from "@/lib/api/types";
import { isMeasurementDate, parseBodyWeight } from "@/lib/daily-metrics";

type WeightError = "unauthorized" | "invalid-date" | "invalid-weight" | "storage" | "setup";
type WeightResult =
  | { success: true; weight: number | null }
  | { success: false; error: WeightError };

function handleError(err: unknown): WeightResult {
  if (err instanceof ApiError && err.status === 401) {
    return { success: false, error: "unauthorized" };
  }
  console.error("Daily weight storage failed:", err);
  return { success: false, error: "storage" };
}

export async function getDailyWeight(date: string): Promise<WeightResult> {
  if (!isMeasurementDate(date)) return { success: false, error: "invalid-date" };
  const user = await getSessionUser();
  if (!user) return { success: false, error: "unauthorized" };
  try {
    const rows = await serverApi<{ date: string; weightKg: number }[]>(
      `/metrics/weight?date=${encodeURIComponent(date)}`,
    );
    return { success: true, weight: rows[0] ? Number(rows[0].weightKg) : null };
  } catch (err) {
    return handleError(err);
  }
}

export async function saveDailyWeight(formData: FormData): Promise<WeightResult> {
  const date = formData.get("date");
  const weight = parseBodyWeight(formData.get("weight"));
  if (!isMeasurementDate(date)) return { success: false, error: "invalid-date" };
  if (weight === null) return { success: false, error: "invalid-weight" };
  const user = await getSessionUser();
  if (!user) return { success: false, error: "unauthorized" };
  try {
    await serverApi("/metrics/weight", {
      method: "PUT",
      body: { date, weightKg: weight },
    });
    revalidatePath("/");
    revalidatePath("/stats");
    return { success: true, weight };
  } catch (err) {
    return handleError(err);
  }
}
