"use client";

// Workout pieces shared by /insert, /offline and /edit so the three look consistent:
// set-type badges and structured session rows with tabular telemetry.

import type { ReactNode } from "react";
import { Pencil, Trash2, Trophy } from "lucide-react";
import { useLanguage } from "./language-provider";
import { useUnits } from "./units-provider";
import { CardioName, ExerciseName } from "./exercise-name";
import { ExerciseGifButton } from "./exercise-gif";
import { WorkoutLabel } from "./workout-label";
import { Badge, IconButton, cx, type Tone } from "./ui";

// Colour family of a set type: Working → lime, Warmup → ice, Feeder → gold, Top set / Backoff → lilac,
// Drop / Failure → red; anything else stays neutral.
export function setTypeTone(type: string): Tone | undefined {
  const value = type?.toLowerCase() ?? "";
  if (value.includes("warm") || value.includes("încălzire")) return "ice";
  if (value.includes("feeder")) return "gold";
  if (value.includes("work")) return "lime";
  if (value.includes("top") || value.includes("back")) return "lilac";
  if (value.includes("drop") || value.includes("fail")) return "red";
  return undefined;
}

export function SetTypeBadge({ type }: { type: string }) {
  return <Badge tone={setTypeTone(type)}><WorkoutLabel value={type} /></Badge>;
}

export function RecordBadge() {
  const { t } = useLanguage();
  return (
    <Badge tone="lime" className="gap-1">
      <Trophy className="size-3" aria-hidden="true" />
      {t("Record personal", "Personal best")}
    </Badge>
  );
}

export type SetRowData = {
  key: string;
  ordinal: number;
  exercise: string;
  weightKg: number;
  reps: number;
  rir: number | null;
  setType: string;
  notes?: string | null;
  record?: boolean;
  extra?: ReactNode;
};

// One architectural card holding every set of the session. `onEdit` / `onRemove` add plain pencil / bin buttons.
export function SetRows({ rows, onEdit, onRemove, editingKey, empty }: {
  rows: SetRowData[]; onEdit?: (key: string) => void; onRemove?: (key: string) => void; editingKey?: string | null; empty?: ReactNode;
}) {
  const { t } = useLanguage();
  const { format } = useUnits();
  if (rows.length === 0) {
    return empty ? (
      <p className="surface-card rounded-lg border border-dashed border-card-border-strong bg-card px-5 py-8 text-center text-[13.5px] font-medium text-muted">
        {empty}
      </p>
    ) : null;
  }
  return (
    <ul className="surface-card flex flex-col overflow-hidden rounded-lg border border-card-border bg-card">
      {rows.map((row, index) => (
        <li
          key={row.key}
          className={cx(
            "flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-inner/40",
            index > 0 && "border-t border-line",
            editingKey === row.key && "bg-lime-soft hover:bg-lime-soft",
          )}
        >
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-sm border border-card-border bg-inner font-mono text-[11.5px] font-semibold text-muted tabular-nums">
            {row.ordinal}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-start justify-between gap-1.5">
              <p className="min-w-0 flex-1 break-words text-[14.5px] font-semibold leading-snug text-foreground">
                <ExerciseName id={row.exercise} />
              </p>
              <ExerciseGifButton exercise={row.exercise} compact />
            </div>
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="font-mono text-[17px] font-bold tracking-[-0.02em] text-foreground tabular-nums">
                {row.weightKg > 0 ? `${format(row.weightKg)} × ` : ""}{row.reps}
                {row.weightKg > 0 ? "" : <span className="ml-1 font-sans text-[13px] font-normal text-muted">{t("repetări", "reps")}</span>}
              </span>
              {row.rir !== null && (
                <span className="rounded-sm bg-inner px-1.5 py-0.5 font-mono text-[11px] font-medium text-soft tabular-nums">
                  RIR {row.rir}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <SetTypeBadge type={row.setType} />
              {row.record && <RecordBadge />}
              {row.extra}
            </div>
            {row.notes && <p className="whitespace-pre-wrap break-words text-[12.5px] text-muted">{row.notes}</p>}
          </div>
          {(onEdit || onRemove) && (
            <div className="-mr-1 flex shrink-0 items-center gap-0.5">
              {onEdit && <IconButton plain icon={Pencil} label={`${t("Editează setul", "Edit set")} ${row.ordinal}`} onClick={() => onEdit(row.key)} />}
              {onRemove && <IconButton plain icon={Trash2} label={`${t("Elimină setul", "Remove set")} ${row.ordinal}`} onClick={() => onRemove(row.key)} />}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function CardioRows({ rows, onRemove, empty }: {
  rows: { key: string; activity: string; durationMin: number }[]; onRemove?: (key: string) => void; empty?: ReactNode;
}) {
  const { t, locale } = useLanguage();
  if (rows.length === 0) {
    return empty ? (
      <p className="surface-card rounded-lg border border-dashed border-card-border-strong bg-card px-5 py-8 text-center text-[13.5px] font-medium text-muted">
        {empty}
      </p>
    ) : null;
  }
  return (
    <ul className="surface-card flex flex-col overflow-hidden rounded-lg border border-card-border bg-card">
      {rows.map((row, index) => (
        <li
          key={row.key}
          className={cx(
            "flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-inner/40",
            index > 0 && "border-t border-line",
          )}
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-sm border border-coral-border bg-coral-soft font-mono text-[11.5px] font-semibold text-coral-text tabular-nums">
            {index + 1}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="break-words text-[14.5px] font-semibold text-foreground"><CardioName id={row.activity} /></p>
            <p className="font-mono text-[16px] font-bold text-coral-text tabular-nums">
              {row.durationMin.toLocaleString(locale)} <span className="font-sans text-[12.5px] font-normal text-muted">min</span>
            </p>
          </div>
          {onRemove && <IconButton plain icon={Trash2} className="-mr-1" label={`${t("Elimină activitatea", "Remove activity")} ${index + 1}`} onClick={() => onRemove(row.key)} />}
        </li>
      ))}
    </ul>
  );
}
