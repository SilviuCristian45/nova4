"use server";

import { revalidatePath } from "next/cache";
import { getLanguage } from "@/app/language";
import { getSessionUser, serverApi } from "@/lib/api/server";
import { ApiError } from "@/lib/api/types";
import {
  isValidInviteCode,
  normalizeInviteCode,
  type ProgramDifficulty,
  type ProgramGoal,
  type ProgramInvitePreview,
} from "@/lib/coach/types";

export type InviteLookupResult = {
  error?: string;
  preview?: ProgramInvitePreview | null;
};

interface ApiInvitePreview {
  id: string;
  coachId: string;
  coachName: string;
  title: string;
  description: string | null;
  difficulty: ProgramDifficulty;
  durationWeeks: number;
  goal: ProgramGoal;
  requiresApproval: boolean;
}

export async function lookupInviteCodeAction(rawCode: string): Promise<InviteLookupResult> {
  const { t } = await getLanguage();
  const code = normalizeInviteCode(rawCode);
  if (!isValidInviteCode(code)) {
    return {
      error: t(
        "Codul de invitație trebuie să conțină 6–16 litere sau cifre.",
        "Invite code must be 6–16 letters or digits.",
      ),
    };
  }

  const user = await getSessionUser();
  if (!user) return { error: t("Neautorizat.", "Not signed in.") };

  try {
    const data = await serverApi<ApiInvitePreview>(`/explore/invite/${encodeURIComponent(code)}`);
    return {
      preview: {
        id: data.id,
        coach_id: data.coachId,
        coach_name: data.coachName,
        title: data.title,
        description: data.description,
        difficulty: data.difficulty,
        duration_weeks: data.durationWeeks,
        goal: data.goal,
        requires_approval: data.requiresApproval,
      },
    };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return {
        preview: null,
        error: t(
          "Nu am găsit niciun program publicat pentru acest cod.",
          "No published program was found for this code.",
        ),
      };
    }
    return { error: err instanceof Error ? err.message : t("Eroare.", "Failed.") };
  }
}

export async function enrollInProgramAction(
  programId: string,
  inviteCode?: string | null,
  shareNutrition = true,
): Promise<{ error?: string; success?: boolean; enrollmentId?: string }> {
  const { t } = await getLanguage();
  const user = await getSessionUser();
  if (!user) return { error: t("Neautorizat.", "Not signed in.") };

  const normalized = inviteCode ? normalizeInviteCode(inviteCode) : null;
  try {
    const res = await serverApi<{ id: string }>("/explore/enroll", {
      method: "POST",
      body: {
        programId,
        inviteCode: normalized,
        shareNutrition,
      },
    });
    revalidatePath("/explore");
    revalidatePath("/");
    revalidatePath("/coach");
    return { success: true, enrollmentId: res.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/Already enrolled/i.test(message)) {
      return { error: t("Ești deja înscris în acest program.", "You are already enrolled in this program.") };
    }
    if (/own program/i.test(message)) {
      return { error: t("Nu te poți înscrie în propriul tău program.", "You cannot enroll in your own program.") };
    }
    if (/Invalid invite code/i.test(message)) {
      return { error: t("Codul de invitație nu este valid.", "The invite code is not valid.") };
    }
    return { error: message || t("Eroare la înscriere.", "Enrollment failed.") };
  }
}

export async function cancelPendingEnrollmentAction(
  enrollmentId: string,
): Promise<{ error?: string; success?: boolean }> {
  const { t } = await getLanguage();
  const user = await getSessionUser();
  if (!user) return { error: t("Neautorizat.", "Not signed in.") };

  try {
    await serverApi(`/explore/enrollments/${encodeURIComponent(enrollmentId)}`, {
      method: "DELETE",
    });
    revalidatePath("/explore");
    revalidatePath("/");
    revalidatePath("/coach");
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : t("Eroare.", "Failed.") };
  }
}

export async function toggleEnrollmentNutritionAction(
  enrollmentId: string,
  shareNutrition: boolean,
): Promise<{ error?: string; success?: boolean }> {
  const { t } = await getLanguage();
  const user = await getSessionUser();
  if (!user) return { error: t("Neautorizat.", "Not signed in.") };

  try {
    await serverApi(`/explore/enrollments/${encodeURIComponent(enrollmentId)}/nutrition`, {
      method: "PATCH",
      body: { shareNutrition },
    });
    revalidatePath("/explore");
    revalidatePath("/");
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : t("Eroare.", "Failed.") };
  }
}
