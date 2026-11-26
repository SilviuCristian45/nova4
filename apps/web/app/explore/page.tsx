import { redirect } from "next/navigation";
import { Text } from "@/app/components/language-provider";
import { getLanguage } from "@/app/language";
import { getSessionUser, serverApi } from "@/lib/api/server";
import {
  isValidInviteCode,
  normalizeInviteCode,
  type CoachProfile,
  type EnrollmentStatus,
  type ProgramDifficulty,
  type ProgramGoal,
  type ProgramInvitePreview,
} from "@/lib/coach/types";
import { Screen } from "@/app/components/ui";
import { ExploreClient, type MyEnrollmentCard, type PublicProgramCard } from "./explore-client";

export const dynamic = "force-dynamic";

interface ApiPublicProgram {
  id: string;
  coachId: string;
  coachName: string;
  title: string;
  description: string | null;
  difficulty: ProgramDifficulty;
  durationWeeks: number;
  goal: ProgramGoal;
  requiresApproval: boolean;
  workoutCount?: number;
  workouts?: { id: string }[];
}

interface ApiPublicCoach {
  userId: string;
  displayName: string;
  bio: string | null;
  specialties: string[];
  isPublic: boolean;
  acceptingClients: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ApiMyEnrollment {
  id: string;
  coachId: string;
  coachName: string | null;
  programId: string | null;
  programTitle: string | null;
  status: EnrollmentStatus;
  shareNutrition: boolean;
  currentWeek: number;
  nextWorkoutId?: string | null;
}

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

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { t } = await getLanguage();
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { code: rawCode } = await searchParams;
  const normalizedCode = rawCode ? normalizeInviteCode(rawCode) : "";

  const [rawPrograms, rawCoaches, rawEnrollments, invitePreviewRes] = await Promise.all([
    serverApi<ApiPublicProgram[]>("/explore/programs").catch(() => []),
    serverApi<ApiPublicCoach[]>("/explore/coaches").catch(() => []),
    serverApi<ApiMyEnrollment[]>("/explore/enrollments").catch(() => []),
    normalizedCode && isValidInviteCode(normalizedCode)
      ? serverApi<ApiInvitePreview>(`/explore/invite/${encodeURIComponent(normalizedCode)}`).catch(() => null)
      : Promise.resolve(null),
  ]);

  const publicCoaches: CoachProfile[] = rawCoaches.map((c) => ({
    user_id: c.userId,
    display_name: c.displayName,
    bio: c.bio,
    specialties: c.specialties,
    is_public: c.isPublic,
    accepting_clients: c.acceptingClients,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  }));

  const publicPrograms: PublicProgramCard[] = rawPrograms.map((p) => ({
    id: p.id,
    coach_id: p.coachId,
    coach_name: p.coachName || t("Antrenor", "Coach"),
    title: p.title,
    description: p.description,
    difficulty: p.difficulty,
    duration_weeks: p.durationWeeks,
    goal: p.goal,
    requires_approval: p.requiresApproval,
    workout_count: p.workoutCount ?? p.workouts?.length ?? 0,
  }));

  const myEnrollments: MyEnrollmentCard[] = rawEnrollments
    .filter((e) => e.status === "pending" || e.status === "active" || e.status === "paused")
    .map((e) => ({
      id: e.id,
      program_id: e.programId,
      program_title: e.programTitle || t("Program asignat", "Assigned program"),
      coach_name: e.coachName || t("Antrenor", "Coach"),
      status: e.status,
      share_nutrition: e.shareNutrition,
      current_week: e.currentWeek,
      next_workout_id: e.nextWorkoutId ?? null,
    }));

  const initialInvitePreview: ProgramInvitePreview | null = invitePreviewRes
    ? {
        id: invitePreviewRes.id,
        coach_id: invitePreviewRes.coachId,
        coach_name: invitePreviewRes.coachName,
        title: invitePreviewRes.title,
        description: invitePreviewRes.description,
        difficulty: invitePreviewRes.difficulty,
        duration_weeks: invitePreviewRes.durationWeeks,
        goal: invitePreviewRes.goal,
        requires_approval: invitePreviewRes.requiresApproval,
      }
    : null;

  const initialInviteError =
    normalizedCode && !isValidInviteCode(normalizedCode)
      ? t("Codul de invitație din link nu este valid.", "The invite code in the link is not valid.")
      : normalizedCode && !initialInvitePreview
        ? t("Nu am găsit niciun program publicat pentru codul din link.", "No published program was found for the invite code in the link.")
        : null;

  return (
    <Screen title={<Text ro="Programe & Antrenori" en="Programs & Coaches" />}>
      <ExploreClient
        currentUserId={user.id}
        publicPrograms={publicPrograms}
        publicCoaches={publicCoaches}
        myEnrollments={myEnrollments}
        initialInviteCode={normalizedCode}
        initialInvitePreview={initialInvitePreview}
        initialInviteError={initialInviteError}
      />
    </Screen>
  );
}
