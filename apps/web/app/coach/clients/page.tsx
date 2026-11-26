import Link from "next/link";
import { ChevronRight, Users, Utensils } from "lucide-react";
import { Text } from "@/app/components/language-provider";
import { getLanguage } from "@/app/language";
import { requireCoach } from "@/lib/coach/auth";
import { serverApi } from "@/lib/api/server";
import type { ClientAdherence } from "@/lib/coach/analytics";
import { enrollmentStatusLabel } from "@/lib/coach/programs";
import type { EnrollmentStatus } from "@/lib/coach/types";
import { Badge, Card, Columns, Empty, Screen } from "@/app/components/ui";
import { PendingRequestsCard, type PendingRequestItem } from "../pending-requests-card";

export const dynamic = "force-dynamic";

interface ApiCoachClient {
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
  adherence: ClientAdherence;
}

interface ApiCoachProgram {
  id: string;
  title: string;
}

const statusTone: Record<EnrollmentStatus, "lime" | "gold" | "red" | undefined> = {
  active: "lime",
  pending: "gold",
  paused: undefined,
  completed: undefined,
  rejected: "red",
};

export default async function CoachClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; program?: string }>;
}) {
  const { t } = await getLanguage();
  await requireCoach();
  const { status: rawStatus, program: programFilter } = await searchParams;

  const statusFilter =
    rawStatus === "active" || rawStatus === "pending" || rawStatus === "paused" || rawStatus === "completed"
      ? rawStatus
      : "all";

  const [allClients, allPrograms] = await Promise.all([
    serverApi<ApiCoachClient[]>("/coach/clients").catch(() => []),
    serverApi<ApiCoachProgram[]>("/coach/programs").catch(() => []),
  ]);

  const programs = [...allPrograms].sort((a, b) => a.title.localeCompare(b.title));
  const enrollments = allClients.filter((e) => {
    if (e.status === "rejected") return false;
    if (statusFilter !== "all" && e.status !== statusFilter) return false;
    if (programFilter && e.programId !== programFilter) return false;
    return true;
  });

  const labelClient = (id: string, name: string | null) =>
    name?.trim() || `${t("Client", "Client")} #${id.slice(0, 6)}`;

  const pendingItems: PendingRequestItem[] = enrollments
    .filter((e) => e.status === "pending")
    .map((e) => ({
      id: e.enrollmentId,
      clientId: e.clientId,
      clientName: labelClient(e.clientId, e.clientName),
      programTitle: e.programTitle || t("Program", "Program"),
      createdAt: e.createdAt,
    }));

  const buildHref = (nextStatus: string, nextProgram?: string) => {
    const sp = new URLSearchParams();
    if (nextStatus !== "all") sp.set("status", nextStatus);
    if (nextProgram) sp.set("program", nextProgram);
    const qs = sp.toString();
    return qs ? `/coach/clients?${qs}` : "/coach/clients";
  };

  return (
    <Screen back="/coach" title={<Text ro="Clienți" en="Clients" />}>
      <div className="flex flex-wrap gap-2">
        {(["all", "active", "pending", "paused", "completed"] as const).map((item) => {
          const active = statusFilter === item;
          return (
            <Link
              key={item}
              href={buildHref(item, programFilter)}
              className={`inline-flex min-h-10 items-center rounded-full px-4 text-sm font-semibold transition-colors ${
                active ? "bg-lime text-on-solid" : "bg-card text-muted"
              }`}
            >
              {item === "all" ? t("Toți", "All") : enrollmentStatusLabel(item, t)}
            </Link>
          );
        })}
      </div>

      {programs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <Link
            href={buildHref(statusFilter, undefined)}
            className={`inline-flex min-h-8 items-center rounded-full px-3 text-xs font-semibold transition-colors ${
              !programFilter ? "bg-control text-foreground" : "bg-inner text-muted"
            }`}
          >
            <Text ro="Toate programele" en="All programs" />
          </Link>
          {programs.map((p) => (
            <Link
              key={p.id}
              href={buildHref(statusFilter, p.id)}
              className={`inline-flex min-h-8 items-center rounded-full px-3 text-xs font-semibold transition-colors ${
                programFilter === p.id ? "bg-control text-foreground" : "bg-inner text-muted"
              }`}
            >
              {p.title}
            </Link>
          ))}
        </div>
      )}

      {pendingItems.length > 0 && <PendingRequestsCard requests={pendingItems} />}

      {enrollments.length === 0 ? (
        <Empty icon={Users}>
          <Text
            ro="Nu ai clienți care să corespundă filtrelor selectate."
            en="No clients match the selected filters."
          />
        </Empty>
      ) : (
        <Columns>
          {enrollments.map((e) => {
            const progTitle = e.programTitle || t("Fără program", "No program");
            const adherence = e.status === "active" ? e.adherence : null;

            return (
              <Card key={e.enrollmentId}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold">{labelClient(e.clientId, e.clientName)}</h2>
                    <p className="truncate text-xs text-muted">
                      {progTitle} · {t("Săpt.", "Wk")} {e.currentWeek}
                    </p>
                  </div>
                  <Badge tone={statusTone[e.status]}>{enrollmentStatusLabel(e.status, t)}</Badge>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {adherence?.kind === "on_track" && (
                    <Badge tone="lime">
                      {adherence.daysSinceWorkout === 0
                        ? t("Antrenat azi", "Trained today")
                        : t(`Acum ${adherence.daysSinceWorkout} zile`, `${adherence.daysSinceWorkout}d ago`)}
                    </Badge>
                  )}
                  {adherence?.kind === "inactive" && (
                    <Badge tone="red">
                      {t(`Pauză ${adherence.daysSinceWorkout} zile`, `Paused ${adherence.daysSinceWorkout}d`)}
                    </Badge>
                  )}
                  {adherence?.kind === "new_no_workouts" && (
                    <Badge tone="ice">
                      <Text ro="Nou · 0 antrenamente" en="New · 0 workouts" />
                    </Badge>
                  )}
                  {adherence?.kind === "new_overdue" && (
                    <Badge tone="gold">
                      {t(`Nou · ${adherence.daysSinceStart}z fără antrenament`, `New · ${adherence.daysSinceStart}d no workout`)}
                    </Badge>
                  )}
                  {e.status === "active" && (
                    <Badge tone={e.shareNutrition ? "ice" : undefined} className="gap-1">
                      <Utensils className="size-3" />
                      {e.shareNutrition ? t("Nutriție partajată", "Nutrition shared") : t("Nutriție privată", "Nutrition private")}
                    </Badge>
                  )}
                </div>

                <Link
                  href={`/coach/clients/${e.clientId}`}
                  className="inline-flex items-center justify-between rounded-md bg-inner px-3.5 py-2.5 text-sm font-semibold text-foreground transition-colors active:bg-control"
                >
                  <span><Text ro="Deschide profil client" en="Open client profile" /></span>
                  <ChevronRight className="size-4 text-muted" />
                </Link>
              </Card>
            );
          })}
        </Columns>
      )}
    </Screen>
  );
}
