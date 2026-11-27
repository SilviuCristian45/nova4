"use client";

import { useMemo, useState } from "react";
import { Dumbbell, Eye, Search } from "lucide-react";
import { useLanguage } from "@/app/components/language-provider";
import { equipmentLabel, muscleGroupLabel, useExerciseGif } from "@/app/components/exercise-gif";
import { Badge, Card, Empty, Input, Screen, Segmented, Select } from "@/app/components/ui";
import {
  EQUIPMENT,
  EXERCISE_CATALOG,
  MUSCLE_GROUPS,
  exerciseNamePair,
  matchesExerciseQuery,
  type Equipment,
  type ExerciseGroup,
  type MuscleGroup,
} from "@/lib/exercise-catalog";
import { getExerciseGifPath, hasExerciseGif } from "@/lib/exercise-gifs";

type GroupFilter = "ALL" | ExerciseGroup;

export default function ExercisesLibraryPage() {
  const { t, language } = useLanguage();
  const { preview } = useExerciseGif();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<GroupFilter>("ALL");
  const [muscle, setMuscle] = useState<string>("ALL");
  const [equipment, setEquipment] = useState<string>("ALL");
  const [onlyWithGif, setOnlyWithGif] = useState<"gif" | "all">("gif");

  const withGifCount = useMemo(
    () => EXERCISE_CATALOG.filter((ex) => hasExerciseGif(ex.id)).length,
    [],
  );

  const filtered = useMemo(() => {
    return EXERCISE_CATALOG.filter((ex) => {
      if (onlyWithGif === "gif" && !hasExerciseGif(ex.id)) return false;
      if (group !== "ALL" && ex.group !== group) return false;
      if (muscle !== "ALL" && ex.primary !== muscle && !ex.secondary.includes(muscle as MuscleGroup)) return false;
      if (equipment !== "ALL" && ex.equipment !== equipment) return false;
      return matchesExerciseQuery(ex.id, query);
    });
  }, [query, group, muscle, equipment, onlyWithGif]);

  return (
    <Screen title={t("Bibliotecă exerciții", "Exercise library")}>
      <Card>
        <div className="relative">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Caută exercițiu (RO sau EN)...", "Search exercise (RO or EN)...")}
            className="pl-10"
          />
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
        </div>

        <Segmented<GroupFilter>
          inCard
          value={group}
          onChange={setGroup}
          options={[
            { value: "ALL", label: t("Toate", "All") },
            { value: "Push", label: "Push" },
            { value: "Pull", label: "Pull" },
            { value: "Legs", label: t("Picioare", "Legs") },
            { value: "Core", label: "Core" },
            { value: "FullBody", label: "Full" },
          ]}
        />

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Select
            value={muscle}
            title={t("Grupă musculară", "Muscle group")}
            onChange={setMuscle}
            options={[
              { value: "ALL", label: t("Toate grupele", "All muscles") },
              ...MUSCLE_GROUPS.map((m) => ({ value: m, label: muscleGroupLabel(m, t) })),
            ]}
          />
          <Select
            value={equipment}
            title={t("Echipament", "Equipment")}
            onChange={setEquipment}
            options={[
              { value: "ALL", label: t("Tot echipamentul", "All equipment") },
              ...EQUIPMENT.map((eq) => ({ value: eq, label: equipmentLabel(eq, t) })),
            ]}
          />
          <Segmented<"gif" | "all">
            inCard
            value={onlyWithGif}
            onChange={setOnlyWithGif}
            options={[
              { value: "gif", label: `${t("Cu animație", "Animated")} (${withGifCount})` },
              { value: "all", label: `${t("Toate", "All")} (${EXERCISE_CATALOG.length})` },
            ]}
          />
        </div>

        <p className="text-xs text-muted">
          {filtered.length} {t("exerciții afișate", "exercises shown")}
        </p>
      </Card>

      {filtered.length === 0 ? (
        <Empty icon={Dumbbell}>
          {t("Nu am găsit exerciții pentru filtrele alese.", "No exercises match your filters.")}
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((ex) => {
            const pair = exerciseNamePair(ex.id, language);
            const gifPath = getExerciseGifPath(ex.id);
            return (
              <button
                key={ex.id}
                type="button"
                onClick={() => preview(ex.id)}
                className="group flex flex-col overflow-hidden rounded-lg bg-card text-left transition-transform active:scale-[0.99]"
              >
                <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden bg-white p-3">
                  {gifPath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={gifPath}
                      alt={pair.primary}
                      loading="lazy"
                      className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-zinc-400">
                      <Dumbbell className="size-10" />
                      <span className="text-xs">{t("Fără animație", "No animation")}</span>
                    </div>
                  )}
                  {gifPath && (
                    <span className="absolute right-2.5 top-2.5 inline-flex size-8 items-center justify-center rounded-full bg-black/60 text-white opacity-90 transition-opacity group-hover:opacity-100">
                      <Eye className="size-4" />
                    </span>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-1.5 p-3.5">
                  <h2 className="text-[15px] font-semibold leading-snug text-foreground">{pair.primary}</h2>
                  {pair.secondary && <p className="text-xs text-muted">{pair.secondary}</p>}
                  <div className="mt-auto flex flex-wrap gap-1 pt-1">
                    <Badge tone="lime">{muscleGroupLabel(ex.primary, t)}</Badge>
                    <Badge>{equipmentLabel(ex.equipment, t)}</Badge>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </Screen>
  );
}
