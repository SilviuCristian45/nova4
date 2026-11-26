import { displayOrdinals } from "@/lib/set-numbering";
import { Text } from "@/app/components/language-provider";
import { WorkoutLabel } from "@/app/components/workout-label";
import { getLanguage } from "@/app/language";
import { CardioName, ExerciseName } from "@/app/components/exercise-name";
import { getWeightFormatter } from "@/app/units";
import Link from "next/link";
import { Dumbbell, ChevronDown, Flame, ChevronLeft, ChevronRight, MessageSquare, Pencil } from "lucide-react";
import { getSessionUser, serverApi } from "@/lib/api/server";
import { DeleteWorkoutButton } from "./delete-button";
import { SetTypeBadge } from "@/app/components/workout-parts";
import { WorkoutFeedbackThread } from "@/app/components/workout-feedback";
import type { FeedbackThreadItem } from "@/app/feedback/actions";
import type { FeedbackReaction } from "@/lib/coach/types";
import { Badge, Card, Columns, Empty, Field, Message, Screen, buttonClass, iconButtonClass, inputClass } from "@/app/components/ui";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const PAGE_SIZE = 5;

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
        <h1 className="text-[28px] font-bold tracking-[-0.8px]">
          <Text ro="Sesiune expirată" en="Session expired" />
        </h1>
        <p className="text-muted">
          <Text
            ro="Trebuie să te loghezi din nou pentru a vedea istoricul."
            en="Please sign in again to view your history."
          />
        </p>
        <Link href="/login" className={buttonClass()}>
          <Text ro="Mergi la login" en="Go to sign in" />
        </Link>
      </Screen>
    );
  }

  const params = await searchParams;
  const today = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(today.getDate() - 30);
  const startDate = params.startDate || thirtyDaysAgo.toISOString().split("T")[0];
  const endDate = params.endDate || today.toISOString().split("T")[0];
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
      <Screen title={<Text ro="Istoric" en="History" />}>
        <Message>
          <Text ro="Eroare la încărcare:" en="Database error:" /> {message}
        </Message>
      </Screen>
    );
  }

  const workouts = pageRes.items;
  const streak = calculateWeeklyStreak(allDates);
  const totalPages = Math.ceil((pageRes.total ?? 0) / PAGE_SIZE);
  const pageHref = (page: number) => `?${new URLSearchParams({ page: String(page), startDate, endDate })}`;

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
      title={<Text ro="Istoric" en="History" />}
      right={
        streak > 0 ? (
          <Badge tone="coral" className="gap-1 text-[13px]">
            <Flame className="size-3.5" />
            {streak} <Text ro="săpt." en="wk" />
          </Badge>
        ) : undefined
      }
    >
      <form method="GET">
        <Card>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label={<Text ro="De la" en="From" />} htmlFor="history-start">
              <input id="history-start" type="date" name="startDate" defaultValue={startDate} className={inputClass()} />
            </Field>
            <Field label={<Text ro="Până la" en="To" />} htmlFor="history-end">
              <input id="history-end" type="date" name="endDate" defaultValue={endDate} className={inputClass()} />
            </Field>
          </div>
          <button type="submit" className={buttonClass({ variant: "secondary" })}>
            <Text ro="Aplică filtrele" en="Apply filters" />
          </button>
        </Card>
      </form>

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
            if (!isCardio) {
              for (const set of workout.sets ?? []) {
                (groupedSets[set.exercise] ??= []).push(set);
              }
            }
            const feedbackItems = feedbackByWorkout.get(workout.id) ?? [];
            return (
              <Card key={workout.id} padded={false}>
                <div className="flex items-center gap-2 py-3 pl-[18px] pr-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="break-words text-[17px] font-semibold">
                        {isCardio ? t("Sesiune cardio", "Cardio session") : <WorkoutLabel value={workout.split} />}
                      </h2>
                      {feedbackItems.length > 0 && (
                        <Badge tone="ice" className="gap-1">
                          <MessageSquare className="size-3" />
                          <Text ro="Feedback" en="Feedback" /> ({feedbackItems.length})
                        </Badge>
                      )}
                    </div>
                    <p className="text-[13px] text-muted">
                      {date}
                      {!isCardio && (
                        <>
                          {" "}
                          · <span className="tabular-nums">{workout.sets?.length ?? 0}</span>{" "}
                          <Text ro="seturi" en="sets" />
                        </>
                      )}
                    </p>
                  </div>
                  <Link
                    href={`/edit/${workout.id}`}
                    aria-label={t("Editează antrenament", "Edit workout")}
                    title={t("Editează antrenament", "Edit workout")}
                    className={iconButtonClass({ plain: true })}
                  >
                    <Pencil className="size-5" />
                  </Link>
                  <DeleteWorkoutButton id={workout.id} />
                </div>
                {isCardio
                  ? workout.cardio?.map((session) => (
                      <div
                        key={session.id}
                        className="flex items-center justify-between gap-3 border-t border-line px-[18px] py-3.5"
                      >
                        <span className="font-medium">
                          <CardioName id={session.activity} />
                        </span>
                        <span className="text-[17px] font-semibold text-coral-text tabular-nums">
                          {session.durationMin} <span className="text-[13px] font-normal text-muted">min</span>
                        </span>
                      </div>
                    ))
                  : Object.entries(groupedSets).map(([exercise, sets]) => (
                      <details key={exercise} className="group border-t border-line">
                        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-[18px] py-3 [&::-webkit-details-marker]:hidden">
                          <span className="font-medium">
                            <ExerciseName id={exercise} />{" "}
                            <span className="font-normal text-muted">
                              · {sets.length} <Text ro="seturi" en="sets" />
                            </span>
                          </span>
                          <ChevronDown className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
                        </summary>
                        <div className="mx-[18px] mb-3 flex flex-col rounded-md bg-inner">
                          {sets.map((set, setIndex) => (
                            <div
                              key={set.id}
                              className="flex flex-col gap-1 border-b border-line px-3 py-2.5 last:border-0"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="w-5 text-sm text-muted tabular-nums">
                                  {displayOrdinals(sets.map((x) => ({ exercise: x.exercise, order: x.setNumber })))[
                                    setIndex
                                  ]}
                                </span>
                                <span className="font-semibold tabular-nums">
                                  {set.weight > 0 ? `${format(Number(set.weight))} × ` : ""}
                                  {set.reps}
                                </span>
                                {set.rir !== null && <span className="text-[13px] text-muted">RIR {set.rir}</span>}
                                <SetTypeBadge type={set.setType} />
                              </div>
                              {set.notes && <p className="break-words pl-7 text-[13px] text-muted">{set.notes}</p>}
                            </div>
                          ))}
                        </div>
                      </details>
                    ))}
                {(feedbackItems.length > 0 || hasActiveCoach) && (
                  <div className="border-t border-line px-[18px] py-3">
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
        <nav aria-label={t("Paginare", "Pagination")} className="mt-2 flex items-center justify-between gap-2">
          <Link
            href={pageHref(Math.max(1, currentPage - 1))}
            aria-disabled={currentPage <= 1}
            className={buttonClass({ variant: "secondary", small: true })}
          >
            <ChevronLeft className="size-4" />
            <Text ro="Înapoi" en="Back" />
          </Link>
          <span className="text-sm text-muted tabular-nums">
            <Text ro="Pagina" en="Page" /> {currentPage} <Text ro="din" en="of" /> {totalPages}
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
