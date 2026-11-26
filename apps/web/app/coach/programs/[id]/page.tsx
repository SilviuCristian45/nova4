import { notFound } from "next/navigation";
import { requireCoach } from "@/lib/coach/auth";
import { serverApi } from "@/lib/api/server";
import type {
  ProgramAccessType,
  ProgramDifficulty,
  ProgramGoal,
  ProgramStatus,
} from "@/lib/coach/types";
import { Screen } from "@/app/components/ui";
import { ProgramBuilder, type InitialProgramData } from "../program-builder";

export const dynamic = "force-dynamic";

interface ApiFullProgram {
  id: string;
  title: string;
  description: string | null;
  difficulty: ProgramDifficulty;
  durationWeeks: number;
  goal: ProgramGoal;
  status: ProgramStatus;
  accessType: ProgramAccessType;
  requiresApproval: boolean;
  inviteCode: string | null;
  workouts?: {
    id: string;
    weekNumber: number;
    dayNumber: number;
    title: string;
    workoutMode: "strength" | "cardio";
    split: string;
    notes: string | null;
    exercises: {
      id: string;
      exercise: string;
      setType: string;
      targetSets: number;
      targetRepsMin: number;
      targetRepsMax: number;
      targetRir: number | null;
      targetWeightKg: number | null;
      restSeconds: number | null;
      notes: string | null;
    }[];
    cardio: {
      id: string;
      activity: string;
      targetDurationMin: number;
      notes: string | null;
    }[];
  }[];
}

export default async function EditCoachProgramPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireCoach();

  let program: ApiFullProgram | null = null;
  try {
    program = await serverApi<ApiFullProgram>(`/coach/programs/${encodeURIComponent(id)}`);
  } catch {
    program = null;
  }

  if (!program) notFound();

  const initial: InitialProgramData = {
    id: program.id,
    title: program.title,
    description: program.description ?? "",
    difficulty: program.difficulty,
    durationWeeks: program.durationWeeks,
    goal: program.goal,
    status: program.status,
    accessType: program.accessType,
    requiresApproval: program.requiresApproval,
    inviteCode: program.inviteCode,
    workouts: (program.workouts ?? []).map((w) => ({
      id: w.id,
      weekNumber: w.weekNumber,
      dayNumber: w.dayNumber,
      title: w.title,
      workoutMode: w.workoutMode,
      split: w.split,
      notes: w.notes ?? "",
      exercises: (w.exercises ?? []).map((ex) => ({
        id: ex.id,
        exercise: ex.exercise,
        setType: ex.setType,
        targetSets: ex.targetSets,
        targetRepsMin: ex.targetRepsMin,
        targetRepsMax: ex.targetRepsMax,
        targetRir: ex.targetRir,
        targetWeightKg: ex.targetWeightKg,
        restSeconds: ex.restSeconds,
        notes: ex.notes ?? "",
      })),
      cardio: (w.cardio ?? []).map((c) => ({
        id: c.id,
        activity: c.activity,
        targetDurationMin: c.targetDurationMin,
        notes: c.notes ?? "",
      })),
    })),
  };

  return (
    <Screen back="/coach/programs" title={program.title}>
      <ProgramBuilder initial={initial} />
    </Screen>
  );
}
