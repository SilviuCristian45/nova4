import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Clock, QrCode, ShieldCheck, Users } from "lucide-react";
import { Text } from "@/app/components/language-provider";
import { getLanguage } from "@/app/language";
import { getSessionUser, serverApi } from "@/lib/api/server";
import type { ApiMyGymsResponse } from "@/lib/api/gym-types";
import {
  Badge,
  BigNumber,
  Card,
  Columns,
  CtaCard,
  Empty,
  Inner,
  Screen,
  Stack,
  buttonClass,
} from "@/app/components/ui";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function formatDateTime(iso: string | null, locale: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(locale, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default async function MyGymPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { t, locale } = await getLanguage();
  const data = await serverApi<ApiMyGymsResponse>("/gym/my").catch(() => ({
    memberships: [],
    staffGyms: [],
  }));

  return (
    <Screen
      title={<Text ro="Cardul meu de sală" en="My Gym Pass" />}
      back="/"
      right={
        data.staffGyms.length > 0 ? (
          <Link href="/gym/manage" className={buttonClass({ variant: "soft", tone: "coral", small: true })}>
            <ShieldCheck className="size-4" />
            <Text ro="Administrare" en="Manage" />
          </Link>
        ) : undefined
      }
    >
      <CtaCard
        href="/gym/scan"
        label={t("Check-in instant la intrare", "Instant check-in at reception")}
        title={t("Scanează QR Intrare", "Scan Check-in QR")}
      />

      {data.memberships.length === 0 ? (
        <Empty icon={Building2} tone="ice">
          <Text
            ro="Nu ești încă înregistrat ca membru la o sală parteneră. Cere la recepție să te adauge folosind adresa ta de email."
            en="You are not yet enrolled at a partner gym. Ask reception to add you using your RepLog email address."
          />
        </Empty>
      ) : (
        <Columns>
          {data.memberships.map((m) => {
            const sub = m.subscription;
            const isActive = sub?.status === "active";
            const isFrozen = sub?.status === "frozen";
            const expiringSoon =
              isActive &&
              ((sub.daysLeft !== null && sub.daysLeft <= 3) ||
                (sub.planType === "session_pack" &&
                  sub.sessionsRemaining !== null &&
                  sub.sessionsRemaining <= 2));

            const badgeTone = isActive ? (expiringSoon ? "gold" : "lime") : isFrozen ? "ice" : "red";
            const statusLabel = !sub
              ? t("Fără abonament", "No subscription")
              : sub.status === "active"
                ? expiringSoon
                  ? t("Expiră curând", "Expiring soon")
                  : t("Activ", "Active")
                : sub.status === "frozen"
                  ? t("Înghețat", "Frozen")
                  : sub.status === "exhausted"
                    ? t("Ședințe epuizate", "No sessions left")
                    : sub.status === "expired"
                      ? t("Expirat", "Expired")
                      : sub.status === "pending"
                        ? t("Programat", "Scheduled")
                        : t("Anulat", "Cancelled");

            return (
              <Stack key={m.memberId}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-xs font-semibold text-muted">{m.memberCode}</span>
                      <h2 className="text-[22px] font-bold tracking-[-0.5px]">{m.gymName}</h2>
                      {m.gymAddress && <p className="text-xs text-muted">{m.gymAddress}</p>}
                    </div>
                    <Badge tone={m.memberStatus === "suspended" ? "red" : badgeTone}>
                      {m.memberStatus === "suspended" ? t("Suspendat", "Suspended") : statusLabel}
                    </Badge>
                  </div>

                  {sub ? (
                    <Inner className="gap-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">{sub.planName}</span>
                        {sub.allowedFromTime && sub.allowedToTime && (
                          <Badge tone="ice">
                            <Clock className="mr-1 size-3" />
                            {sub.allowedFromTime.slice(0, 5)}–{sub.allowedToTime.slice(0, 5)}
                          </Badge>
                        )}
                      </div>

                      <div className="flex flex-wrap items-end justify-between gap-4">
                        {sub.planType === "session_pack" ? (
                          <BigNumber
                            value={sub.sessionsRemaining ?? 0}
                            unit={`/ ${sub.sessionsTotal ?? 0} ${t("ședințe", "sessions")}`}
                          />
                        ) : (
                          <BigNumber
                            value={sub.daysLeft ?? 0}
                            unit={sub.daysLeft === 1 ? t("zi rămasă", "day left") : t("zile rămase", "days left")}
                          />
                        )}
                        <div className="text-right text-xs text-muted">
                          {isFrozen && sub.frozenUntil ? (
                            <span>
                              {t("Înghețat până pe", "Frozen until")} {formatDate(sub.frozenUntil, locale)}
                            </span>
                          ) : (
                            <span>
                              {t("Valabil până pe", "Valid until")} {formatDate(sub.endsAt, locale)}
                            </span>
                          )}
                        </div>
                      </div>
                    </Inner>
                  ) : (
                    <Inner>
                      <p className="text-sm text-muted">
                        <Text
                          ro="Nu ai un abonament activ momentan. Vorbește la recepție pentru activare."
                          en="You have no active subscription right now. Speak to reception to activate one."
                        />
                      </p>
                    </Inner>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                    <span className="flex items-center gap-1.5">
                      <Users className="size-3.5 text-lime-text" />
                      {t(
                        `~${m.activeInGymNow} persoane în sală acum`,
                        `~${m.activeInGymNow} people in gym now`,
                      )}
                      {m.gymCapacity ? ` / ${m.gymCapacity}` : ""}
                    </span>
                    <Link href="/gym/scan" className={buttonClass({ small: true })}>
                      <QrCode className="size-4" />
                      <Text ro="Check-in QR" en="QR Check-in" />
                    </Link>
                  </div>

                  {m.recentCheckins.length > 0 && (
                    <div className="flex flex-col gap-1.5 pt-1">
                      <span className="text-xs font-semibold text-muted">
                        <Text ro="Ultimele intrări" en="Recent check-ins" />
                      </span>
                      <div className="flex flex-col gap-1">
                        {m.recentCheckins.slice(0, 6).map((c) => (
                          <div
                            key={c.id}
                            className="flex items-center justify-between rounded-sm bg-inner px-3 py-2 text-xs"
                          >
                            <span className="tabular-nums text-soft">
                              {formatDateTime(c.checkedInAt, locale)}
                            </span>
                            <Badge tone={c.outcome === "allowed" ? "lime" : "red"}>
                              {c.outcome === "allowed" ? t("Permis", "Allowed") : t("Respins", "Denied")}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </Card>
              </Stack>
            );
          })}
        </Columns>
      )}
    </Screen>
  );
}
