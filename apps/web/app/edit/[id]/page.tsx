import { Text } from "@/app/components/language-provider";
import { redirect } from "next/navigation";
import { getSessionUser, serverApi } from "@/lib/api/server";
import EditWorkoutForm from "./edit-form";
import { Message, Screen } from "@/app/components/ui";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ApiWorkout {
  id: string;
  performedOn: string;
  split: string;
  workoutMode: "strength" | "cardio";
  sets: {
    id: string;
    split: string;
    exercise: string;
    setNumber: number;
    reps: number;
    weight: number;
    rir: number | null;
    setType: string;
    notes: string | null;
  }[];
  cardio: {
    id: string;
    activity: string;
    durationMin: number;
  }[];
}

export default async function EditWorkoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  let workout: ApiWorkout | null = null;
  try {
    workout = await serverApi<ApiWorkout>(`/workouts/${encodeURIComponent(id)}`);
  } catch {
    workout = null;
  }

  if (!workout) {
    return (
      <Screen back="/history">
        <Message>
          <Text ro="Antrenamentul nu a fost găsit." en="Workout not found." />
        </Message>
      </Screen>
    );
  }

  const mappedWorkout = {
    id: workout.id,
    performed_on: workout.performedOn,
    split: workout.split,
    workout_mode: workout.workoutMode,
    workout_sets: workout.sets.map((s) => ({
      id: s.id,
      split: s.split,
      exercise: s.exercise,
      set_number: s.setNumber,
      reps: s.reps,
      weight: s.weight,
      rir: s.rir,
      set_type: s.setType,
      notes: s.notes,
    })),
    cardio_sessions: workout.cardio.map((c) => ({
      id: c.id,
      activity: c.activity,
      duration_min: c.durationMin,
    })),
  };

  return <EditWorkoutForm initialWorkout={mappedWorkout} />;
}
