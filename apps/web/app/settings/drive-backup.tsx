"use client";

import { useState } from "react";
import { Cloud, CloudUpload, Download, RotateCcw } from "lucide-react";
import { useLanguage } from "@/app/components/language-provider";
import { useOffline } from "@/lib/offline/client";
import { clientApi } from "@/lib/api/client";
import { AUTO_BACKUP_KEEP, type AutoBackupFrequency, type AutoBackupResult, type DriveFile } from "@/lib/drive-backup";
import { Button, Card, CardTitle, Field, Message, Segmented, buttonClass } from "@/app/components/ui";

export type DriveStatus = {
  connected: boolean;
  email: string | null;
  frequency: AutoBackupFrequency;
  lastBackupAt: string | null;
  lastError: string | null;
};

type Status = { ok: boolean; text: string } | null;

export function DriveBackupSection({ initial, connectResult }: { initial: DriveStatus; connectResult: string | null }) {
  const { t, locale } = useLanguage();
  const { online } = useOffline();
  const [drive, setDrive] = useState(initial);
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(() => {
    switch (connectResult) {
      case "connected":
        return { ok: true, text: t("Google Drive a fost conectat.", "Google Drive is connected.") };
      case "cancelled":
        return { ok: false, text: t("Conectarea a fost anulată.", "The connection was cancelled.") };
      case "scope":
        return {
          ok: false,
          text: t(
            "Fără acces la Google Drive nu se pot face backup-uri. Reconectează-te și bifează accesul la Drive.",
            "Backups need access to Google Drive. Connect again and allow Drive access.",
          ),
        };
      case "state":
      case "error":
        return { ok: false, text: t("Conectarea a eșuat. Încearcă din nou.", "Could not connect. Please try again.") };
      default:
        return null;
    }
  });

  async function run(name: string, action: () => Promise<void>) {
    setBusy(name);
    setStatus(null);
    try {
      await action();
    } catch (error) {
      setStatus({ ok: false, text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }

  function describe(result: AutoBackupResult) {
    if (result.status === "uploaded") {
      setStatus({
        ok: true,
        text: t(`Backup încărcat în Google Drive (${result.name}).`, `Backup uploaded to Google Drive (${result.name}).`),
      });
    }
    if (result.status === "failed") {
      setStatus({ ok: false, text: t("Backup-ul a eșuat: ", "Backup failed: ") + result.message });
    }
  }

  const connect = () =>
    run("connect", async () => {
      const { url } = await clientApi<{ url: string }>("/drive/connect", { method: "POST", body: {} });
      window.location.assign(url);
    });

  const chooseFrequency = (frequency: AutoBackupFrequency) =>
    run("frequency", async () => {
      setDrive((current) => ({ ...current, frequency }));
      const nextStatus = await clientApi<DriveStatus>("/drive/frequency", { method: "PUT", body: { frequency } });
      setDrive(nextStatus);
    });

  const backupNow = () =>
    run("backup", async () => {
      const result = await clientApi<AutoBackupResult>("/drive/backup", { method: "POST", body: {} });
      const nextStatus = await clientApi<DriveStatus>("/drive/status");
      setDrive(nextStatus);
      describe(result);
    });

  const loadFiles = () =>
    run("list", async () => {
      const list = await clientApi<DriveFile[]>("/drive/backups");
      setFiles(list);
      if (!list.length) {
        setStatus({ ok: false, text: t("Nu există backup-uri în Google Drive.", "There are no backups in Google Drive.") });
      }
    });

  const restore = (file: DriveFile) =>
    run(`restore-${file.id}`, async () => {
      const summary = [
        `${file.name}`,
        new Date(file.createdTime).toLocaleString(locale),
        "",
        t(
          "Datele se combină cu cele din cont: nimic existent nu se suprascrie, iar ce există deja nu se dublează. Continui?",
          "The data is merged into your account: nothing existing is overwritten and what is already there is not duplicated. Continue?",
        ),
      ].join("\n");
      if (!window.confirm(summary)) {
        setStatus({ ok: true, text: t("Anulat. Nu s-a modificat nimic.", "Cancelled. Nothing changed.") });
        return;
      }
      const { counts, photosRestored } = await clientApi<{
        counts: Record<string, number>;
        photosRestored?: { restored: number; skipped: number; failed: number };
      }>("/drive/restore", { method: "POST", body: { fileId: file.id } });
      const total = Object.values(counts ?? {}).reduce((sum, n) => sum + n, 0);
      const base = t(
        `Datele din Drive au fost combinate cu cele din cont: ${total} înregistrări noi.`,
        `The Drive data was merged into your account: ${total} new records.`,
      );
      if (photosRestored && photosRestored.failed > 0) {
        setStatus({
          ok: false,
          text: `${base} ${t(`Poze restaurate: ${photosRestored.restored}, eșuate: ${photosRestored.failed}.`, `Photos restored: ${photosRestored.restored}, failed: ${photosRestored.failed}.`)}`,
        });
      } else if (photosRestored) {
        setStatus({
          ok: true,
          text: `${base} ${t(`Poze restaurate: ${photosRestored.restored}.`, `Photos restored: ${photosRestored.restored}.`)}`,
        });
      } else {
        setStatus({ ok: true, text: base });
      }
    });

  const disconnect = () =>
    run("disconnect", async () => {
      await clientApi("/drive/disconnect", { method: "POST", body: {} });
      setDrive({ connected: false, email: null, frequency: "off", lastBackupAt: null, lastError: null });
      setFiles(null);
    });

  const disabled = !online || busy !== null;
  return (
    <Card id="drive">
      <CardTitle
        description={t(
          `Backup-ul se urcă într-un folder ascuns al aplicației din Drive-ul tău (aplicația nu vede alte fișiere). Rulează automat pe server, la frecvența aleasă, și se păstrează ultimele ${AUTO_BACKUP_KEEP}. Backup-urile făcute din aplicația de telefon apar în aceeași listă.`,
          `The backup goes to a hidden app folder in your Drive (the app cannot see your other files). It runs automatically on the server at the chosen frequency, and the latest ${AUTO_BACKUP_KEEP} are kept. Backups made by the phone app show up in the same list.`,
        )}
      >
        {t("Backup automat în Google Drive", "Automatic Google Drive backup")}
      </CardTitle>
      {!online && (
        <Message tone="gold">
          {t(
            "Ești offline. Backup-ul în Google Drive are nevoie de internet.",
            "You are offline. Google Drive backup needs an internet connection.",
          )}
        </Message>
      )}
      {!drive.connected ? (
        <Button icon={Cloud} onClick={connect} busy={busy === "connect"} disabled={disabled}>
          {t("Conectează Google Drive", "Connect Google Drive")}
        </Button>
      ) : (
        <>
          <p className="font-semibold break-all">
            {t("Cont: ", "Account: ")}
            {drive.email ?? "Google"}
          </p>
          <Field label={t("Frecvență", "Frequency")}>
            <Segmented
              inCard
              label={t("Frecvență", "Frequency")}
              value={drive.frequency}
              onChange={(next) => {
                if (!disabled) void chooseFrequency(next);
              }}
              options={[
                { value: "off", label: t("Oprit", "Off") },
                { value: "daily", label: t("Zilnic", "Daily") },
                { value: "weekly", label: t("Săptămânal", "Weekly") },
                { value: "monthly", label: t("Lunar", "Monthly") },
              ]}
            />
          </Field>
          <p className="text-[13px] text-soft">
            {drive.lastBackupAt
              ? t("Ultimul backup: ", "Last backup: ") + new Date(drive.lastBackupAt).toLocaleString(locale)
              : t("Niciun backup făcut încă.", "No backup yet.")}
          </p>
          {drive.lastError && <Message>{t("Ultima încercare a eșuat: ", "Last attempt failed: ") + drive.lastError}</Message>}
          <Button icon={CloudUpload} onClick={backupNow} busy={busy === "backup"} disabled={disabled}>
            {t("Fă backup acum", "Back up now")}
          </Button>
          <Button variant="secondary" icon={Download} onClick={loadFiles} busy={busy === "list"} disabled={disabled}>
            {t("Backup-urile din Drive", "Backups in Drive")}
          </Button>
          {files?.map((file) => (
            <div key={file.id} className="flex flex-col gap-2 rounded-md bg-inner p-3.5">
              <p className="break-all text-sm font-semibold">{file.name}</p>
              <p className="text-xs text-muted">{new Date(file.createdTime).toLocaleString(locale)}</p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  small
                  icon={RotateCcw}
                  onClick={() => restore(file)}
                  busy={busy === `restore-${file.id}`}
                  disabled={disabled}
                  className="flex-1"
                >
                  {t("Restaurează", "Restore")}
                </Button>
                <a
                  href={`/api/v1/drive/download?fileId=${encodeURIComponent(file.id)}`}
                  download={file.name}
                  aria-disabled={!online || undefined}
                  className={buttonClass({ variant: "secondary", small: true, className: "flex-1" })}
                >
                  <Download className="size-4" />
                  {t("Descarcă", "Download")}
                </a>
              </div>
            </div>
          ))}
          <Button variant="soft" tone="red" onClick={disconnect} busy={busy === "disconnect"} disabled={disabled}>
            {t("Deconectează", "Disconnect")}
          </Button>
        </>
      )}
      {status && <Message tone={status.ok ? "lime" : "red"}>{status.text}</Message>}
    </Card>
  );
}
