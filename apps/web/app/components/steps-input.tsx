// app/components/steps-input.tsx
"use client";

import { useState } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { useLanguage } from "@/app/components/language-provider";
import { saveDailySteps } from "../steps/steps";
import { updateDailyGoal } from "../profiles/profile";
import { saveOfflineMutation, useOffline } from "@/lib/offline/client";
import { Button, Card, Eyebrow, ProgressBar, TextLink, cx } from "@/app/components/ui";

interface StepsInputProps {
  initialSteps: number;
  date: string;
  goal: number;
}

// Today's steps instrument: inline editable readout + integrated goal editor (no separate settings card).
export default function StepsInput({ initialSteps, date, goal }: StepsInputProps) {
  const { t, locale } = useLanguage();
  const { ownerId, snapshot } = useOffline();

  const [steps, setSteps] = useState(initialSteps.toString());
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [activeGoal, setActiveGoal] = useState(goal);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState(goal.toString());
  const [savingGoal, setSavingGoal] = useState(false);

  const storedSteps = snapshot?.steps.find((entry) => entry.date === date)?.steps ?? initialSteps;
  const hasChanged = Number(steps) !== storedSteps;
  const pct = activeGoal > 0 ? Math.min(100, Math.round((storedSteps / activeGoal) * 100)) : 0;
  const achieved = activeGoal > 0 && storedSteps >= activeGoal;

  async function handleSubmit() {
    if (!hasChanged) return;
    setMessage(null);

    const formData = new FormData();
    formData.append("date", date);
    formData.append("steps", steps);

    try {
      if (!steps.trim() || !Number.isSafeInteger(Number(steps)) || Number(steps) < 0) {
        throw new Error(t("Număr de pași invalid.", "Invalid step count."));
      }
      if (ownerId) {
        await saveOfflineMutation({ kind: "steps", date, steps: Number(steps) }, ownerId);
        setMessage({ ok: true, text: t("Salvat local; sincronizare în așteptare.", "Saved locally; pending sync.") });
      } else {
        const result = await saveDailySteps(formData);
        if (result?.error) setMessage({ ok: false, text: result.error });
        else setMessage({ ok: true, text: t("Salvat", "Saved") });
      }
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : t("Salvarea a eșuat.", "Save failed.") });
    }
  }

  async function handleGoalSave() {
    const parsed = parseInt(goalDraft, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      setMessage({ ok: false, text: t("Obiectiv invalid.", "Invalid goal.") });
      return;
    }
    if (parsed === activeGoal) {
      setEditingGoal(false);
      return;
    }
    setSavingGoal(true);
    setMessage(null);
    const formData = new FormData();
    formData.append("dailyGoal", String(parsed));
    const result = await updateDailyGoal(formData);
    if (result?.error) {
      setMessage({ ok: false, text: result.error });
    } else {
      setActiveGoal(parsed);
      setEditingGoal(false);
    }
    setSavingGoal(false);
  }

  return (
    <Card aria-labelledby="daily-steps-title" className="justify-between">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <label id="daily-steps-title" htmlFor="daily-steps">
            <Eyebrow>{t("Pași azi", "Steps today")}</Eyebrow>
          </label>
          <TextLink href="/stats?mode=steps">{t("Grafic", "Chart")}</TextLink>
        </div>

        <div className="flex items-baseline gap-2">
          <input
            id="daily-steps"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={steps}
            placeholder="0"
            onChange={(e) => {
              setSteps(e.target.value);
              setMessage(null);
            }}
            className="w-0 min-w-0 flex-1 bg-transparent p-0 text-[36px] font-bold leading-none tracking-[-0.04em] tabular-nums outline-none focus-visible:outline-none sm:text-[38px]"
          />
          {!editingGoal ? (
            <button
              type="button"
              onClick={() => {
                setGoalDraft(String(activeGoal));
                setEditingGoal(true);
              }}
              title={t("Editează obiectivul zilnic", "Edit daily step goal")}
              className="group inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-[12px] font-medium text-muted tabular-nums transition-colors hover:bg-inner hover:text-foreground"
            >
              <span>/ {activeGoal.toLocaleString(locale)}</span>
              <Pencil className="size-3 opacity-60 transition-opacity group-hover:opacity-100" />
            </button>
          ) : (
            <div className="flex shrink-0 items-center gap-1">
              <input
                type="text"
                inputMode="numeric"
                aria-label={t("Obiectiv zilnic de pași", "Daily step goal")}
                value={goalDraft}
                autoFocus
                onChange={(e) => setGoalDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleGoalSave();
                  if (e.key === "Escape") setEditingGoal(false);
                }}
                className="h-7 w-20 rounded-sm border border-lime bg-inner px-2 font-mono text-xs font-semibold tabular-nums outline-none"
              />
              <button
                type="button"
                disabled={savingGoal}
                onClick={() => void handleGoalSave()}
                aria-label={t("Salvează obiectivul", "Save goal")}
                className="inline-flex size-7 items-center justify-center rounded-sm bg-lime text-on-solid transition-colors hover:bg-lime-hover disabled:opacity-50"
              >
                {savingGoal ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              </button>
              <button
                type="button"
                disabled={savingGoal}
                onClick={() => setEditingGoal(false)}
                aria-label={t("Anulează", "Cancel")}
                className="inline-flex size-7 items-center justify-center rounded-sm bg-control text-soft transition-colors hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <ProgressBar value={pct} tone={achieved ? "lime" : "gold"} />
          <div className="flex items-center justify-between font-mono text-[11px] text-muted tabular-nums">
            <span>{achieved ? t("Obiectiv atins", "Goal reached") : t("Atinge cifra pentru editare", "Tap value to log")}</span>
            <span className={achieved ? "font-semibold text-lime-text" : ""}>{pct}%</span>
          </div>
        </div>
      </div>

      {(hasChanged || message) && (
        <div className="flex min-h-9 items-center justify-between gap-2 border-t border-card-border pt-3">
          {message ? (
            <p role={message.ok ? "status" : "alert"} className={cx("text-[12.5px] font-medium", message.ok ? "text-lime-text" : "text-red-text")}>
              {message.text}
            </p>
          ) : (
            <span />
          )}
          {hasChanged && (
            <Button small onClick={handleSubmit}>
              {t("Salvează", "Save")}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
