import { clientApi } from "@/lib/api/client";
import type { WorkoutSet } from "@/utils/fitness";
import type { BestSet } from "@/lib/personal-record";
import type { PlateauStatus } from "@/lib/plateau";

export interface ExerciseHistoryResponse {
  exercise: string;
  bestAllTime: BestSet | null;
  lastSessionBest: WorkoutSet | null;
  plateau: PlateauStatus;
  recentSets: WorkoutSet[];
}

export async function fetchExerciseHistory(exercise: string): Promise<ExerciseHistoryResponse> {
  return clientApi<ExerciseHistoryResponse>(`/workouts/exercises/${encodeURIComponent(exercise)}/history`);
}

export async function fetchRecordBaseline(exercise: string): Promise<BestSet | null> {
  const history = await fetchExerciseHistory(exercise);
  return history.bestAllTime ?? null;
}
