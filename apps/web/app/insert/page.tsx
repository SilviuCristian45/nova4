"use client";

import { Text, useLanguage } from "@/app/components/language-provider";
import { workoutLabelText } from "@/app/components/workout-label";
import { WorkoutSummaryDialog } from "@/app/components/workout-summary-dialog";
import type { SummaryInput } from "@/lib/workout-summary";
import { Suspense, useEffect, useMemo, useState, useTransition, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Check,
  ClipboardList,
  Dumbbell,
  Heart,
  Hourglass,
  Plus,
  Save,
  Target,
  Trophy,
  Play,
  Pause,
  Square,
} from "lucide-react";
import { clientApi } from "@/lib/api/client";
import confetti from "canvas-confetti";

import { saveWorkout } from "./action";
import {
  SPLITS,
  SET_TYPES,
  CARDIO_ACTIVITIES,
  type Split,
  type SetType,
  getExercisesForSplit,
} from "@/lib/workout-data";
import { formatExerciseTarget } from "@/lib/coach/programs";
import type { ProgramWorkoutCardio, ProgramWorkoutExercise } from "@/lib/coach/types";
import { ExerciseName } from "@/app/components/exercise-name";
import { ExerciseGifButton } from "@/app/components/exercise-gif";
import type { OfflineCardio, OfflineSet } from "@/lib/offline/types";
import { saveOfflineMutation, useOffline } from "@/lib/offline/client";
import { useUnits } from "@/app/components/units-provider";
import { progressionStepKg } from "@/lib/units";
import { RestTimerBar, RestTimerSettings, useRestTimer } from "@/app/components/rest-timer";
import { localDate } from "@/lib/daily-metrics";
import { readOfflineDatabase } from "@/lib/offline/store";
import {
  calculateProgression,
  getBestSetFromLastSession,
} from "@/utils/fitness";
import { createSubmitGuard, runGuarded } from "@/lib/submit-guard";
import { draftPersonalRecords, type BestSet } from "@/lib/personal-record";
import { draftHasEntries, restoreDraft, type DraftState } from "@/lib/workout-draft";
import { idleTimer, pauseTimer as pauseTimerState, startTimer as startTimerState, timerSeconds, type TimerState } from "@/lib/workout-timer";
import { displayOrdinals, positionSetNumbers } from "@/lib/set-numbering";
import { workoutSplit } from "@/lib/workout-save";
import { ExerciseCombobox } from "@/app/components/exercise-combobox";
import { localizeOfflineMessage } from "@/lib/offline/messages";
import { fetchExerciseHistory, fetchRecordBaseline } from "@/lib/exercise-history";
import { type PlateauStatus } from "@/lib/plateau";
import { estimateOneRepMax } from "@/lib/personal-record";
import {
  cardioName,
} from "@/lib/exercise-catalog";
import { CardioRows, SetRows } from "@/app/components/workout-parts";
import { Badge, Button, Card, Eyebrow, Field, IconButton, Input, Message, Screen, Segmented, Select } from "@/app/components/ui";

const DRAFT_KEY = "workout_draft_v1";

type AssignedWorkoutPlan = {
  id: string;
  programTitle: string;
  title: string;
  weekNumber: number;
  dayNumber: number;
  workoutMode: "strength" | "cardio";
  split: string;
  notes: string | null;
  exercises: ProgramWorkoutExercise[];
  cardio: ProgramWorkoutCardio[];
};

export default function InsertWorkoutPage() {
  return (
    <Suspense
      fallback={
        <Screen title={<Text ro="Antrenament nou" en="New workout" />}>
          <p role="status" className="text-muted">
            <Text ro="Se încarcă..." en="Loading..." />
          </p>
        </Screen>
      }
    >
      <InsertWorkoutContent />
    </Suspense>
  );
}

