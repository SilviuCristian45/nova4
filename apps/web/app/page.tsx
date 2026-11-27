import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowUpRight,
  Award,
  BookOpen,
  Building2,
  Camera,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Compass,
  Dumbbell,
  Play,
  Plus,
  QrCode,
  Shield,
  Trophy,
  Utensils,
} from "lucide-react";
import { Text } from "@/app/components/language-provider";
import { getLanguage } from "@/app/language";
import { localDate } from "@/lib/daily-metrics";
import { getCurrentAuthRole } from "@/lib/coach/auth";
import { pickNextProgramWorkout } from "@/lib/coach/programs";
import { mondayOfWeek } from "@/lib/coach/interactions";
import { getSessionUser, serverApi } from "@/lib/api/server";
import type { ApiMyGymsResponse } from "@/lib/api/gym-types";
import { getDailySteps } from "./steps/steps";
import { getDailyGoal } from "./profiles/profile";
import { getUserTargets } from "./meals/action";
import StepsInput from "./components/steps-input";
import WeightInput from "./components/weight-input";
import CheckinCard from "./components/checkin-card";
import { Badge, Card, Eyebrow, ProgressBar, Screen, TextLink, buttonClass, cx } from "./components/ui";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ApiWorkoutItem {
  id: string;
  performedOn: string;
  split: string;
  workoutMode?: string;
  sets?: { id: string }[];
  cardio?: { id: string }[];
}

interface ApiWorkoutList {
  items: ApiWorkoutItem[];
  total: number;
}

interface ApiTodayMeal {
  id: string;
  items: {
    totalKcal: number;
    totalProteinG: number;
    totalCarbsG: number;
    totalFatG: number;
  }[];
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

function buildCurrentWeekDays(weekStartIso: string, todayIso: string, workoutDates: Set<string>, language: "ro" | "en") {
  const labels = language === "ro" ? ["L", "M", "M", "J", "V", "S", "D"] : ["M", "T", "W", "T", "F", "S", "S"];
  const start = new Date(`${weekStartIso}T00:00:00Z`);
  return labels.map((label, idx) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + idx);
    const iso = d.toISOString().slice(0, 10);
    return {
      iso,
      label,
      dayNum: d.getUTCDate(),
      done: workoutDates.has(iso),
      isToday: iso === todayIso,
      isFuture: iso > todayIso,
    };
  });
}

