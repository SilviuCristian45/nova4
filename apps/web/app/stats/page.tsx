"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import {
  ComposedChart, Area, Scatter, Line, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { EXERCISES, CARDIO_ACTIVITIES } from "@/lib/workout-data";
import { clientApi } from "@/lib/api/client";
import { ApiError, type ApiProfile } from "@/lib/api/types";
import {
  getStrengthProgression, strengthProgressionCsv, withBodyWeights, type StrengthWorkout,
} from "@/lib/strength-progression";
import { chartMode, localDate, measurementPoints } from "@/lib/daily-metrics";
import { checkinSeries, type CheckinValues } from "@/lib/checkin";
import { useUnits } from "@/app/components/units-provider";
import { useLanguage } from "@/app/components/language-provider";
import { cardioName, exerciseName as localizedExercise } from "@/lib/exercise-catalog";
import { Button, Card, Eyebrow, Field, Label, Screen, Segmented, Select, TextLink, cx } from "@/app/components/ui";

type Workout = StrengthWorkout & {
  cardio_sessions: { activity: string; duration_min: number | null }[] | null;
};
type Measurement = { date: string; value: number };
type ChartPoint = {
  date: string;
  weight?: number;
  reps?: number;
  bodyWeight?: number | null;
  duration?: number;
  value?: number;
  target?: number;
  energy?: number | null;
  satiety?: number | null;
  sleep?: number | null;
};

type KpiTile = {
  label: string;
  value: string;
  sub?: string;
  tone?: "lime" | "coral" | "ice" | "lilac" | "gold";
};

const tooltipStyle = {
  backgroundColor: "var(--card)",
  border: "1px solid var(--card-border-strong)",
  color: "var(--foreground)",
  borderRadius: "10px",
  padding: "10px 12px",
  boxShadow: "0 12px 28px -8px rgba(0, 0, 0, 0.25)",
  fontSize: "12.5px",
};
const tooltipClass = "rounded-md border border-card-border-strong bg-card px-3 py-2.5 text-[12.5px] font-semibold shadow-lg";
const showDotsThreshold = 24;
const chartCursor = { stroke: "var(--chart-axis)", strokeDasharray: "4 4", strokeOpacity: 0.6 };
const axisTickStyle = { fill: "var(--chart-axis)", fontFamily: "var(--font-jetbrains-mono), monospace" };

function makeDot(stroke: string, show: boolean) {
  if (!show) return false;
  return { r: 3.5, fill: "var(--card)", stroke, strokeWidth: 2 };
}

function makeActiveDot(fill: string) {
  return { r: 6, fill, stroke: "var(--card)", strokeWidth: 2.5 };
}

export default function StatsPage() {
  return <Suspense><StatsContent /></Suspense>;
}

