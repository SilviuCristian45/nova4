"use server";

import { revalidatePath } from "next/cache";
import { getLanguage } from "@/app/language";
import { rememberWeightUnit } from "@/app/units";
import { isCoachSelfServeEnabled } from "@/lib/coach/auth";
import { parseUserRole, type UserRole } from "@/lib/coach/types";
import { serverApi } from "@/lib/api/server";
import { type ApiAuthSession } from "@/lib/api/types";

export type RegisterResult = {
  error?: string;
  info?: string;
  success?: boolean;
  role?: UserRole;
};

export async function registerUser(formData: FormData): Promise<RegisterResult> {
  const { t } = await getLanguage();

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const requestedRole = parseUserRole(formData.get("role"));
  const displayName = String(formData.get("displayName") ?? "").trim();

  if (!email || !password) {
    return { error: t("Te rog să completezi ambele câmpuri.", "Please fill in both fields.") };
  }

  if (password.length < 6) {
    return { error: t("Parola trebuie să aibă cel puțin 6 caractere.", "Password must contain at least 6 characters.") };
  }

  if (displayName.length > 80) {
    return { error: t("Numele poate avea maxim 80 de caractere.", "The name can have at most 80 characters.") };
  }

  if (requestedRole === "coach" && !isCoachSelfServeEnabled()) {
    return {
      error: t(
        "Înregistrarea directă ca antrenor este dezactivată pe acest server.",
        "Self-serve coach registration is disabled on this server.",
      ),
    };
  }

  try {
    const session = await serverApi<ApiAuthSession>("/auth/register", {
      method: "POST",
      body: {
        email,
        password,
        role: requestedRole,
        ...(displayName ? { displayName } : {}),
      },
      forwardCookies: false,
      applySetCookies: true,
    });

    await rememberWeightUnit("kg");
    revalidatePath("/", "layout");
    return { success: true, role: parseUserRole(session.user.profile?.role) };
  } catch (err) {
    const message = err instanceof Error ? err.message : t("Eroare necunoscută.", "Unknown error.");
    return { error: t("Eroare la înregistrare: ", "Could not register: ") + message };
  }
}
