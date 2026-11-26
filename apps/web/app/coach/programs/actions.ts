"use server";

import { revalidatePath } from "next/cache";
import { getLanguage } from "@/app/language";
import { requireCoach } from "@/lib/coach/auth";
import { serverApi } from "@/lib/api/server";
import { validateProgramPayload, type ProgramPayloadInput } from "@/lib/coach/programs";

export type SaveProgramResult = {
  error?: string;
  success?: boolean;
  programId?: string;
  inviteCode?: string | null;
};

export async function saveProgramAction(input: ProgramPayloadInput): Promise<SaveProgramResult> {
  const { t } = await getLanguage();
  await requireCoach();
  const checked = validateProgramPayload(input, t);
  if (!checked.ok) return { error: checked.error };

  const data = checked.data;
  const payload = {
    title: data.title,
    description: data.description ?? "",
    difficulty: data.difficulty,
    durationWeeks: data.durationWeeks,
    goal: data.goal,
    status: data.status,
    accessType: data.accessType,
    requiresApproval: data.requiresApproval,
    inviteCode: data.inviteCode ?? null,
    workouts: data.workouts.map((w) => ({
      ...(w.id ? { id: w.id } : {}),
      weekNumber: w.weekNumber,
      dayNumber: w.dayNumber,
      title: w.title,
      workoutMode: w.workoutMode,
      split: w.split,
      notes: w.notes ?? "",
      exercises: w.exercises.map((ex) => ({
        ...(ex.id ? { id: ex.id } : {}),
        exercise: ex.exercise,
        setType: ex.setType,
        targetSets: ex.targetSets,
        targetRepsMin: ex.targetRepsMin,
        targetRepsMax: ex.targetRepsMax,
        targetRir: ex.targetRir ?? null,
        targetWeightKg: ex.targetWeightKg ?? null,
        restSeconds: ex.restSeconds ?? null,
        notes: ex.notes ?? "",
      })),
      cardio: w.cardio.map((c) => ({
        ...(c.id ? { id: c.id } : {}),
        activity: c.activity,
        targetDurationMin: c.targetDurationMin,
        notes: c.notes ?? "",
      })),
    })),
  };

  try {
    const saved = data.id
      ? await serverApi<{ id: string; inviteCode: string | null }>(`/coach/programs/${encodeURIComponent(data.id)}`, {
          method: "PUT",
          body: payload,
        })
      : await serverApi<{ id: string; inviteCode: string | null }>("/coach/programs", {
          method: "POST",
          body: payload,
        });

    revalidatePath("/coach");
    revalidatePath("/coach/programs");
    revalidatePath(`/coach/programs/${saved.id}`);
    revalidatePath("/explore");
    revalidatePath("/");

    return { success: true, programId: saved.id, inviteCode: saved.inviteCode };
  } catch (err) {
    const msg = err instanceof Error ? err.message : t("Eroare la salvare.", "Save failed.");
    if (/invite code/i.test(msg)) {
      return {
        error: t(
          "Codul de invitație este deja folosit. Generează alt cod.",
          "Invite code is already in use. Generate another code.",
        ),
      };
    }
    return { error: msg };
  }
}

export async function regenerateInviteCodeAction(programId: string): Promise<{ error?: string; inviteCode?: string }> {
  const { t } = await getLanguage();
  await requireCoach();

  try {
    const res = await serverApi<{ inviteCode: string }>(
      `/coach/programs/${encodeURIComponent(programId)}/invite-code`,
      { method: "POST" },
    );
    revalidatePath("/coach/programs");
    revalidatePath(`/coach/programs/${programId}`);
    return { inviteCode: res.inviteCode };
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? err.message
          : t("Nu s-a putut genera un cod unic. Încearcă din nou.", "Could not generate a unique code. Please try again."),
    };
  }
}

export async function deleteProgramAction(programId: string): Promise<{ error?: string; success?: boolean }> {
  await requireCoach();
  try {
    await serverApi(`/coach/programs/${encodeURIComponent(programId)}`, { method: "DELETE" });
    revalidatePath("/coach");
    revalidatePath("/coach/programs");
    revalidatePath("/explore");
    revalidatePath("/");
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Delete failed" };
  }
}
