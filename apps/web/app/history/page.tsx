import Link from "next/link";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Flame,
  MessageSquare,
  Pencil,
  Plus,
} from "lucide-react";
import { displayOrdinals } from "@/lib/set-numbering";
import { Text } from "@/app/components/language-provider";
import { WorkoutLabel } from "@/app/components/workout-label";
import { getLanguage } from "@/app/language";
import { CardioName, ExerciseName } from "@/app/components/exercise-name";
import { ExerciseGifButton } from "@/app/components/exercise-gif";
import { getWeightFormatter } from "@/app/units";
import { getSessionUser, serverApi } from "@/lib/api/server";
import { DeleteWorkoutButton } from "./delete-button";
import { SetTypeBadge } from "@/app/components/workout-parts";
import { WorkoutFeedbackThread } from "@/app/components/workout-feedback";
import type { FeedbackThreadItem } from "@/app/feedback/actions";
import type { FeedbackReaction } from "@/lib/coach/types";
import {
  Badge,
  Card,
  Columns,
  Empty,
  Eyebrow,
  Message,
  Screen,
  buttonClass,
  cx,
  iconButtonClass,
} from "@/app/components/ui";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const PAGE_SIZE = 6;

interface ApiWorkout {
  id: string;
  performedOn: string;
  split: string;
  workoutMode: "strength" | "cardio";
  sets: {
    id: string;
    exercise: string;
    setNumber: number;
    setType: string;
    weight: number;
    reps: number;
    rir: number | null;
    notes: string | null;
  }[];
  cardio: {
    id: string;
    activity: string;
    durationMin: number;
  }[];
}

