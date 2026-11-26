"use server";

import { revalidatePath } from "next/cache";
import { getLanguage } from "@/app/language";
import { getSessionUser, serverApi } from "@/lib/api/server";
import { isValidWorkoutDate, workoutSplit, type SaveCardio, type SaveProgramLink, type SaveSet } from "@/lib/workout-save";

export async function saveWorkout(
  mode: "strength" | "cardio",
  split: string,
  date: string,
  sets: SaveSet[],
  cardioEntries: SaveCardio[],
  programLink?: SaveProgramLink,
) {
  const { t } = await getLanguage();

  if (!isValidWorkoutDate(date, new Date().toISOString().slice(0, 10))) {
    return { error: t("Data antrenamentului nu este validă.", "The workout date is not valid.") };
  }

  const user = await getSessionUser();
  if (!user) return { error: t("Nu ești autentificat.", "You are not signed in.") };

  try {
    await serverApi("/workouts", {
      method: "POST",
      body: {
        mode,
        split: mode === "strength" ? workoutSplit(sets, split) : "CARDIO",
        date,
        sets:
          mode === "strength"
            ? sets.map((s, index) => ({
                split: s.split,
                exercise: s.exercise,
                setNumber: s.setNumber ?? index + 1,
                reps: Number(s.reps),
                weight: Number(s.weight),
                rir: s.rir ?? null,
                setType: s.setType,
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
        programWorkoutId: programLink?.programWorkoutId ?? null,
        enrollmentId: programLink?.enrollmentId ?? null,
      },
    });

    revalidatePath("/", "layout");
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : t("Eroare necunoscută.", "Unknown error.");
    return { error: t("Eroare la salvarea antrenamentului: ", "Could not save the workout: ") + message };
  }
}
