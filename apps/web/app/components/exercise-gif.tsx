"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Eye, X } from "lucide-react";
import { useLanguage } from "@/app/components/language-provider";
import { Badge, IconButton } from "@/app/components/ui";
import { exerciseNamePair, getExercise, type Equipment, type MuscleGroup } from "@/lib/exercise-catalog";
import { getExerciseGifPath, hasExerciseGif } from "@/lib/exercise-gifs";

type ExerciseGifContextValue = {
  preview: (exerciseId: string) => void;
};

const ExerciseGifContext = createContext<ExerciseGifContextValue>({
  preview: () => undefined,
});

export function useExerciseGif() {
  return useContext(ExerciseGifContext);
}

const MUSCLE_LABELS: Record<MuscleGroup, [string, string]> = {
  chest: ["Piept", "Chest"],
  back: ["Spate", "Back"],
  lower_back: ["Lombar", "Lower back"],
  traps: ["Trapez", "Traps"],
  shoulders: ["Umeri", "Shoulders"],
  biceps: ["Biceps", "Biceps"],
  triceps: ["Triceps", "Triceps"],
  forearms: ["Antebrațe", "Forearms"],
  quads: ["Cvadriceps", "Quads"],
  hamstrings: ["Biceps femural", "Hamstrings"],
  glutes: ["Fesieri", "Glutes"],
  adductors: ["Aductori", "Adductors"],
  abductors: ["Abductori", "Abductors"],
  calves: ["Gambe", "Calves"],
  abs: ["Abdomen", "Abs"],
  full_body: ["Full Body", "Full Body"],
};

const EQUIPMENT_LABELS: Record<Equipment, [string, string]> = {
  barbell: ["Bară", "Barbell"],
  ez_bar: ["Bară EZ", "EZ Bar"],
  trap_bar: ["Bară Hex", "Trap Bar"],
  dumbbell: ["Gantere", "Dumbbell"],
  kettlebell: ["Kettlebell", "Kettlebell"],
  cable: ["Scripete", "Cable"],
  machine: ["Aparat", "Machine"],
  plate_loaded: ["Discuri / Plate Loaded", "Plate Loaded"],
  smith_machine: ["Smith Machine", "Smith Machine"],
  bodyweight: ["Greutatea corpului", "Bodyweight"],
  band: ["Bandă elastică", "Band"],
  other: ["Altele", "Other"],
};

export function muscleGroupLabel(muscle: MuscleGroup, t: (ro: string, en: string) => string): string {
  return t(...MUSCLE_LABELS[muscle]);
}

export function equipmentLabel(equipment: Equipment, t: (ro: string, en: string) => string): string {
  return t(...EQUIPMENT_LABELS[equipment]);
}

export function ExerciseGifProvider({ children }: { children: ReactNode }) {
  const { t, language } = useLanguage();
  const [exercise, setExercise] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (exercise) {
      if (!el.open) el.showModal();
    } else if (el.open) {
      el.close();
    }
  }, [exercise]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const onClose = () => setExercise(null);
    const onClick = (event: MouseEvent) => {
      if (event.target === el) el.close();
    };
    el.addEventListener("close", onClose);
    el.addEventListener("click", onClick);
    return () => {
      el.removeEventListener("close", onClose);
      el.removeEventListener("click", onClick);
    };
  }, []);

  const pair = exercise ? exerciseNamePair(exercise, language) : null;
  const meta = exercise ? getExercise(exercise) : undefined;
  const gifPath = exercise ? getExerciseGifPath(exercise) : null;

  return (
    <ExerciseGifContext.Provider value={{ preview: (id) => setExercise(id) }}>
      {children}
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="fixed inset-x-0 bottom-0 top-auto m-0 mx-auto hidden max-h-[90vh] w-full max-w-lg flex-col rounded-t-xl bg-background p-0 text-foreground backdrop:bg-[#000000a6] open:flex sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2 sm:rounded-xl"
      >
        <div className="flex items-start gap-2 p-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[17px] font-bold leading-snug">
              {pair?.primary}
            </h2>
            {pair?.secondary && <p className="text-xs text-muted">{pair.secondary}</p>}
            {meta && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge tone="lime">{muscleGroupLabel(meta.primary, t)}</Badge>
                <Badge>{equipmentLabel(meta.equipment, t)}</Badge>
                {meta.secondary.map((m) => (
                  <Badge key={m}>{muscleGroupLabel(m, t)}</Badge>
                ))}
              </div>
            )}
          </div>
          <IconButton icon={X} label={t("Închide", "Close")} onClick={() => setExercise(null)} />
        </div>
        <div className="px-4 pb-5">
          {gifPath ? (
            <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={gifPath}
                alt={pair?.primary ?? exercise ?? ""}
                className="h-full w-full object-contain"
              />
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted">
              {t("Nu avem încă o animație pentru acest exercițiu.", "No animation available for this exercise yet.")}
            </p>
          )}
        </div>
      </dialog>
    </ExerciseGifContext.Provider>
  );
}

export function ExerciseGifButton({
  exercise,
  compact = false,
  className = "",
}: {
  exercise: string;
  compact?: boolean;
  className?: string;
}) {
  const { t } = useLanguage();
  const { preview } = useExerciseGif();
  if (!hasExerciseGif(exercise)) return null;

  return (
    <button
      type="button"
      title={t("Vezi demonstrația exercițiului", "Preview exercise demo")}
      aria-label={t("Vezi demonstrația exercițiului", "Preview exercise demo")}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        preview(exercise);
      }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-control hover:text-lime-text active:scale-95 ${
        compact ? "size-8" : "size-9"
      } ${className}`}
    >
      <Eye className={compact ? "size-4" : "size-[18px]"} />
    </button>
  );
}
