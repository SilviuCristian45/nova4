"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser, serverApi } from "@/lib/api/server";
import { ApiError } from "@/lib/api/types";
import { isMeasurementDate } from "@/lib/daily-metrics";
import { emptyCheckin, parseCheckin, type CheckinValues } from "@/lib/checkin";

type CheckinError = "unauthorized" | "invalid-date" | "invalid-checkin" | "storage" | "setup";
type CheckinResult =
  | { success: true; checkin: CheckinValues | null }
  | { success: false; error: CheckinError };

function handleError(err: unknown): CheckinResult {
  if (err instanceof ApiError && err.status === 401) {
    return { success: false, error: "unauthorized" };
  }
  console.error("Daily check-in storage failed:", err);
  return { success: false, error: "storage" };
}

export async function getDailyCheckin(date: string): Promise<CheckinResult> {
  if (!isMeasurementDate(date)) return { success: false, error: "invalid-date" };
  const user = await getSessionUser();
  if (!user) return { success: false, error: "unauthorized" };
  try {
    const rows = await serverApi<({ date: string } & CheckinValues)[]>(
      `/metrics/checkin?date=${encodeURIComponent(date)}`,
    );
    const data = rows[0];
    return { success: true, checkin: data ? { ...emptyCheckin(), ...data, note: data.note ?? "" } : null };
  } catch (err) {
    return handleError(err);
  }
}

export async function saveDailyCheckin(formData: FormData): Promise<CheckinResult> {
  const date = formData.get("date");
  if (!isMeasurementDate(date)) return { success: false, error: "invalid-date" };
  const values = parseCheckin({
    energy: formData.get("energy"),
    satiety: formData.get("satiety"),
    sleep: formData.get("sleep"),
    note: formData.get("note"),
  });
  if (!values) return { success: false, error: "invalid-checkin" };
  const user = await getSessionUser();
  if (!user) return { success: false, error: "unauthorized" };
  try {
    await serverApi("/metrics/checkin", {
      method: "PUT",
      body: {
        date,
        energy: values.energy,
        satiety: values.satiety,
        sleep: values.sleep,
        note: values.note || null,
      },
    });
    revalidatePath("/");
    revalidatePath("/stats");
    return { success: true, checkin: values };
  } catch (err) {
    return handleError(err);
  }
}