function InsertWorkoutContent() {
  const { t, language, locale } = useLanguage();
  const searchParams = useSearchParams();
  const programWorkoutIdParam = searchParams.get("programWorkoutId");
  const enrollmentIdParam = searchParams.get("enrollmentId");
  const { ownerId, ready, sync } = useOffline();
  const { unit, toUnit, toKg, format } = useUnits();
  const restTimer = useRestTimer();
  const draftKey = ownerId ? `${DRAFT_KEY}_${ownerId}` : null;
  const [loadedDraftKey, setLoadedDraftKey] = useState<string | null>(null);

  const router = useRouter();
  const [isSaving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string>("");
  // Set once the workout is saved: the shareable card is shown before leaving the page.
  const submitGuard = useRef(createSubmitGuard());
  const [saveLocked, setSaveLocked] = useState(false);
  const [finished, setFinished] = useState<{ input: SummaryInput; next: string } | null>(null);

  // Assigned program workout state
  const [assignedPlan, setAssignedPlan] = useState<AssignedWorkoutPlan | null>(null);
  const [draftConflict, setDraftConflict] = useState(false);
  const initializedPlanId = useRef<string | null>(null);

  // State general
  const [mode, setMode] = useState<"strength" | "cardio">("strength");
  const [sessionSets, setSessionSets] = useState<
    (OfflineSet & { id: string })[]
  >([]);
  const [cardioEntries, setCardioEntries] = useState<
    (OfflineCardio & { id: string })[]
  >([]);

  // Formular Strength
  const [split, setSplit] = useState<Split>("Push");
  const availableExercises = useMemo(() => {
    const base = getExercisesForSplit(split);
    if (!assignedPlan) return base;
    return [...new Set([...assignedPlan.exercises.map((ex) => ex.exercise), ...base])];
  }, [split, assignedPlan]);
  const [exercise, setExercise] = useState(() => getExercisesForSplit("Push")[0]);
  const [reps, setReps] = useState("");
  const [weight, setWeight] = useState("");
  const [rir, setRir] = useState("");
  const [setType, setSetType] = useState<SetType>("Working Set");

  const [lastPerformance, setLastPerformance] = useState<string | null>(null);

  // Formular Cardio
  const [cardioActivity, setCardioActivity] = useState(CARDIO_ACTIVITIES[0]);
  const [cardioDuration, setCardioDuration] = useState("");

  // --- STATE PENTRU TIMER ---
  // Computed from timestamps (see lib/workout-timer.ts) and kept in the draft; `now` only triggers re-renders.
  const [timer, setTimer] = useState<TimerState>(idleTimer);
  const [now, setNow] = useState(() => Date.now());
  const isRunning = timer.startedAt !== null;
  const time = timerSeconds(timer, now);

  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  const startTimer = () => {
    const at = Date.now();
    setNow(at);
    setTimer((current) => startTimerState(current, at));
  };

  const pauseTimer = () => {
    const at = Date.now();
    setNow(at);
    setTimer((current) => pauseTimerState(current, at));
  };

  const resetTimer = () => setTimer(idleTimer);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };
  // --------------------------

  function applyExerciseTarget(ex: ProgramWorkoutExercise) {
    setExercise(ex.exercise);
    if (SET_TYPES.includes(ex.set_type as SetType)) {
      setSetType(ex.set_type as SetType);
    }
    if (ex.target_weight_kg !== null && Number(ex.target_weight_kg) > 0) {
      setWeight(String(Number(toUnit(Number(ex.target_weight_kg)).toFixed(1))));
    }
  }

  function applyAssignedPlanToForm(plan: AssignedWorkoutPlan, clearExisting: boolean) {
    if (clearExisting) {
      setSessionSets([]);
      setCardioEntries([]);
      setTimer(idleTimer);
      if (draftKey) {
        try {
          localStorage.removeItem(draftKey);
        } catch {
          // ignore storage errors
        }
      }
    }
    setMode(plan.workoutMode);
    if (plan.workoutMode === "strength") {
      const validSplit: Split = SPLITS.includes(plan.split as Split) ? (plan.split as Split) : "Full Body";
      setSplit(validSplit);
      if (plan.exercises.length > 0) {
        applyExerciseTarget(plan.exercises[0]);
      }
    } else if (plan.cardio.length > 0) {
      setCardioActivity(plan.cardio[0].activity);
      setCardioDuration(String(plan.cardio[0].target_duration_min));
    }
    setDraftConflict(false);
  }

  // Load assigned program workout once local draft readiness is known; warn instead of overwriting an active draft.
  const draftReady = ready && (!ownerId || loadedDraftKey === draftKey);
  useEffect(() => {
    if (!programWorkoutIdParam || !draftReady) return;
    if (initializedPlanId.current === programWorkoutIdParam) return;
    let cancelled = false;
    async function loadAssigned() {
      let plan: AssignedWorkoutPlan | null = null;
      try {
        plan = await clientApi<AssignedWorkoutPlan>(
          `/explore/program-workouts/${encodeURIComponent(programWorkoutIdParam!)}`,
        );
      } catch {
        plan = null;
      }

      if (cancelled || !plan) return;
      initializedPlanId.current = programWorkoutIdParam;
      setAssignedPlan(plan);

      let hasExistingDraft = false;
      try {
        hasExistingDraft = Boolean(draftKey && draftHasEntries(localStorage.getItem(draftKey)));
      } catch {
        hasExistingDraft = false;
      }

      if (hasExistingDraft) {
        setDraftConflict(true);
      } else {
        setMode(plan.workoutMode);
        if (plan.workoutMode === "strength") {
          const validSplit: Split = SPLITS.includes(plan.split as Split) ? (plan.split as Split) : "Full Body";
          setSplit(validSplit);
          if (plan.exercises.length > 0) {
            const first = plan.exercises[0];
            setExercise(first.exercise);
            if (SET_TYPES.includes(first.set_type as SetType)) setSetType(first.set_type as SetType);
            if (first.target_weight_kg !== null && Number(first.target_weight_kg) > 0) {
              setWeight(String(Number(toUnit(Number(first.target_weight_kg)).toFixed(1))));
            }
          }
        } else if (plan.cardio.length > 0) {
          setCardioActivity(plan.cardio[0].activity);
          setCardioDuration(String(plan.cardio[0].target_duration_min));
        }
      }
    }
    void loadAssigned();
    return () => {
      cancelled = true;
    };
  }, [programWorkoutIdParam, draftReady, draftKey, toUnit]);

  // Best set of the last session per exercise, from before this workout: the PR baseline.
  const [baselines, setBaselines] = useState<Record<string, BestSet | null>>({});
  const requestedBaselines = useRef(new Set<string>());

  const [recommendedPerformance, setRecommendedPerformance] = useState("");
  const [recommendedIsNew, setRecommendedIsNew] = useState(false);
  const [plateau, setPlateau] = useState<PlateauStatus | null>(null);

  // Fetch ultima performanță
  useEffect(() => {
    if (mode !== "strength" || !exercise) return;

    async function fetchLastPerformance() {
      setPlateau(null);
      setLastPerformance(t("Se caută istoricul...", "Loading history..."));
      setRecommendedIsNew(false);
      setRecommendedPerformance(
        t(
          "Va recomandam greutatea de lucru si repetarile",
          "We recommend you work set lift data",
        ),
      );
      let bestSet: Awaited<ReturnType<typeof fetchExerciseHistory>>["lastSessionBest"] = null;
      let recordBaseline: BestSet | null = null;
      let error = false;
      try {
        const history = await fetchExerciseHistory(exercise);
        bestSet = history.lastSessionBest ?? getBestSetFromLastSession(history.recentSets);
        recordBaseline = history.bestAllTime ?? null;
        setPlateau(history.plateau);
      } catch (e) {
        console.error("Exercise history could not be loaded:", e);
        error = true;
      }

      if (error || !bestSet) {
        setLastPerformance(
          t(
            "Exercițiu nou. Setează primul record!",
            "New exercise. Set your first record!",
          ),
        );
        requestedBaselines.current.add(exercise);
        setBaselines((prev) => ({ ...prev, [exercise]: null }));
        return;
      }

      const weightText =
        Number(bestSet.weight) > 0 ? `${format(Number(bestSet.weight))} × ` : "";
      const notesText = bestSet.notes ? ` (${bestSet.notes})` : "";

      requestedBaselines.current.add(exercise);
      setBaselines((prev) => ({ ...prev, [exercise]: recordBaseline }));

      setLastPerformance(
        `${t("Ultima oară ai făcut", "Last time you did")}: ${weightText}${bestSet.reps} ${t("repetări", "reps")} ${bestSet.rir === null || bestSet.rir === undefined ? "" : ` (RIR ${bestSet.rir})`}${notesText}`,
      );

      const recommendation = calculateProgression(bestSet, format, progressionStepKg(unit), t);
      setRecommendedPerformance(recommendation.message);
      setRecommendedIsNew(recommendation.kind === "new");
    }

    fetchLastPerformance();
  }, [exercise, mode, t, format, unit]);

  // Restored drafts can hold exercises that were never selected in this visit: load their baselines too.
  const draftExercises = useMemo(
    () => [...new Set(sessionSets.map((s) => s.exercise))],
    [sessionSets],
  );
  useEffect(() => {
    const missing = draftExercises.filter((name) => !requestedBaselines.current.has(name));
    if (missing.length === 0) return;
    missing.forEach((name) => requestedBaselines.current.add(name));
    async function loadMissing() {
      const loaded: Record<string, BestSet | null> = {};
      for (const name of missing) {
        loaded[name] = await fetchRecordBaseline(name);
      }
      setBaselines((prev) => ({ ...loaded, ...prev }));
    }
    void loadMissing().catch((error) => {
      console.error("Personal record baselines could not be loaded:", error);
      setBaselines((prev) => ({ ...Object.fromEntries(missing.map((name) => [name, null])), ...prev }));
    });
  }, [draftExercises]);

  // Shown numbers: 1, 2, 3... within each exercise (the stored number is the position in the workout).
  const ordinals = useMemo(
    () => displayOrdinals(sessionSets.map((s, index) => ({ exercise: s.exercise, order: index }))),
    [sessionSets],
  );

  // Derived from the current list, so deleting a set re-evaluates every PR after it.
  const personalRecords = useMemo(
    () => draftPersonalRecords(sessionSets, baselines),
    [sessionSets, baselines],
  );

  // Read by the restore effect, which must not run again whenever the sets change.
  const latestDraft = useRef<
    DraftState<(typeof sessionSets)[number], (typeof cardioEntries)[number]>
  >({ sets: [], cardio: [], mode: "strength", timer: idleTimer });
  useEffect(() => {
    latestDraft.current = { sets: sessionSets, cardio: cardioEntries, mode, timer };
  }, [sessionSets, cardioEntries, mode, timer]);

  // Local Storage
  useEffect(() => {
    if (!draftKey) return;
    const key = draftKey;
    let cancelled = false;
    async function restore() {
      try {
        const state = await readOfflineDatabase();
        if (cancelled || state.activeOwner !== ownerId) return;
        const restored = restoreDraft(
          latestDraft.current,
          localStorage.getItem(key),
        );
        setSessionSets(restored.sets);
        setCardioEntries(restored.cardio);
        setMode(restored.mode);
        setTimer(restored.timer);
        setNow(Date.now());
        setLoadedDraftKey(key);
      } catch (error) {
        console.error("Workout draft could not be loaded:", error);
        if (!cancelled)
          setError(
            t("Ciorna nu a putut fi încărcată.", "Workout draft could not be loaded."),
          );
      }
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, [draftKey, ownerId, t]);

  useEffect(() => {
    if (!draftKey || loadedDraftKey !== draftKey) return;
    const key = draftKey;
    let cancelled = false;
    async function persist() {
      try {
        const state = await readOfflineDatabase();
        if (cancelled || state.activeOwner !== ownerId) return;
        if (
          sessionSets.length ||
          cardioEntries.length ||
          timer.startedAt !== null ||
          timer.elapsedMs > 0
        )
          localStorage.setItem(
            key,
            JSON.stringify({ sets: sessionSets, cardio: cardioEntries, mode, timer }),
          );
        else localStorage.removeItem(key);
      } catch (error) {
        console.error("Workout draft could not be stored:", error);
        if (!cancelled)
          setError(
            t(
              "Ciorna nu a putut fi salvată pe dispozitiv.",
              "The workout draft could not be saved on this device.",
            ),
          );
      }
    }
    void persist();
    return () => {
      cancelled = true;
    };
  }, [sessionSets, cardioEntries, mode, timer, draftKey, loadedDraftKey, ownerId, t]);

  // Handler Adăugare Set
  function handleAddSet(e: React.FormEvent) {
    e.preventDefault();
    if (!exercise || reps === "") return;

    const newSet = {
      id: Math.random().toString(36).substring(2, 9),
      split,
      exercise,
      setNumber: sessionSets.length + 1, // position in the workout; the user sees the number within the exercise
      reps: Number(reps),
      weight: weight === "" ? 0 : toKg(Number(weight)),
      rir: rir === "" ? null : Number(rir), // optional: empty means "not recorded", not 0
      setType,
      notes: notes.trim(),
    };

    const isPersonalRecord = draftPersonalRecords(
      [...sessionSets, newSet],
      baselines,
    ).has(newSet.id);

    if (isPersonalRecord) {
      confetti({
        particleCount: 50,
        spread: 80,
        origin: { y: 0.6 },
        colors: ["#c8f031", "#e2ff7a", "#9fc21f"], // lime, the record colour
        zIndex: 100,
        disableForReducedMotion: true,
      });
    }

    setSessionSets((prev) => [...prev, newSet]);
    restTimer.start();
    setReps("");
    setRir("");
    setNotes("");
  }

  function handleAddCardio(e: React.FormEvent) {
    e.preventDefault();
    if (!cardioActivity || cardioDuration === "") return;
    const newEntry = {
      id: Math.random().toString(36).substring(2, 9),
      activity: cardioActivity,
      durationMin: Number(cardioDuration),
    };
    setCardioEntries((prev) => [...prev, newEntry]);
    setCardioDuration("");
  }

  function handleFinish() {
    if (mode === "strength" && sessionSets.length === 0) return;
    if (mode === "cardio" && cardioEntries.length === 0) return;
    if (submitGuard.current.busy) return;

    setError(null);
    restTimer.skip();
    // The split of the logged sets, not whatever the picker shows now (like /offline).
    const savedSplit = workoutSplit(sessionSets, split);
    const summaryInput: SummaryInput = {
      date: localDate(),
      mode,
      title: mode === "cardio" ? "Cardio" : workoutLabelText(savedSplit, t),
      durationSec: time > 0 ? time : null,
      sets: mode === "strength" ? sessionSets : [],
      cardio: mode === "cardio" ? cardioEntries : [],
      recordIds: personalRecords,
    };
    const celebrate = (next = "/") => {
      const duration = 2000;
      const end = Date.now() + duration;

      const frame = () => {
        confetti({
          particleCount: 5,
          angle: 60,
          spread: 55,
          origin: { x: 0 },
          disableForReducedMotion: true,
          colors: ["#c8f031", "#ffc233", "#7cc4ff"],
        });
        confetti({
          particleCount: 5,
          angle: 120,
          spread: 55,
          origin: { x: 1 },
          disableForReducedMotion: true,
          colors: ["#c8f031", "#ffc233", "#7cc4ff"],
        });
        if (Date.now() < end) requestAnimationFrame(frame);
      };
      frame();

      setTimeout(() => {
        setFinished({ input: summaryInput, next });
      }, 1500);
    };
    startSaving(async () => {
      // True once the workout is stored (saved or queued); false leaves the button free for a retry.
      const outcome = await runGuarded(submitGuard.current, async () => {
        setSaveLocked(true);
        try {
          const useLinkedOnlineSave = Boolean(assignedPlan && navigator.onLine);
          if (ownerId && !useLinkedOnlineSave) {
            let mutationId: string | null = null;
            try {
              mutationId = await saveOfflineMutation(
                {
                  kind: "workout",
                  date: localDate(),
                  mode,
                  split: savedSplit,
                  sets: mode === "strength" ? positionSetNumbers(sessionSets) : [],
                  cardio: mode === "cardio" ? cardioEntries : [],
                },
                ownerId,
              );
              try {
                if (draftKey) localStorage.removeItem(draftKey);
              } catch (error) {
                console.error("Saved workout draft could not be removed:", error);
              }
              // Online: upload right away so the server dashboard already shows the workout.
              // Offline or failed upload: the workout waits in the queue and only the local dashboard has it.
              if (navigator.onLine) {
                await sync();
                const state = await readOfflineDatabase();
                if (!state.accounts[ownerId]?.queue.some((entry) => entry.id === mutationId)) {
                  celebrate();
                  return true;
                }
              }
              celebrate("/offline");
              return true;
            } catch (error) {
              // Already queued: retrying would store the workout twice, so it counts as saved.
              if (mutationId) {
                celebrate("/offline");
                return true;
              }
              setError(
                error instanceof Error
                  ? localizeOfflineMessage(error.message, t)
                  : t("Salvarea a eșuat.", "Save failed."),
              );
              return false;
            }
          }
          const result = await saveWorkout(
            mode,
            savedSplit,
            localDate(),
            positionSetNumbers(sessionSets),
            cardioEntries,
            assignedPlan
              ? {
                  programWorkoutId: assignedPlan.id,
                  enrollmentId: enrollmentIdParam,
                }
              : undefined,
          );

          if (result.error) {
            setError(result.error);
            return false;
          }

          if (draftKey) localStorage.removeItem(draftKey);
          if (ownerId) void sync();
          celebrate();
          return true;
        } catch (error) {
          setError(
            error instanceof Error
              ? localizeOfflineMessage(error.message, t)
              : t("Salvarea a eșuat.", "Save failed."),
          );
          return false;
        }
      });
      // Failure unlocks the button; success stays locked until the summary is closed and the page changes.
      if (outcome === "failed") setSaveLocked(false);
    });
  }

  const latestRecord = [...sessionSets]
    .reverse()
    .find((s) => s.exercise === exercise && personalRecords.has(s.id));
  const exerciseHint = latestRecord
    ? `${t("Nou record", "New record")}: ${latestRecord.weight > 0 ? `${format(latestRecord.weight)} × ` : ""}${latestRecord.reps} ${t("repetări", "reps")} ${latestRecord.rir === null ? "" : ` (RIR ${latestRecord.rir})`}${latestRecord.notes ? ` (${latestRecord.notes})` : ""}`
    : lastPerformance;
  // All-time best set of the exercise (warmups excluded), shown under the last-session hint.
  const record = baselines[exercise];
  const recordHint = record && !latestRecord
    ? `${t("Record", "Record")}: ${record.weight > 0 ? `${format(record.weight)} × ` : ""}${record.reps} ${t("repetări", "reps")}`
      + (record.weight > 0 ? ` · ${t("1RM estimat", "est. 1RM")} ${format(estimateOneRepMax(record.weight, record.reps))}` : "")
      + (record.performedOn ? ` · ${new Date(`${record.performedOn}T00:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}` : "")
    : null;
  const plateauHint = plateau?.plateau
    ? t(
      `Plateau: ${plateau.sessionsSinceBest} sesiuni fără un nou maxim la acest exercițiu. Încearcă un deload (-10%) sau schimbă intervalul de repetări.`,
      `Plateau: ${plateau.sessionsSinceBest} sessions without a new best on this exercise. Try a deload (-10%) or change the rep range.`,
    )
    : null;

  if (!ready || (ownerId && loadedDraftKey !== draftKey && !error)) {
    return (
      <Screen title={t("Antrenament nou", "New workout")}>
        <p role="status" className="text-muted">
          {t("Se încarcă jurnalul local...", "Loading local log...")}
        </p>
      </Screen>
    );
  }

  const hasEntries = (mode === "strength" && sessionSets.length > 0) || (mode === "cardio" && cardioEntries.length > 0);
  const activePlannedExercise = assignedPlan?.exercises.find((ex) => ex.exercise === exercise) ?? null;
  const totalVolumeKg = sessionSets.reduce((sum, s) => sum + (s.weight > 0 ? s.weight * s.reps : 0), 0);
  const totalCardioMin = cardioEntries.reduce((sum, c) => sum + c.durationMin, 0);
  const prCount = personalRecords.size;

  return (
    <Screen
      title={t("Antrenament nou", "New workout")}
      right={
        hasEntries ? (
          <Button small icon={Save} onClick={handleFinish} busy={isSaving || saveLocked}>
            <Text ro="Finalizează" en="Finish" />
          </Button>
        ) : undefined
      }
      className={restTimer.running || restTimer.finished ? "pb-36" : ""}
    >
      {draftConflict && assignedPlan && (
        <Card tone="gold">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-gold-text" />
            <div className="flex flex-col gap-1">
              <p className="font-semibold text-foreground">
                <Text ro="Ai deja o ciornă nefinalizată" en="You already have an unfinished draft" />
              </p>
              <p className="text-sm text-soft">
                <Text
                  ro={`Nu ți-am șters seturile existente. Poți porni curat antrenamentul „${assignedPlan.title}” sau poți păstra ciorna curentă folosind țintele din program ca ghid.`}
                  en={`We kept your existing sets. Start "${assignedPlan.title}" fresh, or keep your current draft with the program targets as a guide.`}
                />
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button small onClick={() => applyAssignedPlanToForm(assignedPlan, true)}>
              <Text ro="Pornește curat din program" en="Start fresh from program" />
            </Button>
            <Button variant="secondary" small onClick={() => setDraftConflict(false)}>
              <Text ro="Păstrează ciorna și folosește ghidul" en="Keep draft & use guide" />
            </Button>
          </div>
        </Card>
      )}

      {/* Live Session Telemetry Strip: Timer + Live Volume/Sets/PRs + Mode Switch */}
      <Card className="gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center justify-between gap-4 sm:justify-start">
          <div className="flex flex-col gap-0.5">
            <Eyebrow>{t("Cronometru sesiune", "Session timer")}</Eyebrow>
            <span className={`font-mono text-[28px] font-bold leading-none tracking-[-0.03em] tabular-nums ${isRunning ? "text-lime-text" : "text-foreground"}`}>
              {formatTime(time)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {!isRunning ? (
              <IconButton icon={Play} tone="lime" label={t("Pornește cronometrul", "Start timer")} onClick={startTimer} />
            ) : (
              <IconButton icon={Pause} tone="gold" label={t("Pauză cronometru", "Pause timer")} onClick={pauseTimer} />
            )}
            <IconButton icon={Square} label={t("Resetează cronometrul", "Reset timer")} onClick={resetTimer} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 border-t border-card-border pt-3 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-6">
          <div className="flex flex-col gap-0.5">
            <Eyebrow>{mode === "strength" ? t("Seturi", "Sets") : t("Activități", "Entries")}</Eyebrow>
            <span className="font-mono text-[20px] font-bold leading-tight tabular-nums">
              {mode === "strength" ? sessionSets.length : cardioEntries.length}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <Eyebrow>{mode === "strength" ? t("Volum", "Volume") : t("Durată", "Duration")}</Eyebrow>
            <span className="font-mono text-[20px] font-bold leading-tight tabular-nums">
              {mode === "strength"
                ? totalVolumeKg > 0
                  ? format(Math.round(totalVolumeKg))
                  : `0 ${unit}`
                : `${totalCardioMin}m`}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <Eyebrow>PR</Eyebrow>
            <span className={`font-mono text-[20px] font-bold leading-tight tabular-nums ${prCount > 0 ? "text-lime-text" : "text-muted"}`}>
              {prCount}
            </span>
          </div>
        </div>
      </Card>

      {assignedPlan && (
        <Card className="relative overflow-hidden">
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3.5px] bg-lime" />
          <div className="flex flex-wrap items-start justify-between gap-2 pl-1">
            <div className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.09em] text-lime-text">
                <ClipboardList className="size-3.5" />
                {assignedPlan.programTitle || t("Program asignat", "Assigned program")}
              </span>
              <h2 className="text-[18px] font-bold tracking-[-0.02em]">{assignedPlan.title}</h2>
            </div>
            <Badge tone="lime">
              {t("S", "W")}{assignedPlan.weekNumber}·{t("Z", "D")}{assignedPlan.dayNumber}
            </Badge>
          </div>
          {assignedPlan.notes && (
            <p className="ml-1 rounded-md border border-card-border bg-inner px-3 py-2 text-xs text-soft">{assignedPlan.notes}</p>
          )}
          {assignedPlan.workoutMode === "strength" && assignedPlan.exercises.length > 0 && (
            <div className="ml-1 flex flex-col gap-1.5">
              {assignedPlan.exercises.map((planned) => {
                const loggedCount = sessionSets.filter((s) => s.exercise === planned.exercise).length;
                const done = loggedCount >= planned.target_sets;
                const selected = mode === "strength" && exercise === planned.exercise;
                const targetText = formatExerciseTarget(planned, format, t);

                return (
                  <div
                    key={planned.id}
                    className={`flex items-center gap-1 rounded-md border pr-1.5 transition-colors ${
                      selected
                        ? "border-lime-border bg-lime-soft"
                        : "border-card-border bg-inner hover:border-card-border-strong"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setMode("strength");
                        applyExerciseTarget(planned);
                      }}
                      className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-left"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex items-center gap-1.5 text-[14px] font-semibold text-foreground">
                          {done && <Check className="size-3.5 shrink-0 text-lime-text" />}
                          <span className="truncate"><ExerciseName id={planned.exercise} /></span>
                        </span>
                        <span className="font-mono text-[11.5px] text-soft">
                          {t("Țintă", "Target")}: {targetText}
                        </span>
                        {planned.notes && (
                          <span className="text-xs text-muted">{planned.notes}</span>
                        )}
                      </span>
                      <Badge tone={done ? "lime" : undefined}>
                        {loggedCount}/{planned.target_sets}
                      </Badge>
                    </button>
                    <ExerciseGifButton exercise={planned.exercise} compact />
                  </div>
                );
              })}
            </div>
          )}
          {assignedPlan.workoutMode === "cardio" && assignedPlan.cardio.length > 0 && (
            <div className="ml-1 flex flex-col gap-1.5">
              {assignedPlan.cardio.map((planned) => {
                const selected = mode === "cardio" && cardioActivity === planned.activity;
                return (
                  <button
                    key={planned.id}
                    type="button"
                    onClick={() => {
                      setMode("cardio");
                      setCardioActivity(planned.activity);
                      setCardioDuration(String(planned.target_duration_min));
                    }}
                    className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2.5 text-left transition-colors ${
                      selected
                        ? "border-lime-border bg-lime-soft"
                        : "border-card-border bg-inner hover:border-card-border-strong"
                    }`}
                  >
                    <span className="flex flex-col gap-0.5">
                      <span className="font-semibold text-foreground">{cardioName(planned.activity, language)}</span>
                      {planned.notes && <span className="text-xs text-muted">{planned.notes}</span>}
                    </span>
                    <Badge tone="coral">{planned.target_duration_min} min</Badge>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <Segmented
            label={t("Tip de antrenament", "Workout mode")}
            value={mode}
            onChange={setMode}
            options={[
              { value: "strength", label: t("Forță", "Strength"), icon: Dumbbell },
              { value: "cardio", label: "Cardio", icon: Heart },
            ]}
          />

          {mode === "strength" && (
            <form onSubmit={handleAddSet}>
              <Card>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={<Text ro="Împărțire" en="Split" />}>
                    <Select
                      title={t("Împărțire", "Split")}
                      value={split}
                      onChange={(value) => {
                        const nextSplit = value as Split;
                        setSplit(nextSplit);
                        const nextList = getExercisesForSplit(nextSplit);
                        if (nextList[0]) setExercise(nextList[0]);
                      }}
                      options={SPLITS.map((s) => ({ value: s, label: workoutLabelText(s, t) }))}
                    />
                  </Field>
                  <Field label={<Text ro="Tip set" en="Set type" />}>
                    <Select
                      title={t("Tip set", "Set type")}
                      value={setType}
                      onChange={(value) => setSetType(value as SetType)}
                      options={SET_TYPES.map((type) => ({ value: type, label: workoutLabelText(type, t) }))}
                    />
                  </Field>
                </div>

                <div className="flex flex-col gap-2.5">
                  <ExerciseCombobox key={split} exercises={availableExercises} value={exercise} onChange={setExercise} />

                  {/* Structured exercise intelligence panel (coach target, history, all-time PR, plateau, progression) */}
                  {(activePlannedExercise || exerciseHint || recordHint || plateauHint || recommendedPerformance) && (
                    <div className="flex flex-col gap-2 rounded-md border border-card-border bg-inner p-3 text-[12.5px]">
                      {activePlannedExercise && (
                        <p className="flex items-center gap-2 font-semibold text-ice-text">
                          <Target className="size-3.5 shrink-0" />
                          <span>{t("Țintă antrenor", "Coach target")}: {formatExerciseTarget(activePlannedExercise, format, t)}</span>
                        </p>
                      )}
                      {exerciseHint && (
                        <p className={`flex items-center gap-2 font-medium ${
                          latestRecord ? "font-semibold text-lime-text" : exerciseHint.includes(t("Exercițiu nou", "New exercise")) ? "text-muted" : "text-foreground"
                        }`}>
                          {latestRecord && <Trophy className="size-3.5 shrink-0 text-lime-text" />}
                          <span>{exerciseHint}</span>
                        </p>
                      )}
                      {recordHint && (
                        <p className="flex items-center gap-2 font-mono text-[11.5px] text-soft">
                          <Trophy className="size-3.5 shrink-0 text-gold-text" />
                          <span>{recordHint}</span>
                        </p>
                      )}
                      {plateauHint && (
                        <p role="status" className="flex items-start gap-2 rounded-sm border border-gold-border bg-gold-soft px-2.5 py-1.5 font-medium text-gold-text">
                          <Hourglass className="mt-0.5 size-3.5 shrink-0" />
                          <span>{plateauHint}</span>
                        </p>
                      )}
                      {recommendedPerformance && !recommendedIsNew && (
                        <p className="flex items-center gap-2 border-t border-card-border pt-2 font-semibold text-lime-text">
                          <span>{recommendedPerformance}</span>
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-4 gap-2">
                  <Field label={<Text ro="Set" en="Set" />} htmlFor="set-number">
                    <Input id="set-number" center type="number" readOnly aria-readonly="true"
                      value={sessionSets.filter((s) => s.exercise === exercise).length + 1} compact />
                  </Field>
                  <Field label={unit} htmlFor="set-weight">
                    <Input id="set-weight" big type="number" inputMode="decimal" step="0.5" min={0} max={Math.floor(toUnit(10000))}
                      value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="0" compact />
                  </Field>
                  <Field label={<Text ro="Repetări" en="Reps" />} htmlFor="set-reps">
                    <Input id="set-reps" big type="number" inputMode="numeric" min={1} required
                      value={reps} onChange={(e) => setReps(e.target.value)} placeholder="0" compact />
                  </Field>
                  <Field label="RIR" htmlFor="set-rir">
                    <Input id="set-rir" big type="number" inputMode="numeric" min={0} max={5}
                      value={rir} onChange={(e) => setRir(e.target.value)} placeholder="–" compact />
                  </Field>
                </div>

                <Field label={<><Text ro="Notițe" en="Notes" /> <span className="font-normal opacity-70"><Text ro="(opțional)" en="(optional)" /></span></>} htmlFor="set-notes">
                  <Input id="set-notes" type="text" maxLength={99} value={notes} onChange={(e) => setNotes(e.target.value)}
                    placeholder={t("Ex: Scaunul la 3...", "E.g. Seat at 3...")} />
                </Field>

                <Button type="submit" icon={Plus} className="w-full">
                  <Text ro="Adaugă setul" en="Add set" />
                </Button>
                <RestTimerSettings timer={restTimer} />
              </Card>
            </form>
          )}

          {mode === "cardio" && (
            <form onSubmit={handleAddCardio}>
              <Card>
                <Field label={<Text ro="Activitate (LISS / HIIT)" en="Activity (LISS / HIIT)" />}>
                  <Select
                    title={t("Activitate", "Activity")}
                    value={cardioActivity}
                    onChange={setCardioActivity}
                    options={CARDIO_ACTIVITIES.map((act) => ({ value: act, label: cardioName(act, language) }))}
                  />
                </Field>
                <Field label={<Text ro="Durată (minute)" en="Duration (minutes)" />} htmlFor="cardio-duration">
                  <Input id="cardio-duration" big type="number" inputMode="numeric" min={1} required
                    value={cardioDuration} onChange={(e) => setCardioDuration(e.target.value)} placeholder={t("ex: 30", "e.g. 30")} />
                </Field>
                <Button type="submit" icon={Plus} className="w-full">
                  <Text ro="Adaugă activitatea" en="Add activity" />
                </Button>
              </Card>
            </form>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3.5 lg:sticky lg:top-6">
          <div className="flex items-center justify-between gap-2 px-0.5">
            <Eyebrow>
              <Text ro="Sesiunea curentă" en="Current session" />
            </Eyebrow>
            <span className="font-mono text-[11px] font-semibold text-muted tabular-nums">
              {mode === "strength"
                ? `${sessionSets.length} ${t("seturi", "sets")}`
                : `${cardioEntries.length} ${t("intrări", "entries")}`}
            </span>
          </div>

          {mode === "strength" ? (
            <SetRows
              rows={sessionSets.map((s, index) => ({
                key: s.id, ordinal: ordinals[index], exercise: s.exercise, weightKg: s.weight, reps: s.reps,
                rir: s.rir, setType: s.setType, notes: s.notes, record: personalRecords.has(s.id),
              }))}
              onRemove={(key) => setSessionSets((prev) => prev.filter((x) => x.id !== key))}
              empty={t("Niciun set încă. Adaugă primul set din panoul din stânga.", "No sets yet. Log your first set to build this session.")}
            />
          ) : (
            <CardioRows
              rows={cardioEntries.map((c) => ({ key: c.id, activity: c.activity, durationMin: c.durationMin }))}
              onRemove={(key) => setCardioEntries((prev) => prev.filter((x) => x.id !== key))}
              empty={t("Nicio activitate încă.", "No activities yet.")}
            />
          )}

          {error && <Message>{error}</Message>}

          {hasEntries && (
            <Button large icon={Save} onClick={handleFinish} busy={isSaving || saveLocked} className="mt-1 w-full">
              <Text ro="Finalizează antrenamentul" en="Finish workout" />
            </Button>
          )}
        </div>
      </div>
      <RestTimerBar timer={restTimer} />
      {finished && (
        <WorkoutSummaryDialog
          input={finished.input}
          onClose={() => {
            // /offline needs a full load: without network the router cannot fetch it.
            if (finished.next === "/offline") window.location.assign(finished.next);
            else router.push(finished.next);
          }}
        />
      )}
    </Screen>
  );
}
