"use server";

import { revalidatePath } from "next/cache";
import { getLanguage } from "@/app/language";
import { getSessionUser, serverApi } from "@/lib/api/server";
import { requireCoach } from "@/lib/coach/auth";
import { mondayOfWeek, validateWeeklyCheckinInput } from "@/lib/coach/interactions";
import { localDate } from "@/lib/daily-metrics";

export async function submitWeeklyCheckinAction(input: {
  coachId: string;
  enrollmentId: string | null;
  weekStart?: string;
  weightKg: number | null;
  energy: number;
  sleep: number;
  stress: number;
  clientNotes: string;
  photoFrontPath?: string | null;
  photoBackPath?: string | null;
  photoSidePath?: string | null;
}): Promise<{ error?: string; success?: boolean; message?: string }> {
  const { t } = await getLanguage();
  const checked = validateWeeklyCheckinInput(input, t);
  if (!checked.ok) return { error: checked.error };

  const user = await getSessionUser();
  if (!user) return { error: t("Neautorizat.", "Not signed in.") };

  const weekStart = mondayOfWeek(input.weekStart || localDate());

  try {
    await serverApi("/checkins/weekly", {
      method: "POST",
      body: {
        coachId: input.coachId,
        enrollmentId: input.enrollmentId,
        weekStart,
        weightKg: checked.data.weightKg,
        energy: checked.data.energy,
        sleep: checked.data.sleep,
        stress: checked.data.stress,
        clientNotes: checked.data.clientNotes,
        photoFrontPath: input.photoFrontPath ?? null,
        photoBackPath: input.photoBackPath ?? null,
        photoSidePath: input.photoSidePath ?? null,
      },
    });

    revalidatePath("/checkin/weekly");
    revalidatePath("/");
    revalidatePath("/coach");
    revalidatePath(`/coach/clients/${user.id}`);
    return {
      success: true,
      message: t("Check-in-ul săptămânal a fost trimis antrenorului.", "Weekly check-in sent to your coach."),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : t("Eroare.", "Failed.") };
  }
}

export async function reviewWeeklyCheckinAction(
  checkinId: string,
  reply: string,
  clientIdForRevalidate?: string,
): Promise<{ error?: string; success?: boolean }> {
  const { t } = await getLanguage();
  const trimmed = reply.trim();
  if (trimmed.length < 1 || trimmed.length > 1500) {
    return {
      error: t(
        "Răspunsul trebuie să aibă între 1 și 1500 de caractere.",
        "Reply must be between 1 and 1500 characters.",
      ),
    };
  }

  await requireCoach();
  try {
    await serverApi(`/checkins/weekly/${encodeURIComponent(checkinId)}/review`, {
      method: "POST",
      body: { reply: trimmed },
    });
    revalidatePath("/coach");
    revalidatePath("/checkin/weekly");
    revalidatePath("/");
    if (clientIdForRevalidate) revalidatePath(`/coach/clients/${clientIdForRevalidate}`);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : t("Eroare.", "Failed.") };
  }
}
