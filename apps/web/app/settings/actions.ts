"use server";

import { revalidatePath } from "next/cache";
import { getLanguage } from "@/app/language";
import { rememberWeightUnit } from "@/app/units";
import { isCoachSelfServeEnabled } from "@/lib/coach/auth";
import { parseSpecialties } from "@/lib/coach/types";
import { getSessionUser, serverApi } from "@/lib/api/server";

export type ActionResult = { error?: string; success?: boolean; message?: string };

export async function updateProfile(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { t } = await getLanguage();

  const user = await getSessionUser();
  if (!user) return { error: t("Neautorizat", "Not signed in") };

  const text = (name: string) => String(formData.get(name) ?? "").trim();
  const displayName = text("displayName");
  const height = text("heightCm");
  const birthDate = text("birthDate");
  const sex = text("sex");
  const weightUnit = text("weightUnit");
  const goal = Number(text("dailyStepsGoal"));

  if (displayName.length > 80) {
    return { error: t("Numele poate avea maxim 80 de caractere.", "The name can have at most 80 characters.") };
  }
  const heightCm = height ? Number(height) : null;
  if (heightCm !== null && !(heightCm >= 50 && heightCm <= 272)) {
    return { error: t("Înălțimea trebuie să fie între 50 și 272 cm.", "Height must be between 50 and 272 cm.") };
  }
  if (
    birthDate &&
    !(/^\d{4}-\d{2}-\d{2}$/.test(birthDate) && birthDate >= "1900-01-01" && birthDate <= new Date().toISOString().slice(0, 10))
  ) {
    return { error: t("Data nașterii nu este validă.", "The birth date is not valid.") };
  }
  if (sex && sex !== "male" && sex !== "female") {
    return { error: t("Valoare invalidă pentru sex.", "Invalid value for sex.") };
  }
  if (weightUnit !== "kg" && weightUnit !== "lb") {
    return { error: t("Unitate de măsură invalidă.", "Invalid unit.") };
  }
  if (!Number.isInteger(goal) || goal <= 0 || goal > 1000000) {
    return { error: t("Targetul trebuie să fie un număr pozitiv", "The goal must be a positive number") };
  }

  try {
    await serverApi("/profile", {
      method: "PATCH",
      applySetCookies: true,
      body: {
        displayName: displayName || null,
        heightCm,
        birthDate: birthDate || null,
        sex: sex || null,
        weightUnit,
        dailyStepsGoal: goal,
      },
    });
    await rememberWeightUnit(weightUnit);
    revalidatePath("/", "layout");
    return { success: true, message: t("Profil salvat.", "Profile saved.") };
  } catch (err) {
    return { error: err instanceof Error ? err.message : t("Eroare la salvare.", "Save failed.") };
  }
}

export async function activateCoachRole(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { t } = await getLanguage();
  if (!isCoachSelfServeEnabled()) {
    return {
      error: t(
        "Activarea rolului de antrenor este dezactivată pe acest server.",
        "Self-serve coach activation is disabled on this server.",
      ),
    };
  }

  const user = await getSessionUser();
  if (!user) return { error: t("Neautorizat", "Not signed in") };

  const displayName = String(formData.get("coachDisplayName") ?? "").trim();
  if (displayName.length > 80) {
    return { error: t("Numele poate avea maxim 80 de caractere.", "The name can have at most 80 characters.") };
  }

  try {
    await serverApi("/auth/activate-coach", {
      method: "POST",
      applySetCookies: true,
      body: displayName ? { displayName } : {},
    });
    revalidatePath("/", "layout");
    revalidatePath("/settings");
    revalidatePath("/coach");
    return {
      success: true,
      message: t("Rolul de antrenor a fost activat.", "Coach mode has been activated."),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : t("Activarea a eșuat.", "Activation failed.") };
  }
}

