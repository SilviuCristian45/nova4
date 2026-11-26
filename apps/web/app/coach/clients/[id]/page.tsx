import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { Text } from "@/app/components/language-provider";
import { getLanguage } from "@/app/language";
import { requireCoach } from "@/lib/coach/auth";
import { serverApi } from "@/lib/api/server";
import {
  DEFAULT_ADHERENCE_DAYS,
  classifyClientAdherence,
  parseRangeDays,
  type NutritionPeriodSummary,
} from "@/lib/coach/analytics";
import { localDate, type DailyWeight } from "@/lib/daily-metrics";
import type { CheckinPhotoUrls, EnrollmentStatus, FeedbackReaction, WeeklyCheckinWithPhotos } from "@/lib/coach/types";
import type { FeedbackThreadItem } from "@/app/feedback/actions";
import { Card, CardTitle, Screen } from "@/app/components/ui";
import { PendingRequestsCard } from "../../pending-requests-card";
import {
  ClientDetail,
  type ClientDailyCheckin,
  type ClientEnrollmentDetail,
  type ClientMealPlanSummary,
  type ClientTargets,
  type ClientWorkoutDetail,
  type CoachMealPlanTemplateOption,
  type CoachProgramOption,
} from "./client-detail";
import type { MealPlanGoal, MealPlanStatus } from "@/lib/coach/meal-plans";

export const dynamic = "force-dynamic";

interface ApiCoachClientListItem {
  enrollmentId: string;
  clientId: string;
  clientName: string | null;
  programId: string | null;
  programTitle: string | null;
  status: EnrollmentStatus;
  shareNutrition: boolean;
  currentWeek: number;
  startedAt: string | null;
  createdAt: string;
}

interface ApiCoachProgram {
  id: string;
  title: string;
  assignedClientId: string | null;
}

interface ApiClientDetailRes {
  client: { id: string; displayName: string | null; weightUnit: string; dailyStepsGoal: number } | null;
  rangeDays: number;
  latestWorkoutDate: string | null;
  targets: ClientTargets | null;
  enrollments: {
    id: string;
    programId: string | null;
    status: EnrollmentStatus;
    shareNutrition: boolean;
    currentWeek: number;
    startedAt: string | null;
    createdAt: string;
  }[];
  note: { note: string; updatedAt: string | null };
  workouts: {
    id: string;
    performedOn: string;
    split: string;
    workoutMode: string;
    programWorkoutTitle: string | null;
    sets: {
      id: string;
      exercise: string;
      setNumber: number;
      setType: string;
      weight: number;
      reps: number;
      rir: number | null;
      notes: string | null;
      isPr: boolean;
    }[];
    cardio: { id: string; activity: string; durationMin: number }[];
    feedback: {
      id: string;
      workoutId: string;
      authorId: string;
      authorName: string;
      isCoachAuthor: boolean;
      body: string;
      reaction: FeedbackReaction | null;
      createdAt: string;
    }[];
  }[];
  weights: { date: string; weightKg: number }[];
  dailyCheckins: ClientDailyCheckin[];
  weeklyCheckins: {
    id: string;
    clientId: string;
    coachId: string;
    enrollmentId: string | null;
    weekStart: string;
    weightKg: number | null;
    energy: number;
    sleep: number;
    stress: number;
    clientNotes: string | null;
    coachReply: string | null;
    reviewedAt: string | null;
    photoFrontPath: string | null;
    photoBackPath: string | null;
    photoSidePath: string | null;
    photoUrls?: CheckinPhotoUrls;
    createdAt?: string;
    updatedAt?: string;
  }[];
}

interface ApiCoachMealPlan {
  id: string;
  assignedClientId: string | null;
  title: string;
  goal: MealPlanGoal;
  status: MealPlanStatus;
  targetKcal: number | null;
  targetProteinG: number | null;
  targetCarbsG: number | null;
  targetFatG: number | null;
  shareToken: string | null;
  updatedAt: string;
}

