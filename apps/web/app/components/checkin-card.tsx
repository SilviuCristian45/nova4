"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { getDailyCheckin, saveDailyCheckin } from "@/app/checkin/actions";
import { CHECKIN_NOTE_MAX, emptyCheckin, hasCheckinContent, parseCheckin, type CheckinValues } from "@/lib/checkin";
import { isMeasurementDate, localDate } from "@/lib/daily-metrics";
import { saveOfflineMutation, useOffline } from "@/lib/offline/client";
import { readOfflineDatabase } from "@/lib/offline/store";
import { useLanguage } from "./language-provider";
import { Card, Eyebrow, TextLink, buttonClass, cx, inputClass } from "./ui";

const subscribeToDate = () => () => {};
const serverDate = () => "";

type Score = "energy" | "satiety" | "sleep";

// Ten tap targets, 1 to 10. Tapping the chosen one again clears the answer (every score is optional).
function ScorePicker({ label, low, high, value, disabled, onChange }: {
  label: string; low: string; high: string; value: number | null; disabled: boolean; onChange: (value: number | null) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="pl-0.5 text-[12.5px] font-medium text-soft">{label}</span>
        <span className="font-mono text-[11.5px] font-semibold text-muted tabular-nums">{value === null ? "—" : `${value}/10`}</span>
      </div>
      <div className="grid grid-cols-10 gap-1">
        {Array.from({ length: 10 }, (_, index) => index + 1).map((score) => {
          const active = score === value;
          return (
            <button
              key={score}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(active ? null : score)}
              className={cx(
                "min-h-9 rounded-sm border text-[13px] font-semibold tabular-nums transition-colors disabled:opacity-50",
                active
                  ? "border-transparent bg-lime text-on-solid"
                  : "border-card-border bg-inner text-soft hover:border-card-border-strong hover:text-foreground",
              )}
            >
              {score}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between px-0.5 font-mono text-[10px] uppercase tracking-[0.04em] text-muted">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}

// Daily readiness / check-in instrument: displays compact score meters when collapsed, expands smoothly to edit.
export default function CheckinCard({ chartLink = true }: { chartLink?: boolean }) {
  const today = useSyncExternalStore(subscribeToDate, localDate, serverDate);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const date = selectedDate ?? today;
  const [open, setOpen] = useState(false);
  return (
    <Card aria-labelledby="checkin-title" className="justify-between">
      {date && <CheckinBody key={date} date={date} today={today} onDateChange={setSelectedDate} open={open} setOpen={setOpen} chartLink={chartLink} />}
    </Card>
  );
}

function MiniMetricPill({ label, value, tone }: { label: string; value: number | null; tone: "lime" | "ice" | "lilac" }) {
  const dot = tone === "lime" ? "bg-lime" : tone === "ice" ? "bg-ice" : "bg-lilac";
  return (
    <div className="flex flex-col gap-1 rounded-sm border border-card-border bg-inner px-2.5 py-2">
      <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.05em] text-muted">
        <span className={cx("size-1.5 rounded-full", dot)} />
        {label}
      </span>
      <span className="text-[17px] font-bold leading-none tracking-[-0.02em] tabular-nums text-foreground">
        {value === null ? "—" : value}
        {value !== null && <span className="font-mono text-[11px] font-normal text-muted">/10</span>}
      </span>
    </div>
  );
}

function CheckinBody({ date, today, onDateChange, open, setOpen, chartLink }: {
  date: string; today: string; onDateChange: (date: string) => void; open: boolean; setOpen: (open: boolean) => void; chartLink: boolean;
}) {
  const { t } = useLanguage();
  const { ownerId } = useOffline();
  const [values, setValues] = useState<CheckinValues>(emptyCheckin);
  const [saved, setSaved] = useState<CheckinValues | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [retry, setRetry] = useState(0);
  const [pending, startTransition] = useTransition();

  function errorText(code: string) {
    switch (code) {
      case "unauthorized": return t("Sesiune expirată. Autentifică-te din nou.", "Session expired. Please sign in again.");
      case "invalid-date": return t("Alege o dată validă, cel târziu azi.", "Choose a valid date no later than today.");
      case "invalid-checkin": return t(`Alege cel puțin un scor de la 1 la 10 sau scrie o notiță (cel mult ${CHECKIN_NOTE_MAX} caractere).`, `Pick at least one score from 1 to 10 or write a note (up to ${CHECKIN_NOTE_MAX} characters).`);
      case "setup": return t("Check-in-ul necesită migrarea bazei de date. Consultă README.", "Check-ins require the database migration. See README.");
      default: return t("Nu am putut salva sau încărca check-in-ul. Reîncearcă.", "Unable to save or load your check-in. Please retry.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        let found: CheckinValues | null;
        if (ownerId) {
          const state = await readOfflineDatabase();
          if (state.activeOwner !== ownerId) throw new Error("Account changed.");
          const entry = state.accounts[ownerId]?.snapshot.checkins?.find((row) => row.date === date);
          found = entry ? { energy: entry.energy, satiety: entry.satiety, sleep: entry.sleep, note: entry.note } : null;
        } else {
          const result = await getDailyCheckin(date);
          if (!result.success) { if (!cancelled) { setError(result.error); setLoadFailed(true); } return; }
          found = result.checkin;
        }
        if (cancelled) return;
        setSaved(found);
        setValues(found ?? emptyCheckin());
      } catch {
        if (!cancelled) { setError("storage"); setLoadFailed(true); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [date, ownerId, retry]);

  const same = (a: CheckinValues | null, b: CheckinValues) =>
    a !== null && a.energy === b.energy && a.satiety === b.satiety && a.sleep === b.sleep && a.note === b.note.trim();
  const changed = hasCheckinContent(values) && !same(saved, values);
  const set = (field: Score, value: number | null) => { setValues((current) => ({ ...current, [field]: value })); setJustSaved(false); setError(null); };

  function submit() {
    setError(null);
    setJustSaved(false);
    const parsed = parseCheckin(values);
    if (!parsed) { setError("invalid-checkin"); return; }
    startTransition(async () => {
      try {
        if (ownerId) {
          await saveOfflineMutation({ kind: "checkin", date, ...parsed }, ownerId);
        } else {
          const formData = new FormData();
          formData.set("date", date);
          for (const field of ["energy", "satiety", "sleep"] as const) formData.set(field, parsed[field] === null ? "" : String(parsed[field]));
          formData.set("note", parsed.note);
          const result = await saveDailyCheckin(formData);
          if (!result.success) { setError(result.error); return; }
        }
        setSaved(parsed);
        setValues(parsed);
        setJustSaved(true);
        setOpen(false);
      } catch {
        setError("storage");
      }
    });
  }

  const disabled = pending || loading || loadFailed;
  const isToday = date === today;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span id="checkin-title">
          <Eyebrow>{isToday ? t("Check-in zilnic", "Daily readiness") : `Check-in · ${date}`}</Eyebrow>
        </span>
        {chartLink && <TextLink href="/stats?mode=checkin">{t("Grafic", "Chart")}</TextLink>}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <MiniMetricPill label={t("Energie", "Energy")} value={saved?.energy ?? null} tone="lime" />
        <MiniMetricPill label={t("Sațietate", "Satiety")} value={saved?.satiety ?? null} tone="ice" />
        <MiniMetricPill label={t("Somn", "Sleep")} value={saved?.sleep ?? null} tone="lilac" />
      </div>

      <button
        type="button"
        aria-expanded={open}
        aria-controls="checkin-panel"
        onClick={() => setOpen(!open)}
        className="flex h-9 w-full items-center justify-between rounded-sm border border-card-border bg-inner px-3 text-[12.5px] font-semibold text-soft transition-colors hover:border-card-border-strong hover:text-foreground"
      >
        <span>
          {loadFailed
            ? t("Nu am putut încărca", "Could not load")
            : loading
              ? t("Se încarcă...", "Loading...")
              : open
                ? t("Ascunde formularul", "Hide check-in")
                : saved
                  ? t("Editează check-in-ul", "Edit check-in")
                  : t("Completează azi", "Log today's feel")}
        </span>
        <ChevronDown className={cx("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div id="checkin-panel" className="flex flex-col gap-3.5 border-t border-card-border pt-3.5">
          <ScorePicker
            label={t("Energie", "Energy")}
            low={t("epuizat", "drained")}
            high={t("plin de energie", "energized")}
            value={values.energy}
            disabled={disabled}
            onChange={(value) => set("energy", value)}
          />
          <ScorePicker
            label={t("Sațietate", "Satiety")}
            low={t("flămând", "hungry")}
            high={t("sătul", "full")}
            value={values.satiety}
            disabled={disabled}
            onChange={(value) => set("satiety", value)}
          />
          <ScorePicker
            label={t("Somn", "Sleep")}
            low={t("slab", "poor")}
            high={t("excelent", "great")}
            value={values.sleep}
            disabled={disabled}
            onChange={(value) => set("sleep", value)}
          />
          <input
            type="text"
            value={values.note}
            maxLength={CHECKIN_NOTE_MAX}
            disabled={disabled}
            aria-label={t("Notiță (opțional)", "Note (optional)")}
            placeholder={t("Notiță scurtă (opțional)", "Short note (optional)")}
            onChange={(event) => {
              setValues((current) => ({ ...current, note: event.target.value }));
              setJustSaved(false);
              setError(null);
            }}
            className={inputClass()}
          />
          <div className="flex items-center gap-2">
            <input
              type="date"
              required
              value={date}
              min="0001-01-01"
              max={today || undefined}
              disabled={pending}
              aria-label={t("Data", "Date")}
              onChange={(event) => {
                if (isMeasurementDate(event.target.value)) onDateChange(event.target.value);
              }}
              className="h-9 min-w-0 flex-1 rounded-sm border border-card-border bg-inner px-2.5 font-mono text-[12px] text-soft outline-none focus:border-lime focus:text-foreground disabled:opacity-50"
            />
            {changed && !loadFailed && (
              <button type="button" onClick={submit} disabled={disabled} className={buttonClass({ small: true })}>
                {pending && <Loader2 className="size-3.5 animate-spin" />}
                {t("Salvează", "Save")}
              </button>
            )}
          </div>
          {justSaved && (
            <p role="status" className="text-[12px] font-semibold text-lime-text">
              {ownerId
                ? t("Salvat local; sincronizare în așteptare.", "Saved locally; pending sync.")
                : t("Check-in salvat.", "Check-in saved.")}
            </p>
          )}
          {error && (
            <div role="alert" className="text-[12px] font-semibold text-red-text">
              <p>{errorText(error)}</p>
              {loadFailed && (
                <button
                  type="button"
                  onClick={() => {
                    setLoading(true);
                    setLoadFailed(false);
                    setError(null);
                    setRetry((value) => value + 1);
                  }}
                  className="mt-1 underline"
                >
                  {t("Reîncearcă", "Retry")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