export async function updateCoachProfile(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { t } = await getLanguage();

  const user = await getSessionUser();
  if (!user) return { error: t("Neautorizat", "Not signed in") };

  const displayName = String(formData.get("coachDisplayName") ?? "").trim();
  const bio = String(formData.get("coachBio") ?? "").trim();
  const specialties = parseSpecialties(String(formData.get("coachSpecialties") ?? ""));
  const isPublic = formData.get("isPublic") === "on";
  const acceptingClients = formData.get("acceptingClients") === "on";

  if (displayName.length < 1 || displayName.length > 80) {
    return {
      error: t(
        "Numele de antrenor trebuie să aibă între 1 și 80 de caractere.",
        "Coach name must be between 1 and 80 characters.",
      ),
    };
  }
  if (bio.length > 1000) {
    return { error: t("Descrierea poate avea maxim 1000 de caractere.", "Bio can have at most 1000 characters.") };
  }

  try {
    await serverApi("/coach-profile", {
      method: "PUT",
      body: {
        displayName,
        bio: bio || null,
        specialties,
        isPublic,
        acceptingClients,
      },
    });
    revalidatePath("/settings");
    revalidatePath("/coach");
    return { success: true, message: t("Profilul de antrenor a fost salvat.", "Coach profile saved.") };
  } catch (err) {
    return { error: err instanceof Error ? err.message : t("Eroare la salvare.", "Save failed.") };
  }
}

export async function updateEmail(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { t } = await getLanguage();

  const user = await getSessionUser();
  if (!user) return { error: t("Neautorizat", "Not signed in") };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const currentPassword = String(formData.get("currentPassword") ?? "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: t("Email invalid.", "Invalid email.") };
  if (email === user.email.toLowerCase()) {
    return { error: t("Acesta este deja emailul contului.", "This is already your account email.") };
  }
  if (!currentPassword) {
    return { error: t("Introdu parola curentă pentru confirmare.", "Enter your current password to confirm.") };
  }

  try {
    await serverApi("/auth/email", {
      method: "PATCH",
      body: { email, currentPassword },
    });
    revalidatePath("/settings");
    return {
      success: true,
      message: t("Emailul a fost actualizat.", "Email updated."),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : t("Actualizarea a eșuat.", "Update failed.") };
  }
}

export async function updatePassword(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { t } = await getLanguage();

  const user = await getSessionUser();
  if (!user) return { error: t("Neautorizat", "Not signed in") };

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!currentPassword) {
    return { error: t("Introdu parola curentă.", "Enter your current password.") };
  }
  if (password.length < 8) {
    return { error: t("Parola trebuie să aibă minim 8 caractere.", "The password must have at least 8 characters.") };
  }
  if (password !== String(formData.get("confirmPassword") ?? "")) {
    return { error: t("Parolele nu coincid.", "The passwords do not match.") };
  }

  try {
    await serverApi("/auth/password", {
      method: "PATCH",
      applySetCookies: true,
      body: { currentPassword, newPassword: password },
    });
    return {
      success: true,
      message: t(
        "Parola a fost schimbată. Autentifică-te din nou cu parola nouă.",
        "Password changed. Please sign in again with your new password.",
      ),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : t("Schimbarea parolei a eșuat.", "Password change failed.") };
  }
}

export async function deleteAllData(confirmation: string): Promise<ActionResult> {
  const { t } = await getLanguage();
  const user = await getSessionUser();
  if (!user) return { error: t("Neautorizat", "Not signed in") };
  if (confirmation.trim().toLowerCase() !== user.email.toLowerCase()) {
    return { error: t("Emailul introdus nu se potrivește.", "The email you typed does not match.") };
  }

  try {
    await serverApi("/account/data", {
      method: "DELETE",
      body: { confirmEmail: confirmation.trim() },
    });
    revalidatePath("/", "layout");
    return { success: true };
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? err.message
          : t("Datele nu au putut fi șterse. Încearcă din nou.", "Data could not be deleted. Please try again."),
    };
  }
}

export async function deleteAccount(confirmation: string): Promise<ActionResult> {
  const { t } = await getLanguage();
  const user = await getSessionUser();
  if (!user) return { error: t("Neautorizat", "Not signed in") };
  if (confirmation.trim().toLowerCase() !== user.email.toLowerCase()) {
    return { error: t("Emailul introdus nu se potrivește.", "The email you typed does not match.") };
  }

  try {
    await serverApi("/account", {
      method: "DELETE",
      applySetCookies: true,
      body: { confirmEmail: confirmation.trim() },
    });
    return { success: true };
  } catch (err) {
    console.error("Account deletion failed:", err);
    return {
      error:
        err instanceof Error
          ? err.message
          : t("Contul nu a putut fi șters. Încearcă din nou.", "The account could not be deleted. Please try again."),
    };
  }
}
