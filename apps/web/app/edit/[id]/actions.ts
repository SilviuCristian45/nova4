"use server";

import { revalidatePath } from "next/cache";
import { getLanguage } from "@/app/language";
import { getSessionUser, serverApi } from "@/lib/api/server";

type EditSetInput = {
  id?: string;
  split: string;
  exercise: string;
  setNumber?: number;
  reps: number;
  weight: number;
  rir?: number | null;
  setType?: string;
  set_type?: string;
  notes?: string | null;
};

type EditCardioInput = {
  activity: string;
  durationMin: number;
};

export async function updateWorkout(
  workoutId: string,
  mode: "strength" | "cardio",
  split: string,
  performedOn: string,
  sets: EditSetInput[],
  cardioEntries: EditCardioInput[],
) {
  const { t } = await getLanguage();

  const user = await getSessionUser();
  if (!user) return { error: t("Nu ești autentificat.", "You are not signed in.") };

  try {
    await serverApi(`/workouts/${encodeURIComponent(workoutId)}`, {
      method: "PATCH",
      body: {
        mode,
        split: mode === "strength" ? split : "CARDIO",
        date: performedOn,
        sets:
          mode === "strength"
            ? sets.map((s, index) => ({
                ...(s.id ? { id: s.id } : {}),
                split: s.split || split,
                exercise: s.exercise,
                setNumber: index + 1,
                reps: Number(s.reps),
                weight: Number(s.weight),
                rir: s.rir ?? null,
                setType: s.setType || s.set_type || "Working Set",
                notes: s.notes?.trim() ? s.notes.trim() : null,
              }))
            : [],
        cardio:
          mode === "cardio"
            ? cardioEntries.map((c) => ({
                activity: c.activity,
                durationMin: Number(c.durationMin),
              }))
            : [],
      },
    });

    revalidatePath("/", "layout");
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : t("Eroare necunoscută.", "Unknown error.");
    return { error: t("Eroare la actualizare: ", "Could not update: ") + message };
  }
}