interface ApiFeedbackItem {
  id: string;
  workoutId: string;
  authorId: string;
  authorName: string;
  isCoachAuthor: boolean;
  body: string;
  reaction: FeedbackReaction | null;
  createdAt: string;
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

function isoDaysAgo(base: Date, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

function topSetOf(sets: ApiWorkout["sets"]): ApiWorkout["sets"][number] | null {
  let best: ApiWorkout["sets"][number] | null = null;
  let bestScore = -1;
  for (const s of sets) {
    const w = Number(s.weight) || 0;
    const score = w > 0 ? w * (1 + s.reps / 30) : s.reps;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ startDate?: string; endDate?: string; page?: string }>;
}) {
  const { t, locale } = await getLanguage();
  const { format } = await getWeightFormatter(locale);

  const user = await getSessionUser();
  if (!user) {
    return (
      <Screen back={false} className="min-h-dvh justify-center text-center">
        <h1 className="text-[28px] font-bold tracking-[-0.03em]">
          <Text ro="Sesiune expirată" en="Session expired" />
        </h1>
        <p className="text-muted">
          <Text
            ro="Trebuie să te loghezi din nou pentru a vedea istoricul."
            en="Please sign in again to view your history."
          />
        </p>
        <Link href="/login" className={buttonClass({ className: "mx-auto" })}>
          <Text ro="Mergi la login" en="Go to sign in" />
        </Link>
      </Screen>
    );
  }

  const params = await searchParams;
  const today = new Date();
  const todayIso = today.toISOString().split("T")[0];
  const startDate = params.startDate || isoDaysAgo(today, 30);
  const endDate = params.endDate || todayIso;
  const parsedPage = Number(params.page);
  const currentPage = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  let pageRes: { items: ApiWorkout[]; total: number };
  let allDates: ApiWorkout[] = [];
  let enrollments: { status: string }[] = [];

  try {
    const query = new URLSearchParams({
      from: startDate,
      to: endDate,
      limit: String(PAGE_SIZE),
      offset: String((currentPage - 1) * PAGE_SIZE),
    });
    const [paged, allRes, enrollRes] = await Promise.all([
      serverApi<{ items: ApiWorkout[]; total: number }>(`/workouts?${query.toString()}`),
      serverApi<{ items: ApiWorkout[]; total: number }>("/workouts?limit=500"),
      serverApi<{ status: string }[]>("/explore/enrollments").catch(() => []),
    ]);
    pageRes = paged;
    allDates = allRes.items;
    enrollments = enrollRes;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return (
      <Screen title={<Text ro="Istoric antrenamente" en="Workout history" />}>
        <Message>
          <Text ro="Eroare la încărcare:" en="Database error:" /> {message}
        </Message>
      </Screen>
    );
  }

  const workouts = pageRes.items;
  const totalInRange = pageRes.total ?? 0;
  const streak = calculateWeeklyStreak(allDates);
  const totalPages = Math.ceil(totalInRange / PAGE_SIZE);
  const pageHref = (page: number) => `?${new URLSearchParams({ page: String(page), startDate, endDate })}`;

  const presets = [
    { label: t("7Z", "7D"), from: isoDaysAgo(today, 7) },
    { label: t("30Z", "30D"), from: isoDaysAgo(today, 30) },
    { label: t("90Z", "90D"), from: isoDaysAgo(today, 90) },
    { label: t("1A", "1Y"), from: isoDaysAgo(today, 365) },
  ];

  const hasActiveCoach = enrollments.some((e) => e.status === "active");
  const feedbackByWorkout = new Map<string, FeedbackThreadItem[]>();

  if (workouts.length > 0) {
    const threads = await Promise.all(
      workouts.map((w) =>
        serverApi<ApiFeedbackItem[]>(`/feedback/workouts/${encodeURIComponent(w.id)}`)
          .then((items) => ({ workoutId: w.id, items }))
          .catch(() => ({ workoutId: w.id, items: [] as ApiFeedbackItem[] })),
      ),
    );
    for (const { workoutId, items } of threads) {
      feedbackByWorkout.set(
        workoutId,
        items.map((row) => ({
          id: row.id,
          workoutId: row.workoutId,
          authorId: row.authorId,
          authorName: row.authorId === user.id ? t("Tu", "You") : row.authorName || t("Antrenor", "Coach"),
          isCoachAuthor: row.authorId !== user.id,
          body: row.body,
          reaction: row.reaction ?? null,
          createdAt: row.createdAt,
        })),
      );
    }
  }

  return (
    <Screen
      title={<Text ro="Istoric antrenamente" en="Workout history" />}
      right={
        <div className="flex items-center gap-2">
          {streak > 0 && (
            <Badge tone="coral" className="gap-1">
              <Flame className="size-3" />
              {streak} <Text ro="săpt." en="wk" />
            </Badge>
          )}
          <Link href="/insert" className={buttonClass({ small: true, className: "hidden sm:inline-flex" })}>
            <Plus className="size-3.5" strokeWidth={2.4} />
            <Text ro="Antrenament nou" en="Log workout" />
          </Link>
        </div>
      }
    >
      {/* Compact filter toolbar with quick range presets */}
      <form method="GET">
        <Card className="gap-3.5 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Eyebrow>{t("Perioadă rapidă", "Quick range")}</Eyebrow>
              <span className="font-mono text-[11px] font-semibold text-muted tabular-nums lg:hidden">
                {totalInRange} {t(totalInRange === 1 ? "sesiune" : "sesiuni", totalInRange === 1 ? "session" : "sessions")}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {presets.map((preset) => {
                const active = startDate === preset.from && endDate === todayIso;
                return (
                  <Link
                    key={preset.label}
                    href={`?${new URLSearchParams({ startDate: preset.from, endDate: todayIso })}`}
                    className={cx(
                      "inline-flex h-9 items-center justify-center rounded-sm border px-3 font-mono text-[12px] font-semibold transition-colors",
                      active
                        ? "border-transparent bg-lime text-on-solid"
                        : "border-card-border bg-inner text-soft hover:border-card-border-strong hover:text-foreground",
                    )}
                  >
                    {preset.label}
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-[130px] flex-1 flex-col gap-1 sm:flex-none">
              <label htmlFor="history-start" className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                <Text ro="De la" en="From" />
              </label>
              <input
                id="history-start"
                type="date"
                name="startDate"
                defaultValue={startDate}
                className="h-9 rounded-sm border border-card-border bg-inner px-2.5 font-mono text-[12px] text-foreground outline-none transition-colors hover:border-card-border-strong focus:border-lime"
              />
            </div>
            <div className="flex min-w-[130px] flex-1 flex-col gap-1 sm:flex-none">
              <label htmlFor="history-end" className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                <Text ro="Până la" en="To" />
              </label>
              <input
                id="history-end"
                type="date"
                name="endDate"
                defaultValue={endDate}
                className="h-9 rounded-sm border border-card-border bg-inner px-2.5 font-mono text-[12px] text-foreground outline-none transition-colors hover:border-card-border-strong focus:border-lime"
              />
            </div>
            <button type="submit" className={buttonClass({ variant: "secondary", small: true })}>
              <Text ro="Aplică" en="Apply" />
            </button>
          </div>
        </Card>
      </form>

      <div className="hidden items-center justify-between px-0.5 lg:flex">
        <Eyebrow>{t("Sesiuni înregistrate", "Logged sessions")}</Eyebrow>
        <span className="font-mono text-[11.5px] font-semibold text-muted tabular-nums">
          {totalInRange} {t(totalInRange === 1 ? "sesiune în interval" : "sesiuni în interval", totalInRange === 1 ? "session in range" : "sessions in range")}
        </span>
      </div>

      {!workouts.length ? (
        <Empty icon={Dumbbell}>
          <Text
            ro="Nu am găsit antrenamente în această perioadă."
            en="No workouts found for this period."
          />
        </Empty>
      ) : (
        <Columns>
          {workouts.map((workout) => {
            const isCardio = workout.workoutMode === "cardio";
            const date = new Date(`${workout.performedOn}T00:00:00`).toLocaleDateString(locale, {
              weekday: "short",
              day: "numeric",
              month: "short",
              year: "numeric",
            });
            const groupedSets: Record<string, ApiWorkout["sets"]> = {};
            let totalVolumeKg = 0;
            if (!isCardio) {
              for (const set of workout.sets ?? []) {
                (groupedSets[set.exercise] ??= []).push(set);
                if (Number(set.weight) > 0) {
                  totalVolumeKg += Number(set.weight) * Number(set.reps || 0);
                }
              }
            }
            const totalCardioMin = isCardio
              ? (workout.cardio ?? []).reduce((sum, c) => sum + Number(c.durationMin || 0), 0)
              : 0;
            const exerciseCount = Object.keys(groupedSets).length;
            const feedbackItems = feedbackByWorkout.get(workout.id) ?? [];

            return (
              <Card key={workout.id} padded={false}>
                <div className="flex items-start gap-2.5 px-5 py-4 pr-3">
                  <span
                    aria-hidden="true"
                    className={cx("mt-1.5 size-2.5 shrink-0 rounded-full", isCardio ? "bg-coral" : "bg-lime")}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="break-words text-[17px] font-bold tracking-[-0.02em]">
                        {isCardio ? t("Sesiune cardio", "Cardio session") : <WorkoutLabel value={workout.split} />}
                      </h2>
                      {feedbackItems.length > 0 && (
                        <Badge tone="ice" className="gap-1">
                          <MessageSquare className="size-3" />
                          {feedbackItems.length}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 font-mono text-[11.5px] text-muted">{date}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-soft tabular-nums">
                      {isCardio ? (
                        <span className="rounded-sm bg-coral-soft px-2 py-0.5 font-semibold text-coral-text">
                          {totalCardioMin} min
                        </span>
                      ) : (
                        <>
                          <span className="rounded-sm border border-card-border bg-inner px-2 py-0.5">
                            {workout.sets?.length ?? 0} {t("seturi", "sets")}
                          </span>
                          <span className="rounded-sm border border-card-border bg-inner px-2 py-0.5">
                            {exerciseCount} {t(exerciseCount === 1 ? "exercițiu" : "exerciții", exerciseCount === 1 ? "exercise" : "exercises")}
                          </span>
                          {totalVolumeKg > 0 && (
                            <span className="rounded-sm border border-card-border bg-inner px-2 py-0.5">
                              {format(Math.round(totalVolumeKg))}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Link
                      href={`/edit/${workout.id}`}
                      aria-label={t("Editează antrenament", "Edit workout")}
                      title={t("Editează antrenament", "Edit workout")}
                      className={iconButtonClass({ plain: true })}
                    >
                      <Pencil className="size-4" />
                    </Link>
                    <DeleteWorkoutButton id={workout.id} />
                  </div>
                </div>

                {isCardio
                  ? workout.cardio?.map((session) => (
                      <div
                        key={session.id}
                        className="flex items-center justify-between gap-3 border-t border-line px-5 py-3.5 transition-colors hover:bg-inner/40"
                      >
                        <span className="text-[14px] font-semibold">
                          <CardioName id={session.activity} />
                        </span>
                        <span className="font-mono text-[15px] font-bold text-coral-text tabular-nums">
                          {session.durationMin} <span className="font-sans text-[12px] font-normal text-muted">min</span>
                        </span>
                      </div>
                    ))
                  : Object.entries(groupedSets).map(([exercise, sets]) => {
                      const best = topSetOf(sets);
                      const ordinals = displayOrdinals(sets.map((x) => ({ exercise: x.exercise, order: x.setNumber })));
                      return (
                        <details key={exercise} className="group border-t border-line">
                          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-5 py-3 transition-colors hover:bg-inner/45 [&::-webkit-details-marker]:hidden">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[14px] font-semibold text-foreground">
                                <ExerciseName id={exercise} />
                              </p>
                              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-muted tabular-nums">
                                <span>
                                  {sets.length} {t(sets.length === 1 ? "set" : "seturi", sets.length === 1 ? "set" : "sets")}
                                </span>
                                {best && (
                                  <span className="text-soft">
                                    · {t("top", "best")}{" "}
                                    {Number(best.weight) > 0 ? `${format(Number(best.weight))} × ` : ""}
                                    {best.reps}
                                  </span>
                                )}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <ExerciseGifButton exercise={exercise} compact />
                              <ChevronDown className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
                            </div>
                          </summary>
                          <div className="mx-4 mb-3.5 flex flex-col overflow-hidden rounded-md border border-card-border bg-inner">
                            {sets.map((set, setIndex) => (
                              <div
                                key={set.id}
                                className="flex flex-col gap-1 border-b border-line px-3 py-2.5 last:border-0"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="w-5 font-mono text-[11.5px] font-semibold text-muted tabular-nums">
                                    #{ordinals[setIndex]}
                                  </span>
                                  <span className="font-mono text-[13.5px] font-bold tabular-nums">
                                    {set.weight > 0 ? `${format(Number(set.weight))} × ` : ""}
                                    {set.reps}
                                  </span>
                                  {set.rir !== null && (
                                    <span className="rounded-sm bg-card px-1.5 py-0.5 font-mono text-[10.5px] text-muted tabular-nums">
                                      RIR {set.rir}
                                    </span>
                                  )}
                                  <SetTypeBadge type={set.setType} />
                                </div>
                                {set.notes && <p className="break-words pl-7 text-[12.5px] text-muted">{set.notes}</p>}
                              </div>
                            ))}
                          </div>
                        </details>
                      );
                    })}

                {(feedbackItems.length > 0 || hasActiveCoach) && (
                  <div className="border-t border-line px-5 py-3">
                    <WorkoutFeedbackThread
                      workoutId={workout.id}
                      currentUserId={user.id}
                      initialItems={feedbackItems}
                      showReactions={false}
                      collapsible={feedbackItems.length === 0}
                      placeholderRo="Răspunde antrenorului..."
                      placeholderEn="Reply to your coach..."
                    />
                  </div>
                )}
              </Card>
            );
          })}
        </Columns>
      )}

      {totalPages > 1 && (
        <nav aria-label={t("Paginare", "Pagination")} className="mt-1 flex items-center justify-between gap-2">
          <Link
            href={pageHref(Math.max(1, currentPage - 1))}
            aria-disabled={currentPage <= 1}
            className={buttonClass({ variant: "secondary", small: true })}
          >
            <ChevronLeft className="size-4" />
            <Text ro="Înapoi" en="Back" />
          </Link>
          <span className="font-mono text-[12px] font-medium text-muted tabular-nums">
            {currentPage} / {totalPages}
          </span>
          <Link
            href={pageHref(Math.min(totalPages, currentPage + 1))}
            aria-disabled={currentPage >= totalPages}
            className={buttonClass({ variant: "secondary", small: true })}
          >
            <Text ro="Înainte" en="Next" />
            <ChevronRight className="size-4" />
          </Link>
        </nav>
      )}
    </Screen>
  );
}