export default async function CoachClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string; tab?: string }>;
}) {
  const { id: clientId } = await params;
  const { range: rawRange, tab: rawTab } = await searchParams;
  const { t } = await getLanguage();
  const coach = await requireCoach();

  const rangeDays = parseRangeDays(rawRange);
  const initialTab =
    rawTab === "workouts" || rawTab === "nutrition" || rawTab === "program" ? rawTab : "overview";

  const [allClients, coachProgramsRaw] = await Promise.all([
    serverApi<ApiCoachClientListItem[]>("/coach/clients").catch(() => []),
    serverApi<ApiCoachProgram[]>("/coach/programs").catch(() => []),
  ]);

  const rawEnrollments = allClients.filter((e) => e.clientId === clientId);
  if (rawEnrollments.length === 0) notFound();

  const programMap = new Map(coachProgramsRaw.map((p) => [p.id, p]));
  const hasActive = rawEnrollments.some((e) => e.status === "active");
  const pendingEnrollments = rawEnrollments.filter((e) => e.status === "pending");

  if (!hasActive) {
    return (
      <Screen back="/coach/clients" title={`${t("Client", "Client")} #${clientId.slice(0, 6)}`}>
        {pendingEnrollments.length > 0 && (
          <PendingRequestsCard
            requests={pendingEnrollments.map((e) => ({
              id: e.enrollmentId,
              clientId,
              clientName: e.clientName || `${t("Client", "Client")} #${clientId.slice(0, 6)}`,
              programTitle: (e.programId && programMap.get(e.programId)?.title) || t("Program", "Program"),
              createdAt: e.createdAt,
            }))}
          />
        )}
        <Card>
          <CardTitle
            description={
              <Text
                ro="Conform regulilor de confidențialitate, istoricul de antrenamente, măsurătorile și progresul sunt vizibile doar cât timp clientul are status Activ."
                en="Per privacy rules, workout history, measurements, and progress are only visible while the client has an Active enrollment."
              />
            }
          >
            <span className="flex items-center gap-2">
              <Lock className="size-5 text-muted" />
              <Text ro="Client inactiv sau în așteptare" en="Inactive or pending client" />
            </span>
          </CardTitle>
        </Card>
      </Screen>
    );
  }

  const shareNutrition = rawEnrollments.some((e) => e.status === "active" && e.shareNutrition);

  const [detail, nutritionSummary, allCoachMealPlans] = await Promise.all([
    serverApi<ApiClientDetailRes>(`/coach/clients/${encodeURIComponent(clientId)}?range=${rangeDays}`),
    shareNutrition
      ? serverApi<NutritionPeriodSummary & { rangeDays: number }>(
          `/coach/clients/${encodeURIComponent(clientId)}/nutrition?range=${rangeDays}`,
        ).catch<NutritionPeriodSummary>(() => ({
          days: [],
          daysLogged: 0,
          avgKcal: 0,
          avgProtein: 0,
          avgCarbs: 0,
          avgFat: 0,
        }))
      : Promise.resolve<NutritionPeriodSummary>({
          days: [],
          daysLogged: 0,
          avgKcal: 0,
          avgProtein: 0,
          avgCarbs: 0,
          avgFat: 0,
        }),
    serverApi<ApiCoachMealPlan[]>("/coach/meal-plans").catch(() => []),
  ]);

  const clientName = detail.client?.displayName?.trim() || `${t("Client", "Client")} #${clientId.slice(0, 6)}`;

  const exerciseCounts = new Map<string, number>();
  const workouts: ClientWorkoutDetail[] = detail.workouts.map((w) => {
    const sets = w.sets.map((s) => {
      if (s.setType !== "Warmup") {
        exerciseCounts.set(s.exercise, (exerciseCounts.get(s.exercise) ?? 0) + 1);
      }
      return {
        id: s.id,
        exercise: s.exercise,
        set_number: s.setNumber,
        set_type: s.setType,
        weight: s.weight,
        reps: s.reps,
        rir: s.rir,
        notes: s.notes,
        is_pr: s.isPr,
      };
    });
    const feedback: FeedbackThreadItem[] = w.feedback ?? [];
    return {
      id: w.id,
      performed_on: w.performedOn,
      split: w.split,
      workout_mode: w.workoutMode,
      program_workout_title: w.programWorkoutTitle,
      workout_sets: sets,
      cardio_sessions: w.cardio.map((c) => ({
        id: c.id,
        activity: c.activity,
        duration_min: c.durationMin,
      })),
      feedback,
    };
  });

  const exercises = [...exerciseCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);

  const weights: DailyWeight[] = detail.weights.map((w) => ({ date: w.date, weight_kg: w.weightKg }));

  const activeStart =
    detail.enrollments
      .filter((e) => e.status === "active")
      .map((e) => e.startedAt ?? e.createdAt)
      .sort()[0] ?? null;

  const adherence = classifyClientAdherence(
    {
      lastWorkoutDate: detail.latestWorkoutDate,
      enrollmentStartedAt: activeStart,
    },
    localDate(),
    DEFAULT_ADHERENCE_DAYS,
  );

  const enrollments: ClientEnrollmentDetail[] = detail.enrollments.map((e) => {
    const prog = e.programId ? programMap.get(e.programId) : undefined;
    return {
      id: e.id,
      program_id: e.programId,
      program_title: prog?.title ?? null,
      is_custom_for_client: prog?.assignedClientId === clientId,
      status: e.status,
      share_nutrition: e.shareNutrition,
      current_week: e.currentWeek,
    };
  });

  const coachPrograms: CoachProgramOption[] = coachProgramsRaw
    .filter((p) => p.assignedClientId === null || p.assignedClientId === clientId)
    .map((p) => ({
      id: p.id,
      title: p.title,
      isCustomForClient: p.assignedClientId === clientId,
    }));

  const weeklyCheckins: WeeklyCheckinWithPhotos[] = detail.weeklyCheckins.map((r) => ({
    id: r.id,
    client_id: r.clientId,
    coach_id: r.coachId,
    enrollment_id: r.enrollmentId,
    week_start: r.weekStart,
    weight_kg: r.weightKg,
    energy: r.energy,
    sleep: r.sleep,
    stress: r.stress,
    client_notes: r.clientNotes,
    coach_reply: r.coachReply,
    reviewed_at: r.reviewedAt,
    photo_front_path: r.photoFrontPath,
    photo_back_path: r.photoBackPath,
    photo_side_path: r.photoSidePath,
    created_at: r.createdAt ?? r.weekStart,
    updated_at: r.updatedAt ?? r.weekStart,
    photoUrls: r.photoUrls ?? {},
  }));

  const clientMealPlans: ClientMealPlanSummary[] = allCoachMealPlans
    .filter((p) => p.assignedClientId === clientId)
    .map((p) => ({
      id: p.id,
      title: p.title,
      goal: p.goal,
      status: p.status,
      targetKcal: p.targetKcal,
      targetProteinG: p.targetProteinG,
      targetCarbsG: p.targetCarbsG,
      targetFatG: p.targetFatG,
      hasPublicLink: Boolean(p.shareToken),
      updatedAt: p.updatedAt,
    }));
  const mealPlanTemplates: CoachMealPlanTemplateOption[] = allCoachMealPlans
    .filter((p) => p.assignedClientId === null)
    .map((p) => ({
      id: p.id,
      title: p.title,
      targetKcal: p.targetKcal,
    }));

  return (
    <Screen back="/coach/clients" title={clientName}>
      <ClientDetail
        coachId={coach.userId}
        clientId={clientId}
        rangeDays={rangeDays}
        initialTab={initialTab}
        adherence={adherence}
        enrollments={enrollments}
        workouts={workouts}
        exercises={exercises}
        weights={weights}
        shareNutrition={shareNutrition}
        nutritionSummary={nutritionSummary}
        targets={detail.targets}
        dailyCheckins={detail.dailyCheckins}
        weeklyCheckins={weeklyCheckins}
        coachPrograms={coachPrograms}
        clientMealPlans={clientMealPlans}
        mealPlanTemplates={mealPlanTemplates}
        initialNote={detail.note?.note ?? ""}
        initialNoteUpdatedAt={detail.note?.updatedAt ?? null}
      />
    </Screen>
  );
}
