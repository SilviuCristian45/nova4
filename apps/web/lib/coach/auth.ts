import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/api/server";
import { coachSelfServeEnabled, parseUserRole, type CoachProfile, type UserRole } from "./types";

export function isCoachSelfServeEnabled(): boolean {
  return coachSelfServeEnabled(process.env.COACH_SELF_SERVE);
}

export type AuthRoleContext = {
  userId: string;
  email: string | null;
  role: UserRole;
  displayName: string | null;
  migrationMissing: boolean;
};

export const getCurrentAuthRole = cache(async (): Promise<AuthRoleContext | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  return {
    userId: user.id,
    email: user.email ?? null,
    role: parseUserRole(user.profile?.role),
    displayName: user.profile?.displayName ?? null,
    migrationMissing: false,
  };
});

export async function getOwnCoachProfile(_userId?: string): Promise<CoachProfile | null> {
  const user = await getSessionUser();
  const cp = user?.coachProfile;
  if (!cp) return null;
  return {
    user_id: cp.userId,
    display_name: cp.displayName,
    bio: cp.bio,
    specialties: cp.specialties,
    is_public: cp.isPublic,
    accepting_clients: cp.acceptingClients,
    created_at: cp.createdAt,
    updated_at: cp.updatedAt,
  };
}

// Defense-in-depth guard for /coach layouts, pages, and server actions.
export async function requireCoach(): Promise<AuthRoleContext> {
  const context = await getCurrentAuthRole();
  if (!context) redirect("/login");
  if (context.role !== "coach") redirect("/");
  return context;
}