function formatRelativeWorkoutDay(performedOn: string, todayIso: string, t: (ro: string, en: string) => string): string {
  const a = Date.parse(`${performedOn}T00:00:00Z`);
  const b = Date.parse(`${todayIso}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return performedOn;
  const diffDays = Math.round((b - a) / 86_400_000);
  if (diffDays <= 0) return t("Azi", "Today");
  if (diffDays === 1) return t("Ieri", "Yesterday");
  if (diffDays < 7) return t(`acum ${diffDays} zile`, `${diffDays}d ago`);
  return performedOn;
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  if (params.history === "true" || params.page || params.startDate) {
    const query = new URLSearchParams();
    for (const key of ["startDate", "endDate", "page"]) if (params[key]) query.set(key, params[key]!);
    redirect(`/history${query.size ? `?${query}` : ""}`);
  }

  const { t, locale, language } = await getLanguage();
  const user = await getSessionUser();

  if (!user) {
    return (
      <Screen back={false} className="min-h-dvh justify-center text-center">
        <h1 className="text-[28px] font-bold tracking-[-0.03em]">
          <Text ro="Sesiune expirată" en="Session expired" />
        </h1>
        <p className="text-muted">
          <Text ro="Trebuie să te loghezi din nou pentru a continua." en="Please sign in again to continue." />
        </p>
        <Link href="/login" className={buttonClass({ className: "mx-auto" })}>
          <Text ro="Mergi la login" en="Go to sign in" />
        </Link>
      </Screen>
    );
  }

  const today = localDate();
  const weekStart = mondayOfWeek(today);

  const [
    workoutsRes,
    authRole,
    todaySteps,
    todayGoal,
    activeProgramRes,
    weeklyCheckins,
    activeMealPlans,
    gymMy,
    todayMeals,
    targetsRes,
  ] = await Promise.all([
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
    serverApi<ApiMyGymsResponse>("/gym/my").catch(() => ({ memberships: [], staffGyms: [] })),
    serverApi<ApiTodayMeal[]>(`/meals?date=${encodeURIComponent(today)}`).catch(() => []),
    getUserTargets().catch(() => ({ targets: null })),
  ]);

  const workoutItems = workoutsRes.items ?? [];
  const streak = calculateWeeklyStreak(workoutItems);
  const totalSessions = workoutsRes.total ?? workoutItems.length;
  const workoutDateSet = new Set(workoutItems.map((w) => w.performedOn));
  const weekDays = buildCurrentWeekDays(weekStart, today, workoutDateSet, language);
  const workoutsThisWeek = weekDays.filter((d) => d.done).length;
  const trainedToday = workoutDateSet.has(today);
  const lastWorkout = workoutItems[0] ?? null;

  let todayKcal = 0;
  let todayProtein = 0;
  let todayCarbs = 0;
  let todayFat = 0;
  for (const meal of todayMeals) {
    for (const item of meal.items ?? []) {
      todayKcal += Number(item.totalKcal) || 0;
      todayProtein += Number(item.totalProteinG) || 0;
      todayCarbs += Number(item.totalCarbsG) || 0;
      todayFat += Number(item.totalFatG) || 0;
    }
  }
  todayKcal = Math.round(todayKcal);
  todayProtein = Math.round(todayProtein);
  todayCarbs = Math.round(todayCarbs);
  todayFat = Math.round(todayFat);
  const targetKcal = Number(targetsRes.targets?.kcal) || 0;
  const kcalPct = targetKcal > 0 ? Math.min(100, Math.round((todayKcal / targetKcal) * 100)) : 0;
  const kcalOver = targetKcal > 0 && todayKcal > targetKcal;

  const name = authRole?.displayName?.trim();
  const isCoach = authRole?.role === "coach";
  const hasGymStaff = gymMy.staffGyms.length > 0;
  const primaryGymMembership = gymMy.memberships[0] ?? null;
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

  const quickExplore = [
    {
      href: "/records",
      icon: Trophy,
      tone: "gold" as const,
      title: t("Recorduri", "Records"),
      subtitle: t("PR-uri & 1RM", "PRs & 1RM"),
    },
    {
      href: "/exercises",
      icon: BookOpen,
      tone: "ice" as const,
      title: t("Exerciții", "Exercises"),
      subtitle: t("Demonstrații GIF", "GIF demos"),
    },
    {
      href: "/photos",
      icon: Camera,
      tone: "lilac" as const,
      title: t("Poze progres", "Photos"),
      subtitle: t("Înainte & după", "Before & after"),
    },
    {
      href: "/explore",
      icon: Compass,
      tone: "lime" as const,
      title: t("Programe", "Programs"),
      subtitle: t("Antrenori & cod", "Coaches & codes"),
    },
    {
      href: "/gym",
      icon: QrCode,
      tone: "coral" as const,
      title: t("Sală & QR", "Gym & QR"),
      subtitle: t("Acces & abonament", "Pass & check-in"),
    },
  ];

  return (
    <Screen back={false}>
      {/* Editorial top header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Eyebrow>
            {new Date().toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })}
          </Eyebrow>
          <h1 className="text-[28px] font-bold leading-[1.1] tracking-[-0.035em] sm:text-[34px]">
            {name ? `${t("Salut", "Welcome back")}, ${name}` : t("Gata de antrenament?", "Ready to train?")}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {user.isSuperAdmin && (
            <Link href="/admin" className={buttonClass({ variant: "soft", tone: "lilac", small: true })}>
              <Shield className="size-3.5" />
              <Text ro="Admin" en="Admin" />
            </Link>
          )}
          {hasGymStaff && (
            <Link href="/gym/manage" className={buttonClass({ variant: "soft", tone: "coral", small: true })}>
              <Building2 className="size-3.5" />
              <Text ro="Recepție" en="Gym desk" />
            </Link>
          )}
          {isCoach && (
            <Link href="/coach" className={buttonClass({ variant: "soft", tone: "lime", small: true })}>
              <Award className="size-3.5" />
              <Text ro="Studio Antrenor" en="Coach" />
            </Link>
          )}
          <Link href="/insert" className={buttonClass({ small: true, className: "hidden sm:inline-flex" })}>
            <Plus className="size-4" strokeWidth={2.4} />
            <Text ro="Antrenament nou" en="Log workout" />
          </Link>
        </div>
      </header>

      {/* 7-day athletic telemetry ribbon */}
      <Card className="gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Eyebrow>{t("Activitate săptămâna aceasta", "This week's rhythm")}</Eyebrow>
            <span className="font-mono text-[11px] font-semibold text-lime-text tabular-nums">
              {workoutsThisWeek}/7
            </span>
          </div>
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
            {weekDays.map((day) => (
              <div key={day.iso} className="flex flex-col items-center gap-1">
                <span className="font-mono text-[10px] font-medium text-muted">{day.label}</span>
                <span
                  title={day.iso}
                  className={cx(
                    "flex size-8 items-center justify-center rounded-sm border font-mono text-[11.5px] font-semibold tabular-nums transition-colors sm:size-9",
                    day.done
                      ? "border-transparent bg-lime text-on-solid"
                      : day.isToday
                        ? "border-lime-border bg-lime-soft text-lime-text"
                        : day.isFuture
                          ? "border-card-border bg-transparent text-placeholder"
                          : "border-card-border bg-inner text-muted",
                  )}
                >
                  {day.dayNum}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 border-t border-card-border pt-3.5 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-6">
          <div className="flex flex-col gap-0.5">
            <Eyebrow>{t("Săpt.", "Week")}</Eyebrow>
            <span className="text-[22px] font-bold leading-tight tracking-[-0.03em] tabular-nums">
              {workoutsThisWeek}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <Eyebrow>{t("Serie", "Streak")}</Eyebrow>
            <span className="flex items-baseline gap-1 text-[22px] font-bold leading-tight tracking-[-0.03em] tabular-nums">
              {streak}
              <span className="font-mono text-[11px] font-medium text-muted">{t("săpt.", "wk")}</span>
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <Eyebrow>{t("Total", "Total")}</Eyebrow>
            <span className="text-[22px] font-bold leading-tight tracking-[-0.03em] tabular-nums">
              {totalSessions}
            </span>
          </div>
        </div>
      </Card>

      {/* Primary Hero Bento: Training Command (7 cols) + Fuel & Active Passes (5 cols) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-7 lg:gap-5">
          {assignedProgram ? (
            <Card className="relative overflow-hidden">
              <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3.5px] bg-lime" />
              <div className="flex flex-wrap items-start justify-between gap-2 pl-1">
                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.09em] text-lime-text">
                    <ClipboardList className="size-3.5" />
                    <Text ro="Programul tău activ" en="Active program" />
                  </span>
                  <h2 className="text-[22px] font-bold leading-tight tracking-[-0.03em]">
                    {assignedProgram.programTitle}
                  </h2>
                  <p className="text-[12.5px] text-muted">
                    {t("Antrenor", "Coach")}: <span className="font-medium text-soft">{assignedProgram.coachName}</span>
                  </p>
                </div>
                <Badge tone="lime">
                  {t("SĂPT.", "WK")} {assignedProgram.currentWeek}
                </Badge>
              </div>

              {assignedProgram.nextWorkout ? (
                <div className="ml-1 flex flex-col gap-3 rounded-md border border-card-border bg-inner p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <Eyebrow>{t("Următorul antrenament", "Next session")}</Eyebrow>
                      <p className="mt-0.5 text-[16px] font-bold tracking-[-0.02em]">
                        {assignedProgram.nextWorkout.title}
                      </p>
                      <p className="font-mono text-[11.5px] text-muted">
                        {t("S", "W")}
                        {assignedProgram.nextWorkout.week_number}·{t("Z", "D")}
                        {assignedProgram.nextWorkout.day_number} · {assignedProgram.nextWorkout.itemCount}{" "}
                        {assignedProgram.nextWorkout.workout_mode === "cardio"
                          ? t("activități", "activities")
                          : t("exerciții", "exercises")}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/insert?programWorkoutId=${assignedProgram.nextWorkout.id}&enrollmentId=${assignedProgram.enrollmentId}`}
                      className={buttonClass({ small: true })}
                    >
                      <Play className="size-3.5" />
                      <Text ro="Pornește din program" en="Start program workout" />
                    </Link>
                    <Link href="/insert" className={buttonClass({ variant: "secondary", small: true })}>
                      <Text ro="Antrenament liber" en="Free workout" />
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="ml-1 flex flex-wrap items-center justify-between gap-3 rounded-md border border-card-border bg-inner p-4">
                  <p className="text-sm text-muted">
                    <Text
                      ro="Antrenorul nu a adăugat încă zile în acest program."
                      en="Your coach hasn't added workout days to this program yet."
                    />
                  </p>
                  <Link href="/insert" className={buttonClass({ small: true })}>
                    <Plus className="size-4" />
                    <Text ro="Antrenament liber" en="Start workout" />
                  </Link>
                </div>
              )}

              {assignedProgram.otherWorkouts.length > 0 && (
                <details className="ml-1 text-sm">
                  <summary className="text-[12.5px] font-semibold text-soft transition-colors hover:text-foreground">
                    <Text ro="Alege altă zi din program" en="Choose another program day" />
                  </summary>
                  <div className="mt-2 flex flex-col gap-1">
                    {assignedProgram.otherWorkouts.map((day) => (
                      <Link
                        key={day.id}
                        href={`/insert?programWorkoutId=${day.id}&enrollmentId=${assignedProgram.enrollmentId}`}
                        className="flex items-center justify-between rounded-sm border border-card-border bg-inner px-3 py-2 text-[12.5px] font-medium transition-colors hover:border-card-border-strong hover:bg-control"
                      >
                        <span>
                          <span className="font-mono text-muted">
                            {t("S", "W")}
                            {day.week_number}·{t("Z", "D")}
                            {day.day_number}
                          </span>{" "}
                          — {day.title}
                        </span>
                        <ChevronRight className="size-3.5 text-muted" />
                      </Link>
                    ))}
                  </div>
                </details>
              )}
            </Card>
          ) : (
            <Card className="relative justify-between overflow-hidden">
              <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3.5px] bg-lime" />
              <div className="flex flex-col gap-3 pl-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.09em] text-lime-text">
                    <Dumbbell className="size-3.5" />
                    <Text ro="Sesiune de antrenament" en="Training session" />
                  </span>
                  {trainedToday && <Badge tone="lime">{t("Completat azi", "Done today")}</Badge>}
                </div>

                <div className="flex flex-col gap-1">
                  <h2 className="text-[24px] font-bold leading-tight tracking-[-0.03em] sm:text-[26px]">
                    {trainedToday
                      ? t("Încă o sesiune sau cardio?", "Ready for a second session?")
                      : t("Începe antrenamentul de azi", "Start today's training")}
                  </h2>
                  <p className="text-[13.5px] text-soft">
                    {lastWorkout ? (
                      <>
                        {t("Ultima sesiune:", "Last session:")}{" "}
                        <span className="font-semibold text-foreground">{lastWorkout.split}</span> ·{" "}
                        <span className="font-mono text-[12.5px] text-muted">
                          {formatRelativeWorkoutDay(lastWorkout.performedOn, today, t)}
                        </span>
                        {lastWorkout.sets && lastWorkout.sets.length > 0 && (
                          <span className="font-mono text-[12.5px] text-muted">
                            {" "}
                            · {lastWorkout.sets.length} {t("seturi", "sets")}
                          </span>
                        )}
                      </>
                    ) : (
                      <Text
                        ro="Înregistrează seturi, greutăți, RIR și cardio cu detecție automată de PR."
                        en="Log sets, loads, RIR, and cardio with automatic PR and plateau tracking."
                      />
                    )}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 pl-1 pt-2">
                <Link href="/insert" className={buttonClass()}>
                  <Plus className="size-4" strokeWidth={2.4} />
                  <Text ro="Începe antrenamentul" en="Start workout" />
                </Link>
                <Link href="/history" className={buttonClass({ variant: "secondary" })}>
                  <Text ro="Istoric" en="History" />
                  <ArrowUpRight className="size-4 text-muted" />
                </Link>
              </div>
            </Card>
          )}

          {hasActiveCoach && (
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.09em] text-lilac-text">
                    <ClipboardCheck className="size-3.5" />
                    <Text ro="Check-in săptămânal" en="Weekly check-in" />
                  </span>
                  <p className="text-[14.5px] font-semibold">
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
                className={buttonClass({ variant: weeklyCheckinRow ? "secondary" : "primary", small: true, className: "w-fit" })}
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
        </div>

        {/* Right 5 cols: Today's Nutrition + Active Gym Pass */}
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-5 lg:gap-5">
          <Card className="justify-between">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <Eyebrow>{t("Nutriție azi", "Fuel today")}</Eyebrow>
                <TextLink href="/meals">{t("Deschide", "Open")}</TextLink>
              </div>

              <div className="flex items-baseline gap-2">
                <span className="text-[36px] font-bold leading-none tracking-[-0.04em] tabular-nums sm:text-[38px]">
                  {todayKcal.toLocaleString(locale)}
                </span>
                <span className="font-mono text-[12.5px] font-medium text-muted tabular-nums">
                  {targetKcal > 0 ? `/ ${targetKcal.toLocaleString(locale)} kcal` : "kcal"}
                </span>
              </div>

              {targetKcal > 0 && <ProgressBar value={kcalPct} tone={kcalOver ? "red" : "lime"} />}

              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col gap-0.5 rounded-sm border border-card-border bg-inner px-2.5 py-2">
                  <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.05em] text-muted">
                    <span className="size-1.5 rounded-full bg-coral" />
                    {t("Prot.", "Protein")}
                  </span>
                  <span className="font-mono text-[14px] font-bold tabular-nums">{todayProtein}g</span>
                </div>
                <div className="flex flex-col gap-0.5 rounded-sm border border-card-border bg-inner px-2.5 py-2">
                  <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.05em] text-muted">
                    <span className="size-1.5 rounded-full bg-ice" />
                    {t("Carbo.", "Carbs")}
                  </span>
                  <span className="font-mono text-[14px] font-bold tabular-nums">{todayCarbs}g</span>
                </div>
                <div className="flex flex-col gap-0.5 rounded-sm border border-card-border bg-inner px-2.5 py-2">
                  <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.05em] text-muted">
                    <span className="size-1.5 rounded-full bg-gold" />
                    {t("Grăs.", "Fat")}
                  </span>
                  <span className="font-mono text-[14px] font-bold tabular-nums">{todayFat}g</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-card-border pt-3">
              <Link href="/meals/insert" className={buttonClass({ variant: "secondary", small: true })}>
                <Utensils className="size-3.5" />
                <Text ro="Adaugă masă" en="Add meal" />
              </Link>
              {activeMealPlanRow ? (
                <TextLink href="/meals/plan" tone="lime">
                  {t("Plan activ", "Meal plan")}
                </TextLink>
              ) : (
                <span className="font-mono text-[11px] text-muted tabular-nums">
                  {todayMeals.length}{" "}
                  {t(todayMeals.length === 1 ? "masă" : "mese", todayMeals.length === 1 ? "meal" : "meals")}
                </span>
              )}
            </div>
          </Card>

          {primaryGymMembership && (
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.09em] text-coral-text">
                    <Building2 className="size-3.5" />
                    <Text ro="Acces sală" en="Gym pass" />
                  </span>
                  <h2 className="text-[17px] font-bold tracking-[-0.02em]">{primaryGymMembership.gymName}</h2>
                  <p className="text-[12.5px] text-muted">
                    {primaryGymMembership.subscription
                      ? primaryGymMembership.subscription.planType === "session_pack"
                        ? `${primaryGymMembership.subscription.planName} · ${primaryGymMembership.subscription.sessionsRemaining ?? 0} ${t("ședințe rămase", "sessions left")}`
                        : `${primaryGymMembership.subscription.planName} · ${primaryGymMembership.subscription.daysLeft ?? 0} ${t("zile rămase", "days left")}`
                      : t("Fără abonament activ", "No active subscription")}
                  </p>
                </div>
                <Badge tone={primaryGymMembership.subscription?.status === "active" ? "lime" : "red"}>
                  {primaryGymMembership.subscription?.status === "active" ? t("Activ", "Active") : t("Inactiv", "Inactive")}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href="/gym/scan" className={buttonClass({ small: true })}>
                  <QrCode className="size-3.5" />
                  <Text ro="Check-in QR" en="QR Check-in" />
                </Link>
                <Link href="/gym" className={buttonClass({ variant: "secondary", small: true })}>
                  <Text ro="Detalii" en="Details" />
                </Link>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Daily Telemetry Instruments: 3-column aligned strip */}
      <section aria-label={t("Metrici zilnice", "Daily telemetry")} className="flex flex-col gap-3">
        <Eyebrow>{t("Telemetrie zilnică", "Daily telemetry")}</Eyebrow>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 lg:gap-5">
          <StepsInput initialSteps={todaySteps} date={today} goal={todayGoal} />
          <WeightInput />
          <CheckinCard />
        </div>
      </section>

      {/* Compact Quick Explore Grid (replaces legacy 8-row LinkList) */}
      <section aria-label={t("Acces rapid", "Quick access")} className="flex flex-col gap-3">
        <Eyebrow>{t("Module rapide", "Quick modules")}</Eyebrow>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {quickExplore.map((tile) => {
            const Icon = tile.icon;
            const iconTint =
              tile.tone === "lime"
                ? "bg-lime-soft text-lime-text border-lime-border"
                : tile.tone === "coral"
                  ? "bg-coral-soft text-coral-text border-coral-border"
                  : tile.tone === "ice"
                    ? "bg-ice-soft text-ice-text border-ice-border"
                    : tile.tone === "lilac"
                      ? "bg-lilac-soft text-lilac-text border-lilac-border"
                      : "bg-gold-soft text-gold-text border-gold-border";
            return (
              <Link
                key={tile.href}
                href={tile.href}
                className="surface-card group flex flex-col gap-3 rounded-lg border border-card-border bg-card p-4 transition-colors hover:border-card-border-strong hover:bg-inner/40 active:scale-[0.99]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cx("flex size-9 items-center justify-center rounded-md border", iconTint)}>
                    <Icon className="size-4" strokeWidth={2} />
                  </span>
                  <ArrowUpRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[14px] font-semibold tracking-[-0.01em] text-foreground">{tile.title}</span>
                  <span className="text-[12px] text-muted">{tile.subtitle}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </Screen>
  );
}
