"use server";

import { revalidatePath } from "next/cache";
import { getLanguage } from "@/app/language";
import { requireCoach } from "@/lib/coach/auth";
import { serverApi } from "@/lib/api/server";

export async function respondToEnrollmentAction(
  enrollmentId: string,
  decision: "active" | "rejected",
): Promise<{ error?: string; success?: boolean }> {
  await requireCoach();
  try {
    await serverApi(`/coach/enrollments/${encodeURIComponent(enrollmentId)}/respond`, {
      method: "POST",
      body: { decision },
    });
    revalidatePath("/coach");
    revalidatePath("/coach/clients");
    revalidatePath("/explore");
    revalidatePath("/");
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function updateEnrollmentStatusAction(
  enrollmentId: string,
  clientId: string,
  status: "active" | "paused" | "completed",
): Promise<{ error?: string; success?: boolean }> {
  await requireCoach();
  try {
    await serverApi(`/coach/enrollments/${encodeURIComponent(enrollmentId)}/status`, {
      method: "PATCH",
      body: { status },
    });
    revalidatePath("/coach");
    revalidatePath("/coach/clients");
    revalidatePath(`/coach/clients/${clientId}`);
    revalidatePath("/explore");
    revalidatePath("/");
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function updateEnrollmentWeekAction(
  enrollmentId: string,
  clientId: string,
  currentWeek: number,
): Promise<{ error?: string; success?: boolean }> {
  const { t } = await getLanguage();
  if (!Number.isInteger(currentWeek) || currentWeek < 1 || currentWeek > 52) {
    return { error: t("Săptămâna trebuie să fie între 1 și 52.", "Week must be between 1 and 52.") };
  }
  await requireCoach();

  try {
    await serverApi(`/coach/enrollments/${encodeURIComponent(enrollmentId)}/week`, {
      method: "PATCH",
      body: { currentWeek },
    });
    revalidatePath(`/coach/clients/${clientId}`);
    revalidatePath("/");
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function assignProgramToClientAction(
  enrollmentId: string,
  clientId: string,
  programId: string,
): Promise<{ error?: string; success?: boolean }> {
  await requireCoach();
  try {
    await serverApi(`/coach/enrollments/${encodeURIComponent(enrollmentId)}/assign-program`, {
      method: "POST",
      body: { programId },
    });
    revalidatePath("/coach");
    revalidatePath("/coach/clients");
    revalidatePath(`/coach/clients/${clientId}`);
    revalidatePath("/");
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function cloneProgramForClientAction(
  programId: string,
  clientId: string,
): Promise<{ error?: string; success?: boolean; programId?: string }> {
  await requireCoach();
  try {
    const res = await serverApi<{ id?: string; programId?: string }>(
      `/coach/programs/${encodeURIComponent(programId)}/clone`,
      {
        method: "POST",
        body: { clientId },
      },
    );
    const newProgramId = res.id ?? res.programId;
    revalidatePath("/coach");
    revalidatePath("/coach/programs");
    revalidatePath("/coach/clients");
    revalidatePath(`/coach/clients/${clientId}`);
    revalidatePath("/");
    return { success: true, programId: newProgramId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed" };
  }
}

export async function saveCoachClientNoteAction(
  clientId: string,
  note: string,
): Promise<{ error?: string; success?: boolean; updatedAt?: string }> {
  const { t } = await getLanguage();
  await requireCoach();

  if (note.length > 4000) {
    return { error: t("Notița poate avea maxim 4000 de caractere.", "Note can have at most 4000 characters.") };
  }

  try {
    const res = await serverApi<{ updatedAt: string }>(`/coach/clients/${encodeURIComponent(clientId)}/note`, {
      method: "PUT",
      body: { note },
    });
    revalidatePath(`/coach/clients/${clientId}`);
    return { success: true, updatedAt: res.updatedAt };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed" };
  }
}
