"use server";

import { revalidatePath } from "next/cache";
import { getLanguage } from "@/app/language";
import { getSessionUser, serverApi } from "@/lib/api/server";

export async function deleteWorkout(workoutId: string) {
  const { t } = await getLanguage();

  const user = await getSessionUser();
  if (!user) return { error: t("Nu ești autentificat.", "You are not signed in.") };

  try {
    await serverApi(`/workouts/${encodeURIComponent(workoutId)}`, {
      method: "DELETE",
    });
    revalidatePath("/", "layout");
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : t("Eroare necunoscută.", "Unknown error.");
    return { error: t("Eroare la ștergere: ", "Could not delete: ") + message };
  }
}
