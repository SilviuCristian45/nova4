import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Dumbbell,
  Settings,
  Trophy,
  UserPlus,
  Users,
  Utensils,
} from "lucide-react";
import { Text } from "@/app/components/language-provider";
import { getLanguage } from "@/app/language";
import { getWeightFormatter } from "@/app/units";
import { getOwnCoachProfile, requireCoach } from "@/lib/coach/auth";
import { DEFAULT_ADHERENCE_DAYS, averageRir } from "@/lib/coach/analytics";
import { serverApi } from "@/lib/api/server";
import { exerciseName } from "@/lib/exercise-catalog";
import { WorkoutLabel } from "@/app/components/workout-label";
import { CoachCheckinReviewList, type CoachCheckinItem } from "@/app/components/coach-checkin-review";
import { WorkoutFeedbackThread } from "@/app/components/workout-feedback";
import type { FeedbackThreadItem } from "@/app/feedback/actions";
import type { CheckinPhotoUrls, FeedbackReaction } from "@/lib/coach/types";
import {
  Badge,
  BigNumber,
  Card,
  CardTitle,
  Columns,
  CtaCard,
  Empty,
  Screen,
  Stack,
  TextLink,
  buttonClass,
} from "@/app/components/ui";
import { PendingRequestsCard, type PendingRequestItem } from "./pending-requests-card";

export const dynamic = "force-dynamic";

