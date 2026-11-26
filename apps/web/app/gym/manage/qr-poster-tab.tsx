"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  Dumbbell,
  Printer,
  RefreshCw,
  Save,
  Shield,
  Trash2,
  UserPlus,
} from "lucide-react";
import {
  escapeCsvCell,
  formatMoneyCents,
  renderQrSvg,
  type GymPaymentMethod,
  type GymStaffRole,
} from "@replog/shared";
import { Text, useLanguage } from "@/app/components/language-provider";
import {
  Badge,
  BigNumber,
  Button,
  Card,
  CardTitle,
  Columns,
  Empty,
  Field,
  Inner,
  Input,
  Message,
  Select,
  Stack,
} from "@/app/components/ui";
import { clientApi } from "@/lib/api/client";
import type {
  ApiGymAuditLog,
  ApiGymCheckinEvent,
  ApiGymPaymentsResponse,
  ApiGymQrInfo,
  ApiGymStaffMember,
  ApiStaffGym,
} from "@/lib/api/gym-types";
import { ApiError } from "@/lib/api/types";

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function QrPosterTab({
  gym,
  recentCheckins,
  onGymUpdated,
}: {
  gym: ApiStaffGym;
  recentCheckins: ApiGymCheckinEvent[];
  onGymUpdated: (updated: Partial<ApiStaffGym>) => void;
}) {
  const { t, locale } = useLanguage();
  const canManage = gym.role === "owner" || gym.role === "manager";
  const isOwner = gym.role === "owner";

  const [qrInfo, setQrInfo] = useState<ApiGymQrInfo | null>(null);
  const [payments, setPayments] = useState<ApiGymPaymentsResponse | null>(null);
  const [payFrom, setPayFrom] = useState("");
  const [payTo, setPayTo] = useState("");
  const [payMethod, setPayMethod] = useState<string>("all");
  const [staff, setStaff] = useState<ApiGymStaffMember[]>([]);
  const [auditLogs, setAuditLogs] = useState<ApiGymAuditLog[]>([]);
  const [feedback, setFeedback] = useState<{ tone: "lime" | "red"; text: string } | null>(null);

  // Settings form
  const [gymName, setGymName] = useState(gym.gymName);
  const [gymAddress, setGymAddress] = useState(gym.gymAddress ?? "");
  const [timezone, setTimezone] = useState(gym.gymTimezone);
  const [currency, setCurrency] = useState(gym.gymCurrency);
  const [cooldown, setCooldown] = useState(String(gym.checkinCooldownMinutes));
  const [capacity, setCapacity] = useState(gym.gymCapacity ? String(gym.gymCapacity) : "");
  const [lat, setLat] = useState(gym.latitude !== null ? String(gym.latitude) : "");
  const [lng, setLng] = useState(gym.longitude !== null ? String(gym.longitude) : "");
  const [radius, setRadius] = useState(
    gym.checkinRadiusMeters !== null ? String(gym.checkinRadiusMeters) : "",
  );

  // Add staff form
  const [staffEmail, setStaffEmail] = useState("");
  const [staffRole, setStaffRole] = useState<GymStaffRole>("reception");

  const loadPayments = useCallback(async () => {
    const params = new URLSearchParams();
    if (payFrom) params.set("from", payFrom);
    if (payTo) params.set("to", payTo);
    if (payMethod !== "all") params.set("method", payMethod);
    const qs = params.toString();
    const res = await clientApi<ApiGymPaymentsResponse>(
      `/gym/${gym.gymId}/payments${qs ? `?${qs}` : ""}`,
    );
    setPayments(res);
  }, [gym.gymId, payFrom, payTo, payMethod]);

  useEffect(() => {
    let cancelled = false;
    async function fetchTab() {
      try {
        const payRes = await clientApi<ApiGymPaymentsResponse>(`/gym/${gym.gymId}/payments`);
        if (cancelled) return;
        setPayments(payRes);
        if (canManage) {
          const [qrRes, staffRes, auditRes] = await Promise.all([
            clientApi<ApiGymQrInfo>(`/gym/${gym.gymId}/qr`),
            clientApi<ApiGymStaffMember[]>(`/gym/${gym.gymId}/staff`),
            clientApi<ApiGymAuditLog[]>(`/gym/${gym.gymId}/audit?limit=80`),
          ]);
          if (cancelled) return;
          setQrInfo(qrRes);
          setStaff(staffRes);
          setAuditLogs(auditRes);
        }
      } catch (err) {
        if (cancelled) return;
        setFeedback({
          tone: "red",
          text: err instanceof ApiError ? err.message : t("Încărcarea datelor a eșuat.", "Failed to load data."),
        });
      }
    }
    void fetchTab();
    return () => {
      cancelled = true;
    };
  }, [canManage, gym.gymId, t]);

  const resolvedCheckinUrl = useMemo(() => {
    if (!qrInfo) return "";
    if (qrInfo.checkinUrl.startsWith("http")) return qrInfo.checkinUrl;
    if (typeof window !== "undefined") {
      return `${window.location.origin}${qrInfo.checkinPath}`;
    }
    return qrInfo.checkinPath;
  }, [qrInfo]);

  const qrSvg = useMemo(() => {
    if (!resolvedCheckinUrl) return "";
    try {
      return renderQrSvg(resolvedCheckinUrl, { margin: 3 });
    } catch {
      return "";
    }
  }, [resolvedCheckinUrl]);

  async function handleRotateQr() {
    if (
      !window.confirm(
        t(
          "Regenerezi codul QR? Posterul printat anterior va deveni imediat invalid!",
          "Rotate the QR code? The previously printed poster will stop working immediately!",
        ),
      )
    ) {
      return;
    }
    setFeedback(null);
    try {
      const next = await clientApi<ApiGymQrInfo>(`/gym/${gym.gymId}/qr/rotate`, { method: "POST" });
      setQrInfo(next);
      setFeedback({
        tone: "lime",
        text: t("Codul QR a fost regenerat. Printează noul poster!", "QR code rotated. Print the new poster!"),
      });
    } catch (err) {
      setFeedback({
        tone: "red",
        text: err instanceof ApiError ? err.message : t("Regenerarea a eșuat.", "Rotation failed."),
      });
    }
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    try {
      const body: Record<string, unknown> = {
        name: gymName.trim(),
        address: gymAddress.trim() || null,
        timezone: timezone.trim() || "Europe/Bucharest",
        currency: (currency.trim() || "RON").toUpperCase(),
        checkinCooldownMinutes: Math.max(0, Number(cooldown) || 0),
        capacity: capacity.trim() ? Number(capacity) : null,
        latitude: lat.trim() ? Number(lat) : null,
        longitude: lng.trim() ? Number(lng) : null,
        checkinRadiusMeters: radius.trim() ? Number(radius) : null,
      };
      const updated = await clientApi<Partial<ApiStaffGym>>(`/gym/${gym.gymId}/settings`, {
        method: "PATCH",
        body,
      });
      onGymUpdated(updated);
      setFeedback({ tone: "lime", text: t("Setările sălii au fost salvate.", "Gym settings saved.") });
    } catch (err) {
      setFeedback({
        tone: "red",
        text: err instanceof ApiError ? err.message : t("Salvarea a eșuat.", "Save failed."),
      });
    }
  }

  async function handleAddStaff(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    try {
      const updated = await clientApi<ApiGymStaffMember[]>(`/gym/${gym.gymId}/staff`, {
        method: "POST",
        body: { email: staffEmail.trim(), role: staffRole },
      });
      setStaff(updated);
      setStaffEmail("");
      setFeedback({ tone: "lime", text: t("Staff actualizat.", "Staff updated.") });
    } catch (err) {
      setFeedback({
        tone: "red",
        text: err instanceof ApiError ? err.message : t("Adăugarea staff-ului a eșuat.", "Failed to update staff."),
      });
    }
  }

  async function handleRemoveStaff(userId: string) {
    setFeedback(null);
    try {
      await clientApi(`/gym/${gym.gymId}/staff/${userId}`, { method: "DELETE" });
      setStaff((prev) => prev.filter((s) => s.userId !== userId));
      setFeedback({ tone: "lime", text: t("Membru staff eliminat.", "Staff member removed.") });
    } catch (err) {
      setFeedback({
        tone: "red",
        text: err instanceof ApiError ? err.message : t("Eliminarea a eșuat.", "Removal failed."),
      });
    }
  }

  function exportPaymentsCsv() {
    if (!payments) return;
    const header = ["Date", "Member", "Email", "Plan", "Amount", "Currency", "Method", "Reference", "Note", "RecordedBy"];
    const lines = [
      header.map(escapeCsvCell).join(","),
      ...payments.items.map((p) =>
        [
          p.paidAt ?? "",
          p.memberName ?? "",
          p.memberEmail ?? "",
          p.planName ?? "",
          (p.amountCents / 100).toFixed(2),
          p.currency,
          p.method,
          p.reference ?? "",
          p.note ?? "",
          p.recordedByName ?? "",
        ]
          .map(escapeCsvCell)
          .join(","),
      ),
    ];
    downloadFile(`${gym.gymSlug}-payments.csv`, `\uFEFF${lines.join("\n")}`, "text/csv;charset=utf-8");
  }

  function exportCheckinsCsv() {
    const header = ["Time", "Member", "Email", "Code", "Method", "Outcome", "Plan", "SessionsAfter", "OverrideReason"];
    const lines = [
      header.map(escapeCsvCell).join(","),
      ...recentCheckins.map((c) =>
        [
          c.checkedInAt,
          c.memberName,
          c.memberEmail,
          c.memberCode ?? "",
          c.method,
          c.outcome,
          c.planName ?? "",
          c.sessionsAfter ?? "",
          c.overrideReason ?? "",
        ]
          .map(escapeCsvCell)
          .join(","),
      ),
    ];
    downloadFile(`${gym.gymSlug}-checkins.csv`, `\uFEFF${lines.join("\n")}`, "text/csv;charset=utf-8");
  }

  const methodLabels: Record<GymPaymentMethod, string> = {
    cash: t("Numerar", "Cash"),
    card_pos: t("Card POS", "Card POS"),
    bank_transfer: t("Transfer", "Bank transfer"),
    online: "Online",
  };

  return (
    <Stack>
      {feedback && <Message tone={feedback.tone} className="no-print">{feedback.text}</Message>}

      {canManage && qrInfo && (
        <Card className="print-break-inside-avoid">
          <div className="no-print flex flex-wrap items-start justify-between gap-2">
            <CardTitle
              description={
                <Text
                  ro="Printează acest poster A4/A5 și afișează-l la recepție. Clienții îl scanează cu telefonul."
                  en="Print this A4/A5 poster and display it at reception. Members scan it with their phone."
                />
              }
            >
              <Text ro="Poster QR Recepție" en="Reception QR Poster" />
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button small icon={Printer} onClick={() => window.print()}>
                <Text ro="Printează Poster" en="Print Poster" />
              </Button>
              <Button
                variant="secondary"
                small
                icon={Download}
                onClick={() => downloadFile(`${gym.gymSlug}-qr-poster.svg`, qrSvg, "image/svg+xml")}
              >
                <Text ro="Descarcă SVG" en="Download SVG" />
              </Button>
              <Button variant="outline" tone="red" small icon={RefreshCw} onClick={handleRotateQr}>
                <Text ro="Regenerează QR" en="Rotate QR" />
              </Button>
            </div>
          </div>

          {/* Printable A4/A5 Poster Area */}
          <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 rounded-xl border border-line bg-white p-8 text-center text-[#0c0c0d]">
            <div className="flex items-center gap-2 rounded-full bg-[#c8f031] px-4 py-1.5 text-sm font-bold text-[#0c0c0d]">
              <Dumbbell className="size-4" />
              <span>RepLog Check-in</span>
            </div>
            <div>
              <h3 className="text-[28px] font-bold leading-tight tracking-[-0.8px]">{qrInfo.gymName}</h3>
              {qrInfo.gymAddress && <p className="mt-1 text-sm text-[#4a4a4f]">{qrInfo.gymAddress}</p>}
            </div>

            {qrSvg && (
              <div
                className="w-64 max-w-full rounded-lg border-2 border-[#0c0c0d] bg-white p-2"
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
            )}

            <div className="space-y-1">
              <p className="text-base font-bold">
                Scanează cu camera telefonului pentru check-in
              </p>
              <p className="text-sm text-[#4a4a4f]">
                Scan with your phone camera or RepLog app to check in
              </p>
            </div>
            <p className="no-print break-all text-[11px] text-[#7a7a80]">{resolvedCheckinUrl}</p>
          </div>
        </Card>
      )}

      {/* Payments & CSV Export */}
      <Card className="no-print">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle
            description={
              <Text
                ro="Încasări înregistrate la recepție și export rapid CSV."
                en="Recorded reception payments and one-click CSV exports."
              />
            }
          >
            <Text ro="Raport încasări & Export CSV" en="Payments Report & CSV Export" />
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" small icon={Download} onClick={exportPaymentsCsv}>
              <Text ro="Export Încasări CSV" en="Export Payments CSV" />
            </Button>
            <Button variant="secondary" small icon={Download} onClick={exportCheckinsCsv}>
              <Text ro="Export Intrări CSV" en="Export Check-ins CSV" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end">
          <Field label={<Text ro="De la" en="From" />}>
            <Input type="date" value={payFrom} onChange={(e) => setPayFrom(e.target.value)} />
          </Field>
          <Field label={<Text ro="Până la" en="To" />}>
            <Input type="date" value={payTo} onChange={(e) => setPayTo(e.target.value)} />
          </Field>
          <Field label={<Text ro="Metodă plată" en="Payment method" />}>
            <Select
              value={payMethod}
              onChange={setPayMethod}
              options={[
                { value: "all", label: t("Toate", "All") },
                { value: "cash", label: methodLabels.cash },
                { value: "card_pos", label: methodLabels.card_pos },
                { value: "bank_transfer", label: methodLabels.bank_transfer },
                { value: "online", label: methodLabels.online },
              ]}
            />
          </Field>
          <Button variant="secondary" onClick={loadPayments}>
            <Text ro="Filtrează" en="Filter" />
          </Button>
        </div>

        {payments && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Inner>
                <span className="text-xs text-muted">
                  <Text ro="Total încasat" en="Total revenue" />
                </span>
                <BigNumber
                  className="text-xl"
                  value={formatMoneyCents(payments.totals.grandTotalCents, gym.gymCurrency, locale)}
                />
              </Inner>
              <Inner>
                <span className="text-xs text-muted">{methodLabels.cash}</span>
                <span className="text-xl font-bold tabular-nums">
                  {formatMoneyCents(payments.totals.byMethod.cash, gym.gymCurrency, locale)}
                </span>
              </Inner>
              <Inner>
                <span className="text-xs text-muted">{methodLabels.card_pos}</span>
                <span className="text-xl font-bold tabular-nums">
                  {formatMoneyCents(payments.totals.byMethod.card_pos, gym.gymCurrency, locale)}
                </span>
              </Inner>
              <Inner>
                <span className="text-xs text-muted">{methodLabels.bank_transfer}</span>
                <span className="text-xl font-bold tabular-nums">
                  {formatMoneyCents(payments.totals.byMethod.bank_transfer, gym.gymCurrency, locale)}
                </span>
              </Inner>
            </div>

            {payments.items.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted">
                <Text ro="Nicio încasare în perioada selectată." en="No payments in selected range." />
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {payments.items.slice(0, 30).map((p) => (
                  <Inner key={p.id} className="flex-row flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {p.memberName ?? t("Cont șters (GDPR)", "Deleted account (GDPR)")}{" "}
                        {p.planName ? <span className="text-xs font-normal text-muted">· {p.planName}</span> : null}
                      </p>
                      <p className="text-xs text-muted">
                        {p.paidAt ? new Date(p.paidAt).toLocaleString(locale) : ""}
                        {p.reference ? ` · Ref: ${p.reference}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone="ice">{methodLabels[p.method]}</Badge>
                      <span className="font-bold tabular-nums">
                        {formatMoneyCents(p.amountCents, p.currency, locale)}
                      </span>
                    </div>
                  </Inner>
                ))}
              </div>
            )}
          </>
        )}
      </Card>

      {canManage && (
        <Columns className="no-print">
          <Stack>
            <Card>
              <CardTitle
                description={
                  <Text
                    ro="Configurează cooldown-ul anti-dublă-scanare, capacitatea și verificarea GPS opțională."
                    en="Configure duplicate-scan cooldown, capacity, and optional GPS geofencing."
                  />
                }
              >
                <Text ro="Setări sală" en="Gym Settings" />
              </CardTitle>
              <form onSubmit={handleSaveSettings} className="flex flex-col gap-3">
                <Field label={<Text ro="Nume sală" en="Gym name" />}>
                  <Input value={gymName} onChange={(e) => setGymName(e.target.value)} required />
                </Field>
                <Field label={<Text ro="Adresă" en="Address" />}>
                  <Input value={gymAddress} onChange={(e) => setGymAddress(e.target.value)} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={<Text ro="Cooldown (min)" en="Cooldown (min)" />}>
                    <Input type="number" min={0} max={1440} value={cooldown} onChange={(e) => setCooldown(e.target.value)} />
                  </Field>
                  <Field label={<Text ro="Capacitate" en="Capacity" />}>
                    <Input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={<Text ro="Fus orar" en="Timezone" />}>
                    <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
                  </Field>
                  <Field label={<Text ro="Monedă" en="Currency" />}>
                    <Input maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
                  </Field>
                </div>
                <Inner className="gap-2.5">
                  <span className="text-xs font-semibold text-muted">
                    <Text ro="Proximitate GPS (opțional — lasă gol pentru dezactivat)" en="GPS Proximity (optional — leave blank to disable)" />
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="Lat">
                      <Input type="number" step="0.000001" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="44.4268" />
                    </Field>
                    <Field label="Lng">
                      <Input type="number" step="0.000001" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="26.1025" />
                    </Field>
                    <Field label={<Text ro="Rază (m)" en="Radius (m)" />}>
                      <Input type="number" min={10} max={50000} value={radius} onChange={(e) => setRadius(e.target.value)} placeholder="150" />
                    </Field>
                  </div>
                </Inner>
                <Button type="submit" icon={Save}>
                  <Text ro="Salvează setările" en="Save settings" />
                </Button>
              </form>
            </Card>
          </Stack>

          <Stack>
            <Card>
              <CardTitle
                description={
                  <Text
                    ro="Roluri permise per sală: owner, manager, reception."
                    en="Per-gym staff roles: owner, manager, reception."
                  />
                }
              >
                <Text ro="Echipă & Staff" en="Gym Staff" />
              </CardTitle>

              {isOwner && (
                <form onSubmit={handleAddStaff} className="flex flex-col gap-2.5">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <Input
                      type="email"
                      required
                      className="sm:col-span-2"
                      value={staffEmail}
                      onChange={(e) => setStaffEmail(e.target.value)}
                      placeholder="staff@example.com"
                    />
                    <Select
                      value={staffRole}
                      onChange={(v) => setStaffRole(v as GymStaffRole)}
                      options={[
                        { value: "reception", label: "Reception" },
                        { value: "manager", label: "Manager" },
                        { value: "owner", label: "Owner" },
                      ]}
                    />
                  </div>
                  <Button type="submit" small icon={UserPlus}>
                    <Text ro="Adaugă / Actualizează staff" en="Add / Update staff" />
                  </Button>
                </form>
              )}

              <div className="flex flex-col gap-2">
                {staff.map((s) => (
                  <Inner key={s.userId} className="flex-row items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{s.displayName || s.email}</p>
                      <p className="truncate text-xs text-muted">{s.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={s.role === "owner" ? "lilac" : s.role === "manager" ? "ice" : "lime"}>
                        {s.role}
                      </Badge>
                      {isOwner && (
                        <Button
                          variant="outline"
                          tone="red"
                          small
                          icon={Trash2}
                          onClick={() => handleRemoveStaff(s.userId)}
                        >
                          <span className="sr-only">Remove</span>
                        </Button>
                      )}
                    </div>
                  </Inner>
                ))}
              </div>
            </Card>

            <Card>
              <CardTitle>
                <Text ro="Jurnal Audit" en="Audit Log" />
              </CardTitle>
              {auditLogs.length === 0 ? (
                <Empty icon={Shield}>
                  <Text ro="Nicio acțiune înregistrată." en="No audit entries yet." />
                </Empty>
              ) : (
                <div className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
                  {auditLogs.map((log) => (
                    <Inner key={log.id} className="gap-0.5 py-2">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold text-foreground">{log.action}</span>
                        <span className="tabular-nums text-muted">
                          {log.createdAt ? new Date(log.createdAt).toLocaleString(locale) : ""}
                        </span>
                      </div>
                      <span className="text-xs text-muted">{log.actorName}</span>
                    </Inner>
                  ))}
                </div>
              )}
            </Card>
          </Stack>
        </Columns>
      )}
    </Stack>
  );
}
