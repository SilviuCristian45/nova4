import { Text } from "@/app/components/language-provider";
import { getLanguage } from "@/app/language";
import { localDate } from "@/lib/daily-metrics";
import { getCurrentAuthRole } from "@/lib/coach/auth";
import { pickNextProgramWorkout } from "@/lib/coach/programs";
import { mondayOfWeek } from "@/lib/coach/interactions";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Award, ChevronRight, ClipboardCheck, ClipboardList, Play, Settings, Utensils } from "lucide-react";
import { SignOutButton } from "./components/sign-out-button";
import { getSessionUser, serverApi } from "@/lib/api/server";
import { getDailySteps } from "./steps/steps";
import StepsInput from "./components/steps-input";
import WeightInput from "./components/weight-input";
import CheckinCard from "./components/checkin-card";
import { getDailyGoal } from "./profiles/profile";
import GoalSetting from "./components/goal-setting";
import { Badge, Card, Columns, CtaCard, LinkList, Screen, Stack, buttonClass, iconButtonClass } from "./components/ui";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ApiWorkoutList {
  items: { performedOn: string }[];
  total: number;
}

interface ApiActiveProgramRes {
  hasActiveCoach: boolean;
  assignedProgram: {
    enrollmentId: string;
    programId: string;
    programTitle: string;
    coachName: string | null;
    currentWeek: number;
    completedProgramWorkoutIds: string[];
    workouts: {
      id: string;
      weekNumber: number;
      dayNumber: number;
      position: number;
      title: string;
      workoutMode: string;
      itemCount: number;
    }[];
  } | null;
}

interface ApiWeeklyCheckin {
  id: string;
  weekStart: string;
  reviewedAt: string | null;
  coachReply: string | null;
}

interface ApiMealPlanSummary {
  id: string;
  title: string;
  targetKcal: number | null;
  targetProteinG: number | null;
  targetCarbsG: number | null;
  targetFatG: number | null;
}