function StatsContent() {
  const { t, locale, language } = useLanguage();
  const { unit, toUnit } = useUnits();
  const router = useRouter();
  const params = useSearchParams();
  const mode = chartMode(params.get("mode"));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [loadedKey, setLoadedKey] = useState("");
  const [workoutData, setWorkoutData] = useState<Workout[]>([]);
  const [bodyWeights, setBodyWeights] = useState<{ date: string; weight_kg: number }[]>([]);
  const [bodyWeightError, setBodyWeightError] = useState<string | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [checkins, setCheckins] = useState<({ date: string } & CheckinValues)[]>([]);
  const [stepsGoal, setStepsGoal] = useState(10000);
  const [selectedExercise, setSelectedExercise] = useState<string>(EXERCISES[0]);
  const [selectedCardio, setSelectedCardio] = useState<string>(CARDIO_ACTIVITIES[0]);
  const [timeRange, setTimeRange] = useState(30);
  const requestKey = `${mode}:${timeRange}:${retry}`;
  const isLoading = loading || loadedKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      setError(null);
      setWorkoutData([]);
      setBodyWeights([]);
      setBodyWeightError(null);
      setMeasurements([]);
      setCheckins([]);
      try {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - timeRange);
        const cutoffStr = timeRange === 7300 ? "1970-01-01" : localDate(cutoff);
        const endDate = localDate();

        if (mode === "strength" || mode === "cardio") {
          type ApiWorkoutList = {
            items: {
              performedOn: string;
              workoutMode: string;
              sets: { exercise: string; weight: number; reps: number; setType: string }[];
              cardio: { activity: string; durationMin: number }[];
            }[];
            total: number;
          };
          const rows: Workout[] = [];
          const PAGE = 500;
          for (let offset = 0; ; offset += PAGE) {
            const q = new URLSearchParams({
              mode,
              from: cutoffStr,
              to: endDate,
              limit: String(PAGE),
              offset: String(offset),
            });
            const res = await clientApi<ApiWorkoutList>(`/workouts?${q.toString()}`);
            if (cancelled) return;
            rows.push(
              ...res.items.map((w) => ({
                performed_on: w.performedOn,
                workout_mode: w.workoutMode,
                workout_sets: w.sets.map((s) => ({
                  exercise: s.exercise,
                  weight: s.weight,
                  reps: s.reps,
                  set_type: s.setType,
                })),
                cardio_sessions: w.cardio.map((c) => ({
                  activity: c.activity,
                  duration_min: c.durationMin,
                })),
              })),
            );
            if (rows.length >= res.total || res.items.length < PAGE) break;
          }
          rows.sort((a, b) => a.performed_on.localeCompare(b.performed_on));
          setWorkoutData(rows);
          if (mode === "strength") {
            try {
              const q = new URLSearchParams({ from: cutoffStr, to: endDate });
              const data = await clientApi<{ date: string; weightKg: number }[]>(`/metrics/weight?${q.toString()}`);
              if (cancelled) return;
              setBodyWeights(data.map((entry) => ({ date: entry.date, weight_kg: Number(entry.weightKg) })));
            } catch (err) {
              if (!cancelled) setBodyWeightError(err instanceof Error ? err.message : "load-failed");
            }
          }
        } else if (mode === "checkin") {
          const q = new URLSearchParams({ from: cutoffStr, to: endDate });
          const data = await clientApi<({ date: string } & CheckinValues)[]>(`/metrics/checkin?${q.toString()}`);
          if (cancelled) return;
          setCheckins(data.map((row) => ({ ...row, note: row.note ?? "" })));
        } else {
          const q = new URLSearchParams({ from: cutoffStr, to: endDate });
          if (mode === "steps") {
            const [stepRows, profile] = await Promise.all([
              clientApi<{ date: string; steps: number }[]>(`/metrics/steps?${q.toString()}`),
              clientApi<ApiProfile>("/profile"),
            ]);
            if (cancelled) return;
            setStepsGoal(profile.dailyStepsGoal || 10000);
            setMeasurements(stepRows.map((row) => ({ date: row.date, value: Number(row.steps) })));
          } else {
            const weightRows = await clientApi<{ date: string; weightKg: number }[]>(`/metrics/weight?${q.toString()}`);
            if (cancelled) return;
            setMeasurements(weightRows.map((row) => ({ date: row.date, value: Number(row.weightKg) })));
          }
        }
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError && err.status === 401) setError("unauthorized");
          else setError(err instanceof Error ? err.message : "load-failed");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLoadedKey(`${mode}:${timeRange}:${retry}`);
        }
      }
    }
    void fetchData();
    return () => { cancelled = true; };
  }, [timeRange, retry, mode]);

  // Charts and CSV show the user's unit; the data stays in kg until this point.
  const strengthData = useMemo(
    () =>
      withBodyWeights(
        getStrengthProgression(workoutData, selectedExercise, locale),
        bodyWeights,
      ).map((point) => ({
        ...point,
        weight: toUnit(point.weight),
        bodyWeight: point.bodyWeight == null ? point.bodyWeight : toUnit(point.bodyWeight),
      })),
    [workoutData, selectedExercise, locale, bodyWeights, toUnit],
  );
  const hasBodyWeights = strengthData.some((point) => point.bodyWeight != null);

  const chartData: ChartPoint[] = useMemo(() => {
    if (mode === "strength") return strengthData;
    if (mode === "cardio") {
      return workoutData.flatMap((workout) => {
        const sessions = workout.cardio_sessions?.filter((session) => session.activity === selectedCardio);
        return sessions?.length
          ? [
              {
                date: new Date(`${workout.performed_on}T00:00:00`).toLocaleDateString(locale, { month: "short", day: "numeric" }),
                duration: sessions.reduce((sum, session) => sum + Number(session.duration_min || 0), 0),
              },
            ]
          : [];
      });
    }
    if (mode === "checkin") {
      return checkinSeries(checkins).map((row) => ({
        date: new Date(`${row.date}T00:00:00`).toLocaleDateString(locale, { month: "short", day: "numeric" }),
        energy: row.energy,
        satiety: row.satiety,
        sleep: row.sleep,
      }));
    }
    return measurementPoints(measurements, locale).map((day) => ({
      date: day.label,
      value: mode === "weight" ? toUnit(day.value) : day.value,
      ...(mode === "steps" ? { target: stepsGoal } : {}),
    }));
  }, [mode, strengthData, workoutData, selectedCardio, locale, checkins, measurements, toUnit, stepsGoal]);

  // Mode-aware summary KPIs rendered above the chart.
  const kpis: KpiTile[] = useMemo(() => {
    if (isLoading || chartData.length === 0) return [];
    const fmtNum = (n: number, digits = 1) => Number(n.toFixed(digits)).toLocaleString(locale);

    if (mode === "strength") {
      const weights = chartData.map((p) => p.weight ?? 0);
      const peak = Math.max(...weights);
      const first = chartData[0];
      const latest = chartData[chartData.length - 1];
      const delta = (latest.weight ?? 0) - (first.weight ?? 0);
      return [
        { label: t("Maxim perioadă", "Period peak"), value: `${fmtNum(peak)} ${unit}`, tone: "lime" },
        { label: t("Ultima sesiune", "Latest"), value: `${fmtNum(latest.weight ?? 0)} ${unit}`, sub: latest.reps ? `${latest.reps} reps` : undefined },
        {
          label: t("Evoluție", "Delta"),
          value: `${delta > 0 ? "+" : ""}${fmtNum(delta)} ${unit}`,
          tone: delta > 0 ? "lime" : delta < 0 ? "coral" : undefined,
        },
        { label: t("Sesiuni", "Sessions"), value: String(chartData.length) },
      ];
    }

    if (mode === "cardio") {
      const durations = chartData.map((p) => p.duration ?? 0);
      const total = durations.reduce((a, b) => a + b, 0);
      const peak = Math.max(...durations);
      return [
        { label: t("Total", "Total"), value: `${Math.round(total).toLocaleString(locale)} min`, tone: "coral" },
        { label: t("Medie", "Average"), value: `${Math.round(total / durations.length)} min` },
        { label: t("Maxim", "Longest"), value: `${Math.round(peak)} min` },
        { label: t("Sesiuni", "Sessions"), value: String(chartData.length) },
      ];
    }

    if (mode === "steps") {
      const vals = chartData.map((p) => p.value ?? 0);
      const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      const peak = Math.max(...vals);
      const hitGoal = vals.filter((v) => v >= stepsGoal).length;
      return [
        { label: t("Medie zilnică", "Daily avg"), value: avg.toLocaleString(locale), tone: avg >= stepsGoal ? "lime" : "gold" },
        { label: t("Maxim", "Best day"), value: peak.toLocaleString(locale) },
        { label: t("Obiectiv atins", "Goals hit"), value: `${hitGoal}/${vals.length}`, tone: "lime" },
        { label: t("Obiectiv", "Target"), value: stepsGoal.toLocaleString(locale) },
      ];
    }

    if (mode === "weight") {
      const vals = chartData.map((p) => p.value ?? 0);
      const latest = vals[vals.length - 1];
      const delta = latest - vals[0];
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      return [
        { label: t("Ultima", "Latest"), value: `${fmtNum(latest)} ${unit}`, tone: "lilac" },
        { label: t("Schimbare", "Change"), value: `${delta > 0 ? "+" : ""}${fmtNum(delta)} ${unit}`, tone: delta !== 0 ? "ice" : undefined },
        { label: t("Min / Max", "Range"), value: `${fmtNum(min)}–${fmtNum(max)}`, sub: unit },
        { label: t("Cântăriri", "Entries"), value: String(vals.length) },
      ];
    }

    const avgField = (field: "energy" | "satiety" | "sleep") => {
      const vals = chartData.map((p) => p[field]).filter((v): v is number => typeof v === "number");
      if (!vals.length) return "—";
      return `${(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)}/10`;
    };
    return [
      { label: t("Medie energie", "Avg energy"), value: avgField("energy"), tone: "lime" },
      { label: t("Medie sațietate", "Avg satiety"), value: avgField("satiety"), tone: "coral" },
      { label: t("Medie somn", "Avg sleep"), value: avgField("sleep"), tone: "ice" },
      { label: t("Zile", "Days"), value: String(chartData.length) },
    ];
  }, [isLoading, chartData, mode, unit, stepsGoal, locale, t]);

  function exportCsv() {
    try {
      const url = URL.createObjectURL(new Blob(
        [strengthProgressionCsv(strengthData, selectedExercise, unit)],
        { type: "text/csv;charset=utf-8;" },
      ));
      const link = document.createElement("a");
      link.href = url;
      const exerciseName = selectedExercise.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
      link.download = `strength-${exerciseName}-${timeRange === 7300 ? "all" : `${timeRange}d`}.csv`;
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      setError("export-failed");
    }
  }

  const errorMessage = error === "unauthorized"
    ? t("Sesiune expirată. Autentifică-te din nou.", "Session expired. Please sign in again.")
    : error === "weight-setup"
      ? t("Urmărirea greutății necesită migrarea bazei de date. Consultă README.", "Weight tracking requires the database migration. See README.")
      : error === "checkin-setup"
        ? t("Check-in-ul necesită migrarea bazei de date. Consultă README.", "Check-ins require the database migration. See README.")
        : error === "export-failed"
          ? t("Exportul CSV a eșuat. Încearcă din nou.", "CSV export failed. Please retry.")
          : t("Nu am putut încărca datele graficului.", "Unable to load chart data.") + (error && error !== "load-failed" ? ` (${error})` : "");

  const measurementMode = mode === "steps" || mode === "weight";
  const checkinMode = mode === "checkin";
  const chartTitle = mode === "strength"
    ? localizedExercise(selectedExercise, language)
    : mode === "cardio"
      ? cardioName(selectedCardio, language)
      : mode === "checkin"
        ? t("Stare zilnică", "Daily readiness")
        : mode === "steps"
          ? t("Pași zilnici", "Daily steps")
          : t(`Greutate corporală (${unit})`, `Body weight (${unit})`);

  return (
    <Screen
      title={t("Progres & analiză", "Progress & Analytics")}
      right={
        mode === "strength" ? (
          <Button variant="secondary" small icon={Download} onClick={exportCsv} disabled={isLoading || !strengthData.length}>
            {t("Export CSV", "Export CSV")}
          </Button>
        ) : undefined
      }
    >
      <Segmented
        label={t("Tip de grafic", "Chart type")}
        value={mode}
        onChange={(value) => router.replace(`/stats?mode=${value}`, { scroll: false })}
        options={[
          { value: "strength", label: t("Forță", "Strength") },
          { value: "cardio", label: t("Cardio", "Cardio") },
          { value: "steps", label: t("Pași", "Steps") },
          { value: "weight", label: t("Greutate", "Weight") },
          { value: "checkin", label: t("Stare", "Readiness") },
        ]}
      />

      {error && !isLoading && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-border bg-red-soft p-3.5 text-sm font-semibold text-red-text">
          <p>{errorMessage}</p>
          <Button variant="soft" tone="red" small onClick={() => setRetry((value) => value + 1)}>{t("Reîncearcă", "Retry")}</Button>
        </div>
      )}

      {/* Summary KPI strip */}
      {kpis.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpis.map((kpi) => {
            const valTone =
              kpi.tone === "lime"
                ? "text-lime-text"
                : kpi.tone === "coral"
                  ? "text-coral-text"
                  : kpi.tone === "ice"
                    ? "text-ice-text"
                    : kpi.tone === "lilac"
                      ? "text-lilac-text"
                      : kpi.tone === "gold"
                        ? "text-gold-text"
                        : "text-foreground";
            return (
              <Card key={kpi.label} className="gap-1 p-4">
                <Eyebrow>{kpi.label}</Eyebrow>
                <p className="flex items-baseline gap-1.5">
                  <span className={cx("font-mono text-[22px] font-bold leading-tight tracking-[-0.03em] tabular-nums", valTone)}>
                    {kpi.value}
                  </span>
                  {kpi.sub && <span className="font-mono text-[11px] text-muted">{kpi.sub}</span>}
                </p>
              </Card>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[296px_minmax(0,1fr)] lg:items-start lg:gap-5">
        <Card aria-label={t("Filtre grafic", "Chart filters")}>
          <Eyebrow>{t("Parametri analiză", "Analysis controls")}</Eyebrow>
          {!measurementMode && !checkinMode && (
            <Field label={mode === "strength" ? t("Exercițiu urmărit", "Tracked exercise") : t("Activitate cardio", "Cardio activity")}>
              {mode === "strength" ? (
                <Select
                  searchable
                  title={t("Exercițiu urmărit", "Tracked exercise")}
                  value={selectedExercise}
                  onChange={setSelectedExercise}
                  options={EXERCISES.map((exercise) => ({ value: exercise, label: localizedExercise(exercise, language) }))}
                />
              ) : (
                <Select
                  title={t("Activitate cardio", "Cardio activity")}
                  value={selectedCardio}
                  onChange={setSelectedCardio}
                  options={CARDIO_ACTIVITIES.map((activity) => ({ value: activity, label: cardioName(activity, language) }))}
                />
              )}
            </Field>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>{t("Perioadă analizată", "Time period")}</Label>
            <Segmented
              inCard
              label={t("Perioadă analizată", "Time period")}
              value={String(timeRange)}
              onChange={(value) => setTimeRange(Number(value))}
              options={[
                { label: t("7Z", "7D"), days: 7 },
                { label: t("1L", "1M"), days: 30 },
                { label: t("3L", "3M"), days: 90 },
                { label: t("6L", "6M"), days: 180 },
                { label: t("1A", "1Y"), days: 365 },
                { label: t("2A", "2Y"), days: 730 },
                { label: t("TOT", "ALL"), days: 7300 },
              ].map((range) => ({ value: String(range.days), label: range.label }))}
            />
          </div>
          {checkinMode && (
            <p className="border-t border-card-border pt-3 text-[12.5px] text-soft">
              {t("Energie, sațietate și somn (1–10) din check-in-urile zilnice. Zilele fără răspuns nu sunt considerate zero.", "Energy, satiety and sleep (1–10) from your daily check-ins. Days without an answer are not counted as zero.")}
            </p>
          )}
          {measurementMode && (
            <p className="border-t border-card-border pt-3 text-[12.5px] text-soft">
              {mode === "steps"
                ? t("Pașii înregistrați zilnic și obiectivul tău curent.", "Your recorded daily steps and current goal.")
                : t(`Cântăririle tale în ${unit}. Zilele fără înregistrări nu sunt considerate zero.`, `Your weigh-ins in ${unit}. Days without an entry are not counted as zero.`)}
            </p>
          )}
        </Card>

        <Card aria-label={t("Grafic evoluție", "Progress chart")} className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-col gap-0.5">
              <Eyebrow>{t("Evoluție în timp", "Trend line")}</Eyebrow>
              <h2 className="text-[19px] font-bold tracking-[-0.02em]">{chartTitle}</h2>
            </div>
            <span className="font-mono text-[11px] text-muted tabular-nums">
              {chartData.length} {t("puncte", "pts")}
            </span>
          </div>

          {isLoading ? (
            <p role="status" className="flex min-h-[320px] items-center justify-center font-mono text-xs text-muted">
              {t("Analizăm datele...", "Loading chart data...")}
            </p>
          ) : chartData.length === 0 || (error && error !== "export-failed") ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-center text-muted">
              <p className="text-sm font-medium">
                {error
                  ? t("Graficul nu este disponibil. Reîncearcă încărcarea datelor.", "Chart unavailable. Please retry loading.")
                  : t("Nu există înregistrări în această perioadă.", "No entries in this period.")}
              </p>
              {(measurementMode || checkinMode) && !error && <TextLink href="/">{t("Adaugă o înregistrare", "Add an entry")}</TextLink>}
            </div>
          ) : (
            <div className="h-[300px] w-full min-w-0 sm:h-[380px] lg:h-[440px]">
              <ResponsiveContainer width="100%" height="100%">
                {checkinMode ? (
                  <ComposedChart data={chartData} margin={{ top: 12, right: 12, left: -10, bottom: 10 }}>
                    <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="4 4" vertical={false} />
                    <XAxis dataKey="date" fontSize={10.5} tickLine={false} axisLine={false} tick={axisTickStyle} dy={10} />
                    <YAxis fontSize={10.5} tickLine={false} axisLine={false} tick={axisTickStyle} domain={[1, 10]} ticks={[1, 3, 5, 7, 10]} allowDecimals={false} />
                    <Tooltip cursor={chartCursor} contentStyle={tooltipStyle} labelStyle={{ color: "var(--muted)", fontSize: 11, fontFamily: "var(--font-jetbrains-mono), monospace" }} itemStyle={{ fontWeight: 600 }} />
                    <Legend wrapperStyle={{ paddingTop: 22, fontSize: 12 }} iconType="circle" />
                    <Line type="monotone" dataKey="energy" name={t("Energie", "Energy")} stroke="var(--lime-text)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
                      dot={makeDot("var(--lime-text)", chartData.length <= showDotsThreshold)} activeDot={makeActiveDot("var(--lime-text)")} connectNulls animationDuration={450} />
                    <Line type="monotone" dataKey="satiety" name={t("Sațietate", "Satiety")} stroke="var(--coral-text)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
                      dot={makeDot("var(--coral-text)", chartData.length <= showDotsThreshold)} activeDot={makeActiveDot("var(--coral-text)")} connectNulls animationDuration={450} />
                    <Line type="monotone" dataKey="sleep" name={t("Somn", "Sleep")} stroke="var(--ice-text)" strokeWidth={2.25} strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round"
                      dot={makeDot("var(--ice-text)", chartData.length <= showDotsThreshold)} activeDot={makeActiveDot("var(--ice-text)")} connectNulls animationDuration={450} />
                  </ComposedChart>
                ) : measurementMode ? (
                  <ComposedChart data={chartData} margin={{ top: 12, right: 12, left: -10, bottom: 10 }}>
                    <defs>
                      <linearGradient id="stats-measurement-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={mode === "steps" ? "var(--lime-text)" : "var(--lilac-text)"} stopOpacity={0.26} />
                        <stop offset="100%" stopColor={mode === "steps" ? "var(--lime-text)" : "var(--lilac-text)"} stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="4 4" vertical={false} />
                    <XAxis dataKey="date" fontSize={10.5} tickLine={false} axisLine={false} tick={axisTickStyle} dy={10} />
                    <YAxis
                      fontSize={10.5}
                      tickLine={false}
                      axisLine={false}
                      tick={axisTickStyle}
                      allowDecimals={mode === "weight"}
                      domain={
                        mode === "steps"
                          ? [0, (max: number) => Math.max(max, stepsGoal) + 2000]
                          : [(min: number) => Math.max(0, Math.floor(min - 1)), (max: number) => Math.ceil(max + 1)]
                      }
                      unit={mode === "weight" ? ` ${unit}` : undefined}
                    />
                    <Tooltip
                      cursor={chartCursor}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const point = payload[0].payload as ChartPoint;
                        const value = point.value ?? 0;
                        return (
                          <div className={tooltipClass}>
                            <p className="mb-1 font-mono text-[11px] text-muted">{point.date}</p>
                            <p className={mode === "steps" ? "text-lime-text" : "text-lilac-text"}>
                              {mode === "steps" ? t("Pași", "Steps") : t("Greutate", "Weight")}: {value.toLocaleString(locale)}{mode === "weight" ? ` ${unit}` : ""}
                            </p>
                            {mode === "steps" && (
                              <>
                                <p className="font-mono text-[11.5px] text-muted">{t("Obiectiv", "Goal")}: {stepsGoal.toLocaleString(locale)}</p>
                                <p className={value >= stepsGoal ? "text-lime-text" : "text-gold-text"}>
                                  {value >= stepsGoal ? t("Obiectiv atins", "Goal reached") : `${(stepsGoal - value).toLocaleString(locale)} ${t("pași rămași", "steps remaining")}`}
                                </p>
                              </>
                            )}
                          </div>
                        );
                      }}
                    />
                    <Legend wrapperStyle={{ paddingTop: 22, fontSize: 12 }} iconType="circle" />
                    {mode === "steps" && <Line type="monotone" dataKey="target" name={t("Obiectiv zilnic", "Daily goal")} stroke="var(--chart-axis)" strokeWidth={1.75} strokeDasharray="6 6" strokeLinecap="round" dot={false} activeDot={false} />}
                    <Area
                      type="monotone"
                      dataKey="value"
                      name={mode === "steps" ? t("Pași efectuați", "Steps recorded") : t(`Greutate (${unit})`, `Weight (${unit})`)}
                      stroke={mode === "steps" ? "var(--lime-text)" : "var(--lilac-text)"}
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="url(#stats-measurement-fill)"
                      dot={makeDot(mode === "steps" ? "var(--lime-text)" : "var(--lilac-text)", chartData.length <= showDotsThreshold)}
                      activeDot={makeActiveDot(mode === "steps" ? "var(--lime-text)" : "var(--lilac-text)")}
                      animationDuration={450}
                    />
                  </ComposedChart>
                ) : (
                  <ComposedChart data={chartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="stats-strength-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--lime-text)" stopOpacity={0.26} />
                        <stop offset="100%" stopColor="var(--lime-text)" stopOpacity={0.01} />
                      </linearGradient>
                      <linearGradient id="stats-cardio-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--coral-text)" stopOpacity={0.26} />
                        <stop offset="100%" stopColor="var(--coral-text)" stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="4 4" vertical={false} />
                    <XAxis dataKey="date" fontSize={10.5} tickLine={false} axisLine={false} tick={axisTickStyle} dy={10} />
                    <YAxis yAxisId="primary" width={54} fontSize={10} tickLine={false} axisLine={false} tick={axisTickStyle} domain={[0, "auto"]} unit={mode === "strength" ? ` ${unit}` : " min"} />
                    {mode === "strength" && (
                      <YAxis
                        yAxisId="reps"
                        orientation="right"
                        width={32}
                        fontSize={10}
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                        tick={{ fill: "var(--ice-text)", fontFamily: "var(--font-jetbrains-mono), monospace" }}
                        domain={[0, "auto"]}
                      />
                    )}
                    <Tooltip cursor={chartCursor} contentStyle={tooltipStyle} labelStyle={{ color: "var(--muted)", fontSize: 11, fontFamily: "var(--font-jetbrains-mono), monospace" }} itemStyle={{ fontWeight: 600 }} />
                    <Legend wrapperStyle={{ paddingTop: 20, fontSize: 12 }} iconType="circle" />
                    {mode === "strength" ? (
                      <>
                        <Area
                          yAxisId="primary"
                          type="monotone"
                          dataKey="weight"
                          name={t(`Greutate ridicată (${unit})`, `Lifted weight (${unit})`)}
                          stroke="var(--lime-text)"
                          strokeWidth={2.5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          fill="url(#stats-strength-fill)"
                          dot={makeDot("var(--lime-text)", chartData.length <= showDotsThreshold)}
                          activeDot={makeActiveDot("var(--lime-text)")}
                          animationDuration={450}
                        />
                        <Line
                          yAxisId="reps"
                          type="monotone"
                          dataKey="reps"
                          name={t("Repetări", "Reps")}
                          stroke="var(--ice-text)"
                          strokeWidth={2.25}
                          strokeDasharray="5 4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          dot={makeDot("var(--ice-text)", chartData.length <= showDotsThreshold)}
                          activeDot={makeActiveDot("var(--ice-text)")}
                          animationDuration={450}
                        />
                        {hasBodyWeights && (
                          <Scatter
                            yAxisId="primary"
                            dataKey="bodyWeight"
                            name={t(`Greutate corporală (${unit})`, `Body weight (${unit})`)}
                            fill="var(--lilac-text)"
                          />
                        )}
                      </>
                    ) : (
                      <Area
                        yAxisId="primary"
                        type="monotone"
                        dataKey="duration"
                        name={t("Durată (min)", "Duration (min)")}
                        stroke="var(--coral-text)"
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="url(#stats-cardio-fill)"
                        dot={makeDot("var(--coral-text)", chartData.length <= showDotsThreshold)}
                        activeDot={makeActiveDot("var(--coral-text)")}
                        animationDuration={450}
                      />
                    )}
                  </ComposedChart>
                )}
              </ResponsiveContainer>
            </div>
          )}

          {mode === "strength" && (
            <div className="flex flex-col gap-1 border-t border-card-border pt-3 text-[11.5px] text-muted">
              <p>{t(`Maxime pe sesiune din seturile de lucru: greutate (${unit}, stânga) și repetări (albastru, dreapta).`, `Session working-set maxima: weight (${unit}, left) and reps (blue, right).`)}</p>
              {hasBodyWeights && (
                <p>{t("Punctele mov arată greutatea corporală înregistrată în ziua antrenamentului.", "Purple dots show body weight recorded on the workout date.")}</p>
              )}
            </div>
          )}
          {mode === "strength" && bodyWeightError && !isLoading && (
            <div role="alert" className="text-xs font-semibold text-red-text">
              <p>{t("Greutatea corporală nu a putut fi încărcată. Datele de forță sunt afișate în continuare.", "Body weight could not be loaded. Strength data is still shown.")} ({bodyWeightError})</p>
              <button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-1 underline">{t("Reîncearcă", "Retry")}</button>
            </div>
          )}
        </Card>
      </div>
    </Screen>
  );
}
