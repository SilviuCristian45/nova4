import Link from "next/link";
import { ClipboardList, Plus, Users } from "lucide-react";
import { Text } from "@/app/components/language-provider";
import { getLanguage } from "@/app/language";
import { requireCoach } from "@/lib/coach/auth";
import { serverApi } from "@/lib/api/server";
import {
  accessTypeLabel,
  difficultyLabel,
  goalLabel,
  programStatusLabel,
} from "@/lib/coach/programs";
import type { ProgramAccessType, ProgramDifficulty, ProgramGoal, ProgramStatus } from "@/lib/coach/types";
import { Badge, Card, Columns, Empty, Screen, buttonClass } from "@/app/components/ui";
import { CopyInviteButton } from "./copy-invite-button";

export const dynamic = "force-dynamic";

interface ApiCoachProgram {
  id: string;
  assignedClientId: string | null;
  title: string;
  description: string | null;
  difficulty: ProgramDifficulty;
  durationWeeks: number;
  goal: ProgramGoal;
  status: ProgramStatus;
  accessType: ProgramAccessType;
  inviteCode: string | null;
  workoutCount?: number;
  activeEnrollmentsCount?: number;
  pendingEnrollmentsCount?: number;
}

const statusTone: Record<ProgramStatus, "lime" | "gold" | undefined> = {
  published: "lime",
  draft: "gold",
  archived: undefined,
};

export default async function CoachProgramsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { t } = await getLanguage();
  await requireCoach();
  const { status: rawFilter } = await searchParams;
  const filter = rawFilter === "draft" || rawFilter === "published" || rawFilter === "archived" ? rawFilter : "all";

  let allPrograms: ApiCoachProgram[] = [];
  let loadError: string | null = null;
  try {
    allPrograms = await serverApi<ApiCoachProgram[]>("/coach/programs");
  } catch (err) {
    loadError = err instanceof Error ? err.message : t("Eroare la încărcare.", "Failed to load.");
  }

  const programs = filter === "all" ? allPrograms : allPrograms.filter((p) => p.status === filter);
  const filterHref = (next: string) => (next === "all" ? "/coach/programs" : `/coach/programs?status=${next}`);

  return (
    <Screen
      back="/coach"
      title={<Text ro="Programe & Cursuri" en="Programs & Courses" />}
      right={
        <Link href="/coach/programs/new" className={buttonClass({ small: true })}>
          <Plus className="size-4" />
          <Text ro="Program nou" en="New program" />
        </Link>
      }
    >
      <div className="flex flex-wrap gap-2">
        {(["all", "published", "draft", "archived"] as const).map((item) => {
          const active = filter === item;
          return (
            <Link
              key={item}
              href={filterHref(item)}
              className={`inline-flex min-h-10 items-center rounded-full px-4 text-sm font-semibold transition-colors ${
                active ? "bg-lime text-on-solid" : "bg-card text-muted"
              }`}
            >
              {item === "all" ? t("Toate", "All") : programStatusLabel(item, t)}
            </Link>
          );
        })}
      </div>

      {loadError ? (
        <Card tone="red">
          <p className="text-sm font-semibold">{loadError}</p>
        </Card>
      ) : programs.length === 0 ? (
        <Empty icon={ClipboardList}>
          <Text ro="Nu ai încă programe în această categorie." en="You have no programs in this category yet." />
        </Empty>
      ) : (
        <Columns>
          {programs.map((program) => {
            const workoutCount = program.workoutCount ?? 0;
            const activeCount = program.activeEnrollmentsCount ?? 0;
            const pendingCount = program.pendingEnrollmentsCount ?? 0;

            return (
              <Card key={program.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <h2 className="text-[20px] font-semibold tracking-[-0.4px]">{program.title}</h2>
                    {program.description && (
                      <p className="line-clamp-2 text-[13px] text-soft">{program.description}</p>
                    )}
                  </div>
                  <Badge tone={statusTone[program.status]}>
                    {programStatusLabel(program.status, t)}
                  </Badge>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <Badge tone="ice">{goalLabel(program.goal, t)}</Badge>
                  <Badge>{difficultyLabel(program.difficulty, t)}</Badge>
                  <Badge>{program.durationWeeks} {t("săpt.", "wk")}</Badge>
                  <Badge>{workoutCount} {t("zile", "days")}</Badge>
                  <Badge tone={program.accessType === "invite_only" ? "lilac" : undefined}>
                    {accessTypeLabel(program.accessType, t)}
                  </Badge>
                  {program.assignedClientId && (
                    <Badge tone="gold"><Text ro="Personalizat client" en="Client custom" /></Badge>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-inner px-3 py-2 text-xs font-medium text-soft">
                  <span className="flex items-center gap-1.5">
                    <Users className="size-3.5" />
                    {activeCount} {t("activi", "active")}
                    {pendingCount > 0 && ` · ${pendingCount} ${t("în așteptare", "pending")}`}
                  </span>
                  {program.inviteCode && (
                    <span className="font-mono font-bold text-foreground">{program.inviteCode}</span>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/coach/programs/${program.id}`}
                    className={buttonClass({ variant: "primary", small: true })}
                  >
                    <Text ro="Editează" en="Edit" />
                  </Link>
                  {program.inviteCode && <CopyInviteButton code={program.inviteCode} />}
                </div>
              </Card>
            );
          })}
        </Columns>
      )}
    </Screen>
  );
}
