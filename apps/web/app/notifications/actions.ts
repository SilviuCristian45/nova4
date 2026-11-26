"use server";

import { revalidatePath } from "next/cache";
import { getLanguage } from "@/app/language";
import { getSessionUser, serverApi } from "@/lib/api/server";

export async function markNotificationReadAction(id: string): Promise<{ error?: string; success?: boolean }> {
  const { t } = await getLanguage();
  const user = await getSessionUser();
  if (!user) return { error: t("Neautorizat.", "Not signed in.") };

  try {
    await serverApi(`/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH" });
    revalidatePath("/notifications");
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : t("Eroare.", "Failed.") };
  }
}

export async function markAllNotificationsReadAction(): Promise<{ error?: string; success?: boolean }> {
  const { t } = await getLanguage();
  const user = await getSessionUser();
  if (!user) return { error: t("Neautorizat.", "Not signed in.") };

  try {
    await serverApi("/notifications/read-all", { method: "POST" });
    revalidatePath("/notifications");
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : t("Eroare.", "Failed.") };
  }
}

export async function deleteNotificationAction(id: string): Promise<{ error?: string; success?: boolean }> {
  const { t } = await getLanguage();
  const user = await getSessionUser();
  if (!user) return { error: t("Neautorizat.", "Not signed in.") };

  try {
    await serverApi(`/notifications/${encodeURIComponent(id)}`, { method: "DELETE" });
    revalidatePath("/notifications");
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : t("Eroare.", "Failed.") };
  }
}
