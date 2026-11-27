"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { getDailyWeight, saveDailyWeight } from "@/app/weight/actions";
import { isMeasurementDate, localDate, parseBodyWeight } from "@/lib/daily-metrics";
import { useLanguage } from "./language-provider";
import { saveOfflineMutation, useOffline } from "@/lib/offline/client";
import { readOfflineDatabase } from "@/lib/offline/store";
import { useUnits } from "./units-provider";
import { Card, Eyebrow, TextLink, buttonClass } from "./ui";

const subscribeToDate = () => () => {};
const serverDate = () => "";

export default function WeightInput() {
  const { t } = useLanguage();
  const { ownerId } = useOffline();
  // The field shows the user's unit; savedWeight and everything sent to the server stay in kg.
  const { unit, toUnit, toKg } = useUnits();
  const today = useSyncExternalStore(subscribeToDate, localDate, serverDate);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const date = selectedDate ?? today;
  const [weight, setWeight] = useState("");
  const [savedWeight, setSavedWeight] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedDate, setLoadedDate] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [retry, setRetry] = useState(0);

  function errorText(code: string) {
    switch (code) {
      case "unauthorized": return t("Sesiune expirată. Autentifică-te din nou.", "Session expired. Please sign in again.");
      case "invalid-date": return t("Alege o dată validă, cel târziu azi.", "Choose a valid date no later than today.");
      case "invalid-weight": return t(`Introdu o greutate pozitivă în ${unit}, cu cel mult două zecimale.`, `Enter a positive weight in ${unit} with up to two decimal places.`);
      case "setup": return t("Urmărirea greutății necesită migrarea bazei de date. Consultă README.", "Weight tracking requires the database migration. See README.");
      default: return t("Nu am putut salva sau încărca greutatea. Reîncearcă.", "Unable to save or load your weight. Please retry.");
    }
  }

  useEffect(() => {
    if (!date && selectedDate === null) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      setLoadFailed(false);
      setSaved(false);
      setWeight("");
      setSavedWeight(null);
      if (!isMeasurementDate(date)) {
        setError("invalid-date");
        setLoadFailed(true);
        setLoading(false);
        setLoadedDate(date);
        return;
      }
      try {
        if (ownerId) {
          const state = await readOfflineDatabase();
          if (cancelled) return;
          if (state.activeOwner !== ownerId) throw new Error("Account changed.");
          const entry = state.accounts[ownerId]?.snapshot.weights.find((row) => row.date === date);
          setSavedWeight(entry?.weight_kg ?? null);
          setWeight(entry ? String(toUnit(entry.weight_kg)) : "");
          return;
        }
        const result = await getDailyWeight(date);
        if (cancelled) return;
        if (!result.success) {
          setError(result.error);
          setLoadFailed(true);
        } else {
          setSavedWeight(result.weight);
          setWeight(result.weight === null ? "" : String(toUnit(result.weight)));
        }
      } catch {
        if (!cancelled) {
          setError("storage");
          setLoadFailed(true);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLoadedDate(date);
        }
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [date, retry, selectedDate, ownerId, toUnit]);

  const parsedWeight = parseBodyWeight(weight);
  const changed = parsedWeight !== null && toKg(parsedWeight) !== savedWeight;
  const blocked = loadFailed;
  const isLoading = loading || loadedDate !== date;

  function submit(formData: FormData) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        if (ownerId) {
          const typed = parseBodyWeight(formData.get("weight"));
          if (typed === null) { setError("invalid-weight"); return; }
          const value = toKg(typed);
          await saveOfflineMutation({ kind: "weight", date, weightKg: value }, ownerId);
          setSavedWeight(value);
          setSaved(true);
          return;
        }
        const typed = parseBodyWeight(formData.get("weight"));
        if (typed !== null) formData.set("weight", String(toKg(typed)));
        const result = await saveDailyWeight(formData);
        if (!result.success) setError(result.error);
        else {
          setSavedWeight(result.weight);
          setSaved(true);
        }
      } catch {
        setError("storage");
      }
    });
  }

  return (
    <Card aria-labelledby="body-weight-title" className="justify-between">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <label id="body-weight-title" htmlFor="body-weight">
            <Eyebrow>{t("Greutate corporală", "Body weight")}</Eyebrow>
          </label>
          <TextLink href="/stats?mode=weight">{t("Grafic", "Chart")}</TextLink>
        </div>

        <form action={submit} className="flex flex-col gap-3">
          <div className="flex items-baseline gap-2">
            <input
              id="body-weight"
              name="weight"
              type="text"
              inputMode="decimal"
              required
              autoComplete="off"
              value={weight}
              placeholder={unit === "lb" ? "165.0" : "75.5"}
              aria-label={t(`Greutate (${unit})`, `Weight (${unit})`)}
              disabled={pending || isLoading || blocked}
              onChange={(event) => {
                setWeight(event.target.value);
                setSaved(false);
                if (error === "invalid-weight") setError(null);
              }}
              className="w-0 min-w-0 flex-1 bg-transparent p-0 text-[36px] font-bold leading-none tracking-[-0.04em] tabular-nums outline-none focus-visible:outline-none disabled:opacity-50 sm:text-[38px]"
            />
            <span className="font-mono text-[13px] font-medium text-muted">{unit}</span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <input
              id="weight-date"
              name="date"
              type="date"
              required
              value={date}
              aria-label={t("Data", "Date")}
              min="0001-01-01"
              max={today || undefined}
              disabled={pending}
              onChange={(event) => setSelectedDate(event.target.value)}
              className="h-9 min-w-0 flex-1 rounded-sm border border-card-border bg-inner px-2.5 font-mono text-[12px] text-soft outline-none transition-colors hover:border-card-border-strong focus:border-lime focus:text-foreground disabled:opacity-50"
            />
            {changed && !blocked && (
              <button type="submit" disabled={pending || isLoading} className={buttonClass({ small: true })}>
                {pending && <Loader2 className="size-3.5 animate-spin" />}
                {t("Salvează", "Save")}
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="flex flex-col gap-1">
        {isLoading && <p role="status" className="font-mono text-[11px] text-muted">{t("Se încarcă...", "Loading...")}</p>}
        {!isLoading && !error && savedWeight === null && !weight && (
          <p className="text-[12px] text-muted">
            {t(`Nicio cântărire azi. Introdu valoarea în ${unit}.`, `No weigh-in today. Enter value in ${unit}.`)}
          </p>
        )}
        {weight && parsedWeight === null && <p className="text-[12px] font-medium text-red-text">{errorText("invalid-weight")}</p>}
        {saved && (
          <p role="status" className="text-[12px] font-semibold text-lime-text">
            {ownerId
              ? t("Salvat local; sincronizare în așteptare.", "Saved locally; pending sync.")
              : t("Greutatea a fost salvată.", "Weight saved.")}
          </p>
        )}
        {error && (
          <div role="alert" className="text-[12px] font-semibold text-red-text">
            <p>{errorText(error)}</p>
            {loadFailed && (
              <button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-1 underline">
                {t("Reîncearcă", "Retry")}
              </button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