interface ApiCoachDashboard {
  activeClientsCount: number;
  pendingRequestsCount: number;
  unreviewedCheckinsCount: number;
  programsCount: number;
  publishedProgramsCount: number;
  mealPlansCount: number;
  pendingRequests: {
    id: string;
    clientId: string;
    clientName: string | null;
    programTitle: string | null;
    createdAt: string;
  }[];
  unreviewedCheckins: {
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
    clientName: string | null;
    createdAt?: string;
    updatedAt?: string;
  }[];
  pausedAlerts: { clientId: string; name: string | null; days: number; lastDate: string }[];
  newNoWorkouts: { clientId: string; name: string | null; daysSinceStart: number; overdue: boolean }[];
  recentWorkouts: {
    id: string;
    userId: string;
    clientName: string | null;
    performedOn: string;
    split: string;
    workoutMode: string;
    createdAt: string;
    sets: {
      exercise: string;
      weight: number;
      reps: number;
      rir: number | null;
      setType: string;
      isPr: boolean;
    }[];
    cardio: { activity: string; durationMin: number }[];
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
}

export default async function CoachHomePage() {
  const { t, locale, language } = await getLanguage();
  const { format } = await getWeightFormatter(locale);
  const coach = await requireCoach();

  const [coachProfile, dash] = await Promise.all([
    getOwnCoachProfile(coach.userId),
    serverApi<ApiCoachDashboard>("/coach/dashboard"),
  ]);

  const labelClient = (id: string, name: string | null) => name?.trim() || `${t("Client", "Client")} #${id.slice(0, 6)}`;
  const coachName = coachProfile?.display_name ?? coach.displayName ?? t("Antrenor", "Coach");

  const pendingItems: PendingRequestItem[] = dash.pendingRequests.map((e) => ({
    id: e.id,
    clientId: e.clientId,
    clientName: labelClient(e.clientId, e.clientName),
    programTitle: e.programTitle || t("Program", "Program"),
    createdAt: e.createdAt,
  }));

  const unreviewedCheckins: CoachCheckinItem[] = dash.unreviewedCheckins.map((item) => ({
    id: item.id,
    client_id: item.clientId,
    coach_id: item.coachId,
    enrollment_id: item.enrollmentId,
    week_start: item.weekStart,
    weight_kg: item.weightKg,
    energy: item.energy,
    sleep: item.sleep,
    stress: item.stress,
    client_notes: item.clientNotes,
    coach_reply: item.coachReply,
    reviewed_at: item.reviewedAt,
    photo_front_path: item.photoFrontPath,
    photo_back_path: item.photoBackPath,
    photo_side_path: item.photoSidePath,
    created_at: item.createdAt ?? item.weekStart,
    updated_at: item.updatedAt ?? item.weekStart,
    photoUrls: item.photoUrls ?? {},
    clientName: labelClient(item.clientId, item.clientName),
  }));

  const pausedAlerts = dash.pausedAlerts.map((a) => ({
    ...a,
    name: labelClient(a.clientId, a.name),
  }));
  const newNoWorkouts = dash.newNoWorkouts.map((a) => ({
    ...a,
    name: labelClient(a.clientId, a.name),
  }));

  return (
    <Screen
      title={<Text ro="Zona Antrenor" en="Coach Studio" />}
      right={
        <div className="flex items-center gap-2">
          <Link href="/coach/clients" className={buttonClass({ variant: "secondary", small: true })}>
            <Users className="size-4" />
            <Text ro="Clienți" en="Clients" />
          </Link>
          <Link href="/settings" aria-label={t("Setări", "Settings")} className={buttonClass({ variant: "secondary", small: true })}>
            <Settings className="size-4" />
          </Link>
        </div>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {t("Salut", "Hi")}, <span className="font-semibold text-foreground">{coachName}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/coach/programs" className={buttonClass({ variant: "outline", small: true })}>
            <ClipboardList className="size-4" />
            <Text ro="Programe" en="Programs" /> ({dash.programsCount})
          </Link>
          <Link href="/coach/meal-plans" className={buttonClass({ variant: "outline", small: true })}>
            <Utensils className="size-4" />
            <Text ro="Planuri alimentare" en="Meal plans" /> ({dash.mealPlansCount})
          </Link>
          <Link href="/coach/programs/new" className={buttonClass({ small: true })}>
            <Text ro="+ Program nou" en="+ New program" />
          </Link>
          <Link href="/coach/meal-plans/new" className={buttonClass({ variant: "secondary", small: true })}>
            <Text ro="+ Plan alimentar" en="+ Meal plan" />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <span className="text-[13px] font-medium text-muted">
            <Text ro="Clienți activi" en="Active clients" />
          </span>
          <BigNumber value={dash.activeClientsCount} />
          <TextLink href="/coach/clients?status=active">
            <Text ro="Vezi clienții" en="View clients" />
          </TextLink>
        </Card>
        <Card tone={pendingItems.length > 0 ? "gold" : undefined}>
          <span className="text-[13px] font-medium text-muted">
            <Text ro="Cereri în așteptare" en="Pending requests" />
          </span>
          <BigNumber value={pendingItems.length} />
          <TextLink href="/coach/clients?status=pending" tone={pendingItems.length > 0 ? "gold" : "lime"}>
            <Text ro="Gestionează cereri" en="Manage requests" />
          </TextLink>
        </Card>
        <Card tone={unreviewedCheckins.length > 0 ? "lilac" : undefined}>
          <span className="text-[13px] font-medium text-muted">
            <Text ro="Check-in-uri noi" en="Unreviewed check-ins" />
          </span>
          <BigNumber value={unreviewedCheckins.length} />
          <span className="text-xs font-medium text-soft">
            <Text ro="Răspuns rapid mai jos" en="Quick reply below" />
          </span>
        </Card>
        <Card>
          <span className="text-[13px] font-medium text-muted">
            <Text ro="Programe publicate" en="Published programs" />
          </span>
          <BigNumber value={dash.publishedProgramsCount} unit={`/ ${dash.programsCount}`} />
          <TextLink href="/coach/programs">
            <Text ro="Deschide programele" en="Open programs" />
          </TextLink>
        </Card>
      </div>

      <PendingRequestsCard requests={pendingItems} />

      {unreviewedCheckins.length > 0 && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle
              description={
                <Text
                  ro="Răspunde rapid la check-in-urile săptămânale trimise de clienții activi."
                  en="Reply quickly to weekly check-ins submitted by active clients."
                />
              }
            >
              <span className="flex items-center gap-2">
                <ClipboardCheck className="size-5 text-lilac-text" />
                <Text ro="Check-in-uri săptămânale nerevizuite" en="Unreviewed weekly check-ins" />
              </span>
            </CardTitle>
            <Badge tone="lilac">{unreviewedCheckins.length}</Badge>
          </div>
          <CoachCheckinReviewList items={unreviewedCheckins} showClientLink />
        </Card>
      )}

      <Columns>
        <Stack>
          <Card>
            <div className="flex items-center justify-between gap-2">
              <CardTitle
                description={
                  <Text
                    ro={`Clienți activi fără antrenament de cel puțin ${DEFAULT_ADHERENCE_DAYS} zile vs. clienți nou-înscriși.`}
                    en={`Active clients inactive for ${DEFAULT_ADHERENCE_DAYS}+ days vs. newly enrolled clients.`}
                  />
                }
              >
                <span className="flex items-center gap-2">
                  <AlertTriangle className="size-5 text-gold-text" />
                  <Text ro="Alerte aderență" en="Adherence alerts" />
                </span>
              </CardTitle>
            </div>

            {pausedAlerts.length === 0 && newNoWorkouts.length === 0 ? (
              <p className="rounded-md bg-inner px-3.5 py-3 text-sm text-soft">
                {dash.activeClientsCount === 0 ? (
                  <Text ro="Nu ai încă clienți activi." en="You have no active clients yet." />
                ) : (
                  <Text ro="Toți clienții activi sunt la zi cu antrenamentele." en="All active clients are on track with their workouts." />
                )}
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {pausedAlerts.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold text-red-text">
                      <Text ro="Clienți în pauză (fără antrenament recent)" en="Paused clients (no recent workout)" />
                    </span>
                    {pausedAlerts.map((item) => (
                      <Link
                        key={item.clientId}
                        href={`/coach/clients/${item.clientId}`}
                        className="flex items-center justify-between gap-2 rounded-md bg-red-soft px-3 py-2.5 text-sm transition-opacity active:opacity-75"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-foreground">{item.name}</p>
                          <p className="text-xs text-red-text">
                            {t(`Nu s-a mai antrenat de ${item.days} zile`, `No workout for ${item.days} days`)} ·{" "}
                            {t("ultimul", "last")}: {new Date(`${item.lastDate}T00:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" })}
                          </p>
                        </div>
                        <ChevronRight className="size-4 shrink-0 text-red-text" />
                      </Link>
                    ))}
                  </div>
                )}

                {newNoWorkouts.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-ice-text">
                      <UserPlus className="size-3.5" />
                      <Text ro="Clienți noi (0 antrenamente logate)" en="New clients (0 workouts logged yet)" />
                    </span>
                    {newNoWorkouts.map((item) => (
                      <Link
                        key={item.clientId}
                        href={`/coach/clients/${item.clientId}`}
                        className={`flex items-center justify-between gap-2 rounded-md px-3 py-2.5 text-sm transition-opacity active:opacity-75 ${
                          item.overdue ? "bg-gold-soft" : "bg-ice-soft"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-foreground">{item.name}</p>
                          <p className={`text-xs ${item.overdue ? "text-gold-text" : "text-ice-text"}`}>
                            {item.overdue
                              ? t(
                                  `Nou-înscris de ${item.daysSinceStart} zile — încă fără primul antrenament`,
                                  `Enrolled ${item.daysSinceStart} days ago — no first workout yet`,
                                )
                              : t(
                                  `Abia înscris (${item.daysSinceStart === 0 ? "azi" : `acum ${item.daysSinceStart} zile`}) — urmează primul antrenament`,
                                  `Just joined (${item.daysSinceStart === 0 ? "today" : `${item.daysSinceStart}d ago`}) — first workout pending`,
                                )}
                          </p>
                        </div>
                        <ChevronRight className="size-4 shrink-0 text-muted" />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>

          <CtaCard
            href="/coach/programs/new"
            label={<Text ro="Builder programe" en="Program builder" />}
            title={<Text ro="Creează un program" en="Create a program" />}
          />
        </Stack>

        <Stack>
          <Card>
            <CardTitle
              description={
                <Text
                  ro="Antrenamente recente ale clienților activi și recorduri personale (ultimele 14 zile)."
                  en="Recent active client workouts and personal records (last 14 days)."
                />
              }
            >
              <span className="flex items-center gap-2">
                <Activity className="size-5 text-lime-text" />
                <Text ro="Activitate recentă & PR-uri" en="Recent activity & PRs" />
              </span>
            </CardTitle>

            {dash.recentWorkouts.length === 0 ? (
              <Empty icon={Dumbbell}>
                <Text
                  ro="Niciun antrenament recent în ultimele 14 zile."
                  en="No recent workouts in the last 14 days."
                />
              </Empty>
            ) : (
              <div className="flex flex-col gap-2">
                {dash.recentWorkouts.map((w) => {
                  const sets = w.sets ?? [];
                  const cardio = w.cardio ?? [];
                  const prSets = sets.filter((s) => s.isPr);
                  const avgRir = averageRir(sets.map((s) => ({ rir: s.rir, set_type: s.setType })));
                  const dateText = new Date(`${w.performedOn}T00:00:00`).toLocaleDateString(locale, {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  });
                  const feedbackItems: FeedbackThreadItem[] = w.feedback ?? [];

                  return (
                    <div key={w.id} className="flex flex-col gap-2.5 rounded-md bg-inner p-3">
                      <Link
                        href={`/coach/clients/${w.userId}?tab=workouts`}
                        className="flex flex-wrap items-start justify-between gap-2 transition-opacity active:opacity-75"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-foreground">{labelClient(w.userId, w.clientName)}</p>
                          <p className="text-xs text-muted">
                            {w.workoutMode === "cardio" ? "Cardio" : <WorkoutLabel value={w.split} />} · {dateText}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {w.workoutMode === "strength" ? (
                            <Badge>{sets.length} {t("seturi", "sets")}</Badge>
                          ) : (
                            <Badge tone="coral">
                              {cardio.reduce((sum, c) => sum + c.durationMin, 0)} min
                            </Badge>
                          )}
                          {avgRir !== null && <Badge tone="ice">RIR {avgRir}</Badge>}
                          {prSets.length > 0 && (
                            <Badge tone="lime" className="gap-1">
                              <Trophy className="size-3" />
                              {prSets.length} PR
                            </Badge>
                          )}
                        </div>
                      </Link>

                      {prSets.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {prSets.slice(0, 3).map((pr, idx) => (
                            <span
                              key={`${w.id}-pr-${idx}`}
                              className="inline-flex items-center gap-1 rounded-sm bg-lime-soft px-2 py-0.5 text-xs font-semibold text-lime-text"
                            >
                              <Trophy className="size-3" />
                              {exerciseName(pr.exercise, language)} · {Number(pr.weight) > 0 ? `${format(Number(pr.weight))} × ` : ""}{pr.reps}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="border-t border-line pt-2">
                        <WorkoutFeedbackThread
                          workoutId={w.id}
                          currentUserId={coach.userId}
                          initialItems={feedbackItems}
                          showReactions
                          collapsible
                          clientIdForRevalidate={w.userId}
                          placeholderRo="Lasă feedback rapid pe sesiune..."
                          placeholderEn="Leave quick feedback on this session..."
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <TextLink href="/coach/clients">
                <Text ro="Toți clienții" en="All clients" />
              </TextLink>
              <span className="flex items-center gap-1 text-xs text-muted">
                <Clock className="size-3.5" />
                <Text ro="Ultimele 14 zile" en="Last 14 days" />
              </span>
            </div>
          </Card>
        </Stack>
      </Columns>
    </Screen>
  );
}
