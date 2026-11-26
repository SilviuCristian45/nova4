"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Html5Qrcode } from "html5-qrcode";
import {
  Camera,
  CheckCircle2,
  Dumbbell,
  MapPin,
  QrCode,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { extractQrToken, formatGymOutcomeMessage } from "@replog/shared";
import { Text, useLanguage } from "@/app/components/language-provider";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Field,
  Inner,
  Input,
  Message,
  Screen,
  buttonClass,
} from "@/app/components/ui";
import { clientApi } from "@/lib/api/client";
import type { ApiScanCheckinResponse } from "@/lib/api/gym-types";
import { ApiError } from "@/lib/api/types";

function getOptionalBrowserCoords(): Promise<{ latitude: number; longitude: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 4000, maximumAge: 30_000 },
    );
  });
}

export function GymScanClient({ initialCode }: { initialCode: string }) {
  const { t, locale } = useLanguage();
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [result, setResult] = useState<ApiScanCheckinResponse | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const autoTriggeredRef = useRef(false);

  const stopCamera = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (scanner && scanner.isScanning) {
      await scanner.stop().catch(() => {});
    }
    setCameraActive(false);
  }, []);

  const submitQr = useCallback(
    async (rawInput: string, requestGps = false) => {
      const token = extractQrToken(rawInput);
      if (!token) {
        setApiError(t("Cod QR invalid.", "Invalid QR code."));
        return;
      }
      setSubmitting(true);
      setApiError(null);
      try {
        const coords = requestGps ? await getOptionalBrowserCoords() : null;
        let res = await clientApi<ApiScanCheckinResponse>("/gym/checkins/scan", {
          method: "POST",
          body: {
            qrToken: token,
            ...(coords ? { latitude: coords.latitude, longitude: coords.longitude } : {}),
          },
        });

        // If the gym requires GPS proximity and we hadn't requested coordinates yet, ask once and retry.
        if (res.gpsRejected && !coords) {
          const retryCoords = await getOptionalBrowserCoords();
          if (retryCoords) {
            res = await clientApi<ApiScanCheckinResponse>("/gym/checkins/scan", {
              method: "POST",
              body: {
                qrToken: token,
                latitude: retryCoords.latitude,
                longitude: retryCoords.longitude,
              },
            });
          }
        }

        setResult(res);
      } catch (err) {
        setApiError(
          err instanceof ApiError
            ? err.message
            : t("Verificarea codului QR a eșuat.", "Failed to verify QR code."),
        );
      } finally {
        setSubmitting(false);
      }
    },
    [t],
  );

  // Auto-submit when opened directly via native phone camera (?code=...)
  useEffect(() => {
    if (initialCode && !autoTriggeredRef.current) {
      autoTriggeredRef.current = true;
      void submitQr(initialCode);
    }
  }, [initialCode, submitQr]);

  // Camera lifecycle
  useEffect(() => {
    if (!cameraActive) return;

    let cancelled = false;
    const scanner = new Html5Qrcode("gym-qr-reader");
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        },
        (decodedText) => {
          if (cancelled) return;
          cancelled = true;
          void stopCamera().then(() => submitQr(decodedText));
        },
        () => {
          // Ignore per-frame decode misses.
        },
      )
      .catch(() => {
        if (!cancelled) {
          setCameraError(
            t(
              "Nu am putut accesa camera. Permite accesul din browser sau introdu codul manual.",
              "Could not access the camera. Allow browser camera permission or enter the code manually.",
            ),
          );
          setCameraActive(false);
        }
      });

    return () => {
      cancelled = true;
      if (scanner.isScanning) {
        scanner.stop().catch(() => {});
      }
    };
  }, [cameraActive, stopCamera, submitQr, t]);

  const outcomeTone = result
    ? result.outcome === "allowed"
      ? result.expiringSoon
        ? "gold"
        : "lime"
      : "red"
    : null;

  const outcomeText = result
    ? formatGymOutcomeMessage(
        result.outcome,
        {
          endsAt: result.endsAt,
          frozenUntil: result.frozenUntil,
          allowedFromTime: result.allowedFromTime,
          allowedToTime: result.allowedToTime,
          recentCheckinTime: result.recentCheckinTime,
          gpsRejected: result.gpsRejected,
        },
        t,
        locale,
      )
    : null;

  return (
    <Screen title={<Text ro="Check-in Sală QR" en="Gym QR Check-in" />} back="/gym">
      {apiError && <Message tone="red">{apiError}</Message>}

      {result && outcomeTone && (
        <Card tone={outcomeTone}>
          <div className="flex items-start gap-3">
            {result.outcome === "allowed" ? (
              <CheckCircle2 className="mt-0.5 size-8 shrink-0" />
            ) : (
              <XCircle className="mt-0.5 size-8 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[22px] font-bold tracking-[-0.5px]">
                  {result.outcome === "allowed"
                    ? t("Check-in confirmat!", "Check-in confirmed!")
                    : t("Acces respins", "Access denied")}
                </h2>
                {result.gymName && <Badge tone={outcomeTone}>{result.gymName}</Badge>}
              </div>
              <p className="mt-1 text-sm font-medium">{outcomeText}</p>
            </div>
          </div>

          <Inner className="gap-1.5 text-sm text-foreground">
            <div className="flex justify-between gap-2">
              <span className="text-muted">
                <Text ro="Ora" en="Time" />
              </span>
              <span className="font-semibold tabular-nums">
                {new Date(result.checkedInAt).toLocaleTimeString(locale, {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
            </div>
            {result.planName && (
              <div className="flex justify-between gap-2">
                <span className="text-muted">
                  <Text ro="Abonament" en="Plan" />
                </span>
                <span className="font-semibold">{result.planName}</span>
              </div>
            )}
            {result.planType === "session_pack" && result.sessionsAfter !== null && (
              <div className="flex justify-between gap-2">
                <span className="text-muted">
                  <Text ro="Ședințe rămase" en="Sessions left" />
                </span>
                <span className="font-semibold tabular-nums">
                  {result.sessionsAfter}
                  {result.sessionsTotal ? ` / ${result.sessionsTotal}` : ""}
                </span>
              </div>
            )}
            {result.daysLeft !== null && (
              <div className="flex justify-between gap-2">
                <span className="text-muted">
                  <Text ro="Zile rămase" en="Days left" />
                </span>
                <span className="font-semibold tabular-nums">{result.daysLeft}</span>
              </div>
            )}
            {result.gpsRejected && result.distanceMeters !== null && (
              <div className="flex justify-between gap-2">
                <span className="flex items-center gap-1 text-muted">
                  <MapPin className="size-3.5" />
                  <Text ro="Distanță detectată" en="Detected distance" />
                </span>
                <span className="font-semibold tabular-nums">{result.distanceMeters} m</span>
              </div>
            )}
          </Inner>

          <div className="flex flex-wrap gap-2">
            {result.outcome === "allowed" && (
              <Link href="/insert" className={buttonClass({ variant: "primary" })}>
                <Dumbbell className="size-4" />
                <Text ro="Începe antrenamentul de azi" en="Start today's workout" />
              </Link>
            )}
            <Button
              variant="secondary"
              icon={RefreshCw}
              onClick={() => {
                setResult(null);
                setApiError(null);
                setCameraError(null);
                setCameraActive(true);
              }}
            >
              <Text ro="Scanează din nou" en="Scan again" />
            </Button>
          </div>
        </Card>
      )}

      {!result && (
        <Card>
          <CardTitle
            description={
              <Text
                ro="Îndreaptă camera spre posterul QR de la recepție pentru a-ți valida intrarea."
                en="Point your camera at the reception QR poster to validate your check-in."
              />
            }
          >
            <Text ro="Scanează posterul QR" en="Scan QR poster" />
          </CardTitle>

          {cameraError && <Message tone="red">{cameraError}</Message>}

          {cameraActive ? (
            <div className="flex flex-col gap-3">
              <div className="overflow-hidden rounded-lg bg-black">
                <div id="gym-qr-reader" className="min-h-[300px] w-full" />
              </div>
              <Button variant="secondary" onClick={stopCamera}>
                <Text ro="Oprește camera" en="Stop camera" />
              </Button>
            </div>
          ) : (
            <Button
              large
              icon={Camera}
              busy={submitting}
              onClick={() => {
                setCameraError(null);
                setCameraActive(true);
              }}
            >
              <Text ro="Pornește camera QR" en="Open QR camera" />
            </Button>
          )}
        </Card>
      )}

      <Card>
        <CardTitle
          description={
            <Text
              ro="Dacă camera nu este disponibilă, poți lipi link-ul sau codul QR de la recepție."
              en="If the camera is unavailable, paste the reception QR link or code."
            />
          }
        >
          <Text ro="Introducere manuală cod" en="Manual code entry" />
        </CardTitle>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitQr(manualCode);
          }}
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <Field label={<Text ro="Cod sau URL QR" en="QR code or URL" />} htmlFor="manual-qr" className="flex-1">
            <Input
              id="manual-qr"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="https://.../gym/scan?code=..."
            />
          </Field>
          <Button type="submit" icon={QrCode} busy={submitting}>
            <Text ro="Validează" en="Validate" />
          </Button>
        </form>
      </Card>
    </Screen>
  );
}
