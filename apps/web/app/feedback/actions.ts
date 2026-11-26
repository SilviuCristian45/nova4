"use server";

import { revalidatePath } from "next/cache";
import { getLanguage } from "@/app/language";
import { getSessionUser, serverApi } from "@/lib/api/server";
import { validateFeedbackInput } from "@/lib/coach/interactions";
import type { FeedbackReaction } from "@/lib/coach/types";

export type FeedbackThreadItem = {
  id: string;
  workoutId: string;
  authorId: string;
  authorName: string;
  isCoachAuthor: boolean;
  body: string;
  reaction: FeedbackReaction | null;
  createdAt: string;
};

export async function addWorkoutFeedbackAction(
  workoutId: string,
  body: string,
  reaction?: FeedbackReaction | null,
  clientIdForRevalidate?: string,
): Promise<{ error?: string; success?: boolean; item?: FeedbackThreadItem }> {
  const { t } = await getLanguage();
  const checked = validateFeedbackInput(body, reaction ?? null, t);
  if (!checked.ok) return { error: checked.error };

  const user = await getSessionUser();
  if (!user) return { error: t("Neautorizat.", "Not signed in.") };

  try {
    const inserted = await serverApi<{
      id: string;
      workoutId: string;
      authorId: string;
      body: string;
      reaction: FeedbackReaction | null;
      createdAt: string;
    }>(`/feedback/workouts/${encodeURIComponent(workoutId)}`, {
      method: "POST",
      body: {
        body: checked.body,
        reaction: checked.reaction,
      },
    });

    const isCoachAuthor = user.profile?.role === "coach";
    const authorName =
      user.profile?.displayName?.trim() || (isCoachAuthor ? t("Antrenor", "Coach") : t("Tu", "You"));

    revalidatePath("/history");
    revalidatePath("/coach");
    if (clientIdForRevalidate) revalidatePath(`/coach/clients/${clientIdForRevalidate}`);

    return {
      success: true,
      item: {
        id: inserted.id,
        workoutId: inserted.workoutId,
        authorId: inserted.authorId,
        authorName,
        isCoachAuthor,
        body: inserted.body,
        reaction: inserted.reaction ?? null,
        createdAt: inserted.createdAt,
      },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : t("Eroare.", "Failed.") };
  }
}

export async function deleteWorkoutFeedbackAction(
  feedbackId: string,
  clientIdForRevalidate?: string,
): Promise<{ error?: string; success?: boolean }> {
  const { t } = await getLanguage();
  const user = await getSessionUser();
  if (!user) return { error: t("Neautorizat.", "Not signed in.") };

  try {
    await serverApi(`/feedback/${encodeURIComponent(feedbackId)}`, { method: "DELETE" });
    revalidatePath("/history");
    revalidatePath("/coach");
    if (clientIdForRevalidate) revalidatePath(`/coach/clients/${clientIdForRevalidate}`);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : t("Eroare.", "Failed.") };
  }
}