function calculateWeeklyStreak(workouts: { performedOn: string }[]) {
  const monday = (date: Date) => {
    const copy = new Date(date);
    copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7));
    return copy.setHours(0, 0, 0, 0);
  };
  const activeWeeks = new Set(workouts.map((workout) => monday(new Date(`${workout.performedOn}T00:00:00`))));
  const date = new Date();
  if (!activeWeeks.has(monday(date))) date.setDate(date.getDate() - 7);
  let streak = 0;
  while (activeWeeks.has(monday(date))) {
    streak++;
    date.setDate(date.getDate() - 7);
  }
  return streak;
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  if (params.history === "true" || params.page || params.startDate) {
    const query = new URLSearchParams();
    for (const key of ["startDate", "endDate", "page"]) if (params[key]) query.set(key, params[key]!);
    redirect(`/history${query.size ? `?${query}` : ""}`);
  }

  const { t, locale } = await getLanguage();
  const user = await getSessionUser();

  if (!user) {
    return (
      <Screen back={false} className="min-h-dvh justify-center text-center">
        <h1 className="text-[28px] font-bold tracking-[-0.8px]">
          <Text ro="Sesiune expirată" en="Session expired" />
        </h1>
        <p className="text-muted">
          <Text ro="Trebuie să te loghezi din nou pentru a continua." en="Please sign in again to continue." />
        </p>
        <Link href="/login" className={buttonClass()}>
          <Text ro="Mergi la login" en="Go to sign in" />
        </Link>
      </Screen>
    );
  }

  const today = localDate();
  const weekStart = mondayOfWeek(today);

  const [workoutsRes, authRole, todaySteps, todayGoal, activeProgramRes, weeklyCheckins, activeMealPlans] =
    await Promise.all([
      serverApi<ApiWorkoutList>("/workouts?limit=500").catch(() => ({ items: [], total: 0 })),
      getCurrentAuthRole(),
      getDailySteps(today),
      getDailyGoal(),
      serverApi<ApiActiveProgramRes>("/explore/active-program").catch(() => ({
        hasActiveCoach: false,
        assignedProgram: null,
      })),
      serverApi<ApiWeeklyCheckin[]>("/checkins/weekly").catch(() => []),
      serverApi<ApiMealPlanSummary[]>("/meals/plan").catch(() => []),
    ]);

  const streak = calculateWeeklyStreak(workoutsRes.items);
  const totalSessions = workoutsRes.total ?? workoutsRes.items.length;
  const name = authRole?.displayName?.trim();
  const isCoach = authRole?.role === "coach";
  const hasActiveCoach = activeProgramRes.hasActiveCoach;
  const weeklyCheckinRow = weeklyCheckins.find((c) => c.weekStart === weekStart) ?? null;
  const activeMealPlanRow = activeMealPlans[0] ?? null;

  type AssignedSummary = {
    enrollmentId: string;
    programTitle: string;
    coachName: string;
    currentWeek: number;
    nextWorkout: {
      id: string;
      title: string;
      week_number: number;
      day_number: number;
      workout_mode: string;
      itemCount: number;
    } | null;
    otherWorkouts: { id: string; title: string; week_number: number; day_number: number }[];
  };

  let assignedProgram: AssignedSummary | null = null;
  if (activeProgramRes.assignedProgram) {
    const ap = activeProgramRes.assignedProgram;
    const typedWorkouts = ap.workouts.map((w) => ({
      id: w.id,
      week_number: w.weekNumber,
      day_number: w.dayNumber,
      position: w.position,
      title: w.title,
      workout_mode: w.workoutMode,
      itemCount: w.itemCount,
    }));
    const completedSet = new Set(ap.completedProgramWorkoutIds);
    const picked = pickNextProgramWorkout(typedWorkouts, completedSet, ap.currentWeek);

    assignedProgram = {
      enrollmentId: ap.enrollmentId,
      programTitle: ap.programTitle,
      coachName: ap.coachName ?? t("Antrenor", "Coach"),
      currentWeek: ap.currentWeek,
      nextWorkout: picked
        ? {
            id: picked.id,
            title: picked.title,
            week_number: picked.week_number,
            day_number: picked.day_number,
            workout_mode: picked.workout_mode,
            itemCount: picked.itemCount,
          }
        : null,
      otherWorkouts: typedWorkouts
        .filter((w) => w.id !== picked?.id)
        .slice(0, 6)
        .map((w) => ({ id: w.id, title: w.title, week_number: w.week_number, day_number: w.day_number })),
    };
  }

  return (
    <Screen back={false}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-muted">
          {new Date().toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })}
        </span>
        <div className="flex items-center gap-2">
          {isCoach && (
            <Link href="/coach" className={buttonClass({ variant: "soft", tone: "lime", small: true })}>
              <Award className="size-4" />
              <Text ro="Antrenor" en="Coach" />
            </Link>
          )}
          <Link
            href="/settings"
            aria-label={t("Setări", "Settings")}
            title={t("Setări", "Settings")}
            className={iconButtonClass()}
          >
            <Settings className="size-5" />
          </Link>
          <SignOutButton />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <h1 className="text-[36px] font-bold leading-[40px] tracking-[-1.4px]">
          {name ? `${t("Salut", "Hi")}, ${name}` : t("Gata de antrenament?", "Ready to train?")}
        </h1>
        <p className="text-muted">
          <span className="font-semibold text-foreground tabular-nums">{totalSessions}</span>{" "}
          {t("antrenamente", "workouts")}
          {streak > 0 && (
            <>
              {" "}
              · <span className="font-semibold text-foreground tabular-nums">{streak}</span>{" "}
              {t("săpt. la rând", "week streak")}
            </>
          )}
        </p>
      </div>

      <Columns>
        <Stack>
          <CtaCard
            href="/insert"
            label={t("Antrenament nou", "New workout")}
            title={t("Începe antrenamentul", "Start workout")}
          />
          {assignedProgram && (
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-lime-text">
                    <ClipboardList className="size-3.5" />
                    <Text ro="Programul tău activ" en="Your active program" />
                  </span>
                  <h2 className="text-[20px] font-semibold tracking-[-0.4px]">{assignedProgram.programTitle}</h2>
                  <p className="text-xs text-muted">
                    {t("Antrenor", "Coach")}: {assignedProgram.coachName}
                  </p>
                </div>
                <Badge tone="lime">
                  {t("Săpt.", "Wk")} {assignedProgram.currentWeek}
                </Badge>
              </div>

              {assignedProgram.nextWorkout ? (
                <div className="flex flex-col gap-2.5 rounded-md bg-inner p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted">
                        <Text ro="Următorul antrenament recomandat" en="Next recommended workout" />
                      </p>
                      <p className="font-semibold">
                        {assignedProgram.nextWorkout.title}{" "}
                        <span className="text-xs font-normal text-muted">
                          ({t("S", "W")}
                          {assignedProgram.nextWorkout.week_number}·{t("Z", "D")}
                          {assignedProgram.nextWorkout.day_number} · {assignedProgram.nextWorkout.itemCount}{" "}
                          {assignedProgram.nextWorkout.workout_mode === "cardio"
                            ? t("activități", "activities")
                            : t("exerciții", "exercises")}
                          )
                        </span>
                      </p>
                    </div>
                  </div>
                  <Link
                    href={`/insert?programWorkoutId=${assignedProgram.nextWorkout.id}&enrollmentId=${assignedProgram.enrollmentId}`}
                    className={buttonClass({ small: true })}
                  >
                    <Play className="size-4" />
                    <Text ro="Pornește din program" en="Start program workout" />
                  </Link>
                </div>
              ) : (
                <p className="text-sm text-muted">
                  <Text
                    ro="Antrenorul nu a adăugat încă zile în acest program."
                    en="Your coach hasn't added workout days to this program yet."
                  />
                </p>
              )}

              {assignedProgram.otherWorkouts.length > 0 && (
                <details className="text-sm">
                  <summary className="text-xs font-semibold text-soft">
                    <Text ro="Alege altă zi din program" en="Choose another program day" />
                  </summary>
                  <div className="mt-2 flex flex-col gap-1">
                    {assignedProgram.otherWorkouts.map((day) => (
                      <Link
                        key={day.id}
                        href={`/insert?programWorkoutId=${day.id}&enrollmentId=${assignedProgram.enrollmentId}`}
                        className="flex items-center justify-between rounded-sm bg-inner px-3 py-2 text-xs font-medium transition-colors active:bg-control"
                      >
                        <span>
                          {t("S", "W")}
                          {day.week_number}·{t("Z", "D")}
                          {day.day_number} — {day.title}
                        </span>
                        <ChevronRight className="size-4 text-muted" />
                      </Link>
                    ))}
                  </div>
                </details>
              )}
            </Card>
          )}
          {activeMealPlanRow && (
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-lime-text">
                    <Utensils className="size-3.5" />
                    <Text ro="Plan alimentar activ" en="Active meal plan" />
                  </span>
                  <h2 className="text-[18px] font-semibold tracking-[-0.3px]">{activeMealPlanRow.title}</h2>
                  {(activeMealPlanRow.targetKcal !== null || activeMealPlanRow.targetProteinG !== null) && (
                    <p className="text-xs text-muted tabular-nums">
                      {activeMealPlanRow.targetKcal !== null ? `${activeMealPlanRow.targetKcal} kcal` : ""}
                      {activeMealPlanRow.targetProteinG !== null ? ` · P ${activeMealPlanRow.targetProteinG}g` : ""}
                      {activeMealPlanRow.targetCarbsG !== null ? ` · C ${activeMealPlanRow.targetCarbsG}g` : ""}
                      {activeMealPlanRow.targetFatG !== null ? ` · ${t("G", "F")} ${activeMealPlanRow.targetFatG}g` : ""}
                    </p>
                  )}
                </div>
                {activeMealPlanRow.targetKcal !== null && (
                  <Badge tone="lime">{activeMealPlanRow.targetKcal} kcal</Badge>
                )}
              </div>
              <Link href="/meals/plan" className={buttonClass({ variant: "secondary", small: true })}>
                <Utensils className="size-4" />
                <Text ro="Vezi planul alimentar" en="View meal plan" />
              </Link>
            </Card>
          )}
          {hasActiveCoach && (
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-lilac-text">
                    <ClipboardCheck className="size-3.5" />
                    <Text ro="Check-in săptămânal" en="Weekly check-in" />
                  </span>
                  <p className="text-sm font-semibold">
                    {weeklyCheckinRow?.reviewedAt
                      ? t("Antrenorul a răspuns la check-in!", "Your coach replied to your check-in!")
                      : weeklyCheckinRow
                        ? t("Trimis pe săptămâna aceasta", "Submitted for this week")
                        : t("Completează raportul pe săptămâna aceasta (1 min)", "Complete this week's check-in (1 min)")}
                  </p>
                </div>
                <Badge tone={weeklyCheckinRow?.reviewedAt ? "lime" : weeklyCheckinRow ? "gold" : "lilac"}>
                  {weeklyCheckinRow?.reviewedAt
                    ? t("Răspuns nou", "Reviewed")
                    : weeklyCheckinRow
                      ? t("Trimis", "Sent")
                      : t("De completat", "Due")}
                </Badge>
              </div>
              {weeklyCheckinRow?.coachReply && (
                <p className="line-clamp-2 rounded-md border border-lime-border bg-lime-soft px-3 py-2 text-xs text-foreground">
                  {weeklyCheckinRow.coachReply}
                </p>
              )}
              <Link
                href="/checkin/weekly"
                className={buttonClass({ variant: weeklyCheckinRow ? "secondary" : "primary", small: true })}
              >
                <ClipboardCheck className="size-4" />
                {weeklyCheckinRow?.reviewedAt
                  ? t("Vezi răspunsul", "View reply")
                  : weeklyCheckinRow
                    ? t("Vezi / Editează check-in", "View / Edit check-in")
                    : t("Completează check-in-ul", "Submit check-in")}
              </Link>
            </Card>
          )}
          <StepsInput initialSteps={todaySteps} date={today} goal={todayGoal} />
          <WeightInput />
          <CheckinCard />
        </Stack>
        <Stack>
          <LinkList
            items={[
              {
                href: "/explore",
                title: t("Programe & Antrenori", "Programs & Coaches"),
                subtitle: t("Descoperă programe sau introdu un cod", "Browse programs or join with a code"),
              },
              { href: "/history", title: t("Antrenamente", "Workouts"), subtitle: t("Istoricul tău complet", "Your full history") },
              { href: "/stats", title: t("Progres", "Progress"), subtitle: t("Grafice și evoluție în timp", "Charts and trends over time") },
              { href: "/records", title: t("Recorduri personale", "Personal records"), subtitle: t("Cele mai bune performanțe", "Your all-time bests") },
              { href: "/photos", title: t("Poze de progres", "Progress photos"), subtitle: t("Înainte și după, în timp", "Before and after, over time") },
              { href: "/meals", title: t("Nutriție", "Nutrition"), subtitle: t("Jurnal alimentar și calorii", "Food diary and calories") },
            ]}
          />
          <GoalSetting currentGoal={todayGoal} />
        </Stack>
      </Columns>
    </Screen>
  );
}
