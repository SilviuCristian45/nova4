"use server";

import { revalidatePath } from "next/cache";
import { getLanguage } from "@/app/language";
import { rememberWeightUnit } from "@/app/units";
import { parseWeightUnit } from "@/lib/units";
import { serverApi } from "@/lib/api/server";
import { ApiError, type ApiAuthSession } from "@/lib/api/types";

export async function loginUser(formData: FormData) {
  const { t } = await getLanguage();

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: t("Te rog să completezi ambele câmpuri.", "Please fill in both fields.") };
  }

  try {
    const session = await serverApi<ApiAuthSession>("/auth/login", {
      method: "POST",
      body: { email, password },
      forwardCookies: false,
      applySetCookies: true,
    });

    await rememberWeightUnit(parseWeightUnit(session.user.profile?.weightUnit));
    revalidatePath("/", "layout");
    return { success: true };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 400 || err.status === 401)) {
      return { error: t("Email sau parolă incorectă.", "Incorrect email or password.") };
    }
    return {
      error: err instanceof Error ? err.message : t("Autentificarea a eșuat.", "Sign in failed."),
    };
  }
}
