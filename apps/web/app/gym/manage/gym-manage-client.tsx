"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Ban,
  CheckCircle2,
  CreditCard,
  PauseCircle,
  PlayCircle,
  Plus,
  QrCode,
  Radio,
  RefreshCw,
  Search,
  UserCheck,
  UserPlus,
  Users,
  Volume2,
  VolumeX,
  X,
  XCircle,
} from "lucide-react";
import {
  ALL_DAYS_MASK,
  GYM_WEEKDAYS,
  formatGymOutcomeMessage,
  formatMoneyCents,
  isDayAllowed,
  toggleDayInMask,
  type GymPaymentMethod,
  type GymPlanType,
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
  IconButton,
  Inner,
  Input,
  Message,
  Screen,
  Segmented,
  Select,
  Stack,
} from "@/app/components/ui";
import { clientApi } from "@/lib/api/client";
import type {
  ApiGymCheckinEvent,
  ApiGymCheckinsDashboard,
  ApiGymMember,
  ApiGymPlan,
  ApiStaffGym,
} from "@/lib/api/gym-types";
import { ApiError } from "@/lib/api/types";
import { playCheckinSound } from "./audio";
import { QrPosterTab } from "./qr-poster-tab";

type ManageTab = "live" | "members" | "plans" | "qr";

export function GymManageClient({
  initialGyms,
  initialGymId,
}: {
  initialGyms: ApiStaffGym[];
  initialGymId?: string;
}) {
  const { t, locale } = useLanguage();
  const [gyms, setGyms] = useState<ApiStaffGym[]>(initialGyms);
  const [selectedGymId, setSelectedGymId] = useState<string>(
    initialGyms.find((g) => g.gymId === initialGymId)?.gymId ?? initialGyms[0]?.gymId ?? "",
  );
  const gym = useMemo(
    () => gyms.find((g) => g.gymId === selectedGymId) ?? gyms[0],
    [gyms, selectedGymId],
  );
  const canManage = gym?.role === "owner" || gym?.role === "manager";

  const [tab, setTab] = useState<ManageTab>("live");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const soundRef = useRef(soundEnabled);
  useEffect(() => {
    soundRef.current = soundEnabled;
  }, [soundEnabled]);

  const [sseConnected, setSseConnected] = useState(false);
  const [dashboard, setDashboard] = useState<ApiGymCheckinsDashboard | null>(null);
  const [members, setMembers] = useState<ApiGymMember[]>([]);
  const [plans, setPlans] = useState<ApiGymPlan[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [liveSearch, setLiveSearch] = useState("");
  const [liveOutcomeFilter, setLiveOutcomeFilter] = useState<"all" | "allowed" | "denied">("all");
  const [feedback, setFeedback] = useState<{ tone: "lime" | "red"; text: string } | null>(null);

  // Manual check-in modal
  const manualDialogRef = useRef<HTMLDialogElement>(null);
  const [manualMemberId, setManualMemberId] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [manualDeduct, setManualDeduct] = useState(false);

  // Add member modal
  const addMemberDialogRef = useRef<HTMLDialogElement>(null);
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberPhone, setNewMemberPhone] = useState("");
  const [newMemberNotes, setNewMemberNotes] = useState("");
  const [createdTempPassword, setCreatedTempPassword] = useState<string | null>(null);

  // Activate / Renew subscription modal
  const subDialogRef = useRef<HTMLDialogElement>(null);
  const [subTargetMember, setSubTargetMember] = useState<{ id: string; label: string } | null>(null);
  const [subPlanId, setSubPlanId] = useState("");
  const [subPayMethod, setSubPayMethod] = useState<GymPaymentMethod>("cash");
  const [subPayAmount, setSubPayAmount] = useState("");
  const [subPayRef, setSubPayRef] = useState("");

  // Freeze modal
  const freezeDialogRef = useRef<HTMLDialogElement>(null);
  const [freezeSubId, setFreezeSubId] = useState<string | null>(null);
  const [freezeDays, setFreezeDays] = useState("7");

  // Plan form
  const [planName, setPlanName] = useState("");
  const [planType, setPlanType] = useState<GymPlanType>("time_based");
  const [planDuration, setPlanDuration] = useState("30");
  const [planSessions, setPlanSessions] = useState("10");
  const [planPrice, setPlanPrice] = useState("250");
  const [planFromTime, setPlanFromTime] = useState("");
  const [planToTime, setPlanToTime] = useState("");
  const [planDaysMask, setPlanDaysMask] = useState(ALL_DAYS_MASK);
  const [planMaxFreeze, setPlanMaxFreeze] = useState("7");

  const loadCoreData = useCallback(async () => {
    if (!gym) return;
    try {
      const [dashRes, membersRes, plansRes] = await Promise.all([
        clientApi<ApiGymCheckinsDashboard>(`/gym/${gym.gymId}/checkins`),
        clientApi<ApiGymMember[]>(`/gym/${gym.gymId}/members`),
        clientApi<ApiGymPlan[]>(`/gym/${gym.gymId}/plans`),
      ]);
      setDashboard(dashRes);
      setMembers(membersRes);
      setPlans(plansRes);
    } catch (err) {
      setFeedback({
        tone: "red",
        text: err instanceof ApiError ? err.message : t("Încărcarea datelor a eșuat.", "Failed to load gym data."),
      });
    }
  }, [gym, t]);

  useEffect(() => {
    if (!gym) return;
    let cancelled = false;
    async function fetchInitial() {
      try {
        const [dashRes, membersRes, plansRes] = await Promise.all([
          clientApi<ApiGymCheckinsDashboard>(`/gym/${gym.gymId}/checkins`),
          clientApi<ApiGymMember[]>(`/gym/${gym.gymId}/members`),
          clientApi<ApiGymPlan[]>(`/gym/${gym.gymId}/plans`),
        ]);
        if (cancelled) return;
        setDashboard(dashRes);
        setMembers(membersRes);
        setPlans(plansRes);
      } catch (err) {
        if (cancelled) return;
        setFeedback({
          tone: "red",
          text: err instanceof ApiError ? err.message : t("Încărcarea datelor a eșuat.", "Failed to load gym data."),
        });
      }
    }
    void fetchInitial();
    return () => {
      cancelled = true;
    };
  }, [gym, t]);

  // Real-time Server-Sent Events subscription for Live Reception Feed
  useEffect(() => {
    if (!gym) return;
    const es = new EventSource(`/api/v1/gym/${gym.gymId}/checkins/stream`, {
      withCredentials: true,
    });

    es.addEventListener("connected", () => {
      setSseConnected(true);
    });

    es.addEventListener("checkin", (ev) => {
      try {
        const item = JSON.parse((ev as MessageEvent).data) as ApiGymCheckinEvent;
        if (soundRef.current) {
          if (item.outcome === "allowed") {
            playCheckinSound(item.expiringSoon ? "warning" : "allowed");
          } else {
            playCheckinSound("denied");
          }
        }
        setDashboard((prev) => {
          if (!prev) return prev;
          if (prev.items.some((x) => x.checkinId === item.checkinId)) return prev;
          const isAllowed = item.outcome === "allowed";
          return {
            ...prev,
            stats: {
              ...prev.stats,
              todayTotal: prev.stats.todayTotal + 1,
              todayAllowed: prev.stats.todayAllowed + (isAllowed ? 1 : 0),
              todayDenied: prev.stats.todayDenied + (isAllowed ? 0 : 1),
              inGymNow: prev.stats.inGymNow + (isAllowed ? 1 : 0),
            },
            items: [item, ...prev.items].slice(0, 250),
          };
        });
      } catch {
        // Ignore malformed event
      }
    });

    es.onerror = () => {
      setSseConnected(false);
    };

    return () => {
      setSseConnected(false);
      es.close();
    };
  }, [gym]);

  const filteredLiveItems = useMemo(() => {
    const items = dashboard?.items ?? [];
    const needle = liveSearch.trim().toLowerCase();
    return items.filter((item) => {
      if (liveOutcomeFilter === "allowed" && item.outcome !== "allowed") return false;
      if (liveOutcomeFilter === "denied" && item.outcome === "allowed") return false;
      if (needle) {
        const hay = `${item.memberName} ${item.memberEmail} ${item.memberCode ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [dashboard, liveOutcomeFilter, liveSearch]);

  const filteredMembers = useMemo(() => {
    const needle = memberSearch.trim().toLowerCase();
    if (!needle) return members;
    return members.filter((m) =>
      `${m.displayName ?? ""} ${m.email} ${m.memberCode} ${m.phone ?? ""}`.toLowerCase().includes(needle),
    );
  }, [memberSearch, members]);

  const activePlans = useMemo(() => plans.filter((p) => p.isActive), [plans]);

  function openRenewDialog(memberId: string, label: string) {
    setSubTargetMember({ id: memberId, label });
    const firstPlan = activePlans[0] ?? plans[0];
    setSubPlanId(firstPlan?.id ?? "");
    setSubPayAmount(firstPlan ? String(firstPlan.priceCents / 100) : "0");
    setSubPayMethod("cash");
    setSubPayRef("");
    subDialogRef.current?.showModal();
  }

  async function handleManualCheckin(e: React.FormEvent) {
    e.preventDefault();
    if (!gym || !manualMemberId) return;
    setFeedback(null);
    try {
      await clientApi(`/gym/${gym.gymId}/checkins/manual`, {
        method: "POST",
        body: {
          memberId: manualMemberId,
          overrideReason: manualReason.trim(),
          deductSession: manualDeduct,
        },
      });
      manualDialogRef.current?.close();
      setManualReason("");
      setManualDeduct(false);
      setFeedback({ tone: "lime", text: t("Check-in manual înregistrat.", "Manual check-in recorded.") });
      await loadCoreData();
    } catch (err) {
      setFeedback({
        tone: "red",
        text: err instanceof ApiError ? err.message : t("Check-in-ul manual a eșuat.", "Manual check-in failed."),
      });
    }
  }

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    if (!gym) return;
    setFeedback(null);
    setCreatedTempPassword(null);
    try {
      const res = await clientApi<{
        email: string;
        memberCode: string;
        generatedPassword: string | null;
      }>(`/gym/${gym.gymId}/members`, {
        method: "POST",
        body: {
          email: newMemberEmail.trim(),
          displayName: newMemberName.trim() || undefined,
          phone: newMemberPhone.trim() || null,
          notes: newMemberNotes.trim() || null,
        },
      });
      setNewMemberEmail("");
      setNewMemberName("");
      setNewMemberPhone("");
      setNewMemberNotes("");
      if (res.generatedPassword) {
        setCreatedTempPassword(res.generatedPassword);
      } else {
        addMemberDialogRef.current?.close();
      }
      setFeedback({
        tone: "lime",
        text: t(
          `Membrul ${res.email} (${res.memberCode}) a fost adăugat.`,
          `Member ${res.email} (${res.memberCode}) added.`,
        ),
      });
      await loadCoreData();
    } catch (err) {
      setFeedback({
        tone: "red",
        text: err instanceof ApiError ? err.message : t("Adăugarea membrului a eșuat.", "Failed to add member."),
      });
    }
  }

  async function handleCreateSubscription(e: React.FormEvent) {
    e.preventDefault();
    if (!gym || !subTargetMember || !subPlanId) return;
    setFeedback(null);
    try {
      const amountCents = Math.max(0, Math.round((Number(subPayAmount) || 0) * 100));
      await clientApi(`/gym/${gym.gymId}/subscriptions`, {
        method: "POST",
        body: {
          memberId: subTargetMember.id,
          planId: subPlanId,
          recordPayment: true,
          paymentAmountCents: amountCents,
          paymentMethod: subPayMethod,
          paymentReference: subPayRef.trim() || null,
        },
      });
      subDialogRef.current?.close();
      setFeedback({
        tone: "lime",
        text: t(
          `Abonament activat pentru ${subTargetMember.label}.`,
          `Subscription activated for ${subTargetMember.label}.`,
        ),
      });
      await loadCoreData();
    } catch (err) {
      setFeedback({
        tone: "red",
        text: err instanceof ApiError ? err.message : t("Activarea abonamentului a eșuat.", "Failed to activate subscription."),
      });
    }
  }

  async function handleFreeze(e: React.FormEvent) {
    e.preventDefault();
    if (!gym || !freezeSubId) return;
    setFeedback(null);
    try {
      await clientApi(`/gym/${gym.gymId}/subscriptions/${freezeSubId}/freeze`, {
        method: "POST",
        body: { days: Math.max(1, Number(freezeDays) || 7) },
      });
      freezeDialogRef.current?.close();
      setFeedback({ tone: "lime", text: t("Abonamentul a fost înghețat.", "Subscription frozen.") });
      await loadCoreData();
    } catch (err) {
      setFeedback({
        tone: "red",
        text: err instanceof ApiError ? err.message : t("Înghețarea a eșuat.", "Freeze failed."),
      });
    }
  }

  async function handleUnfreeze(subId: string) {
    if (!gym) return;
    setFeedback(null);
    try {
      const res = await clientApi<{ frozenDaysAdded: number }>(
        `/gym/${gym.gymId}/subscriptions/${subId}/unfreeze`,
        { method: "POST" },
      );
      setFeedback({
        tone: "lime",
        text: t(
          `Abonament dezghețat (+${res.frozenDaysAdded} zile prelungire).`,
          `Subscription unfrozen (+${res.frozenDaysAdded} days extended).`,
        ),
      });
      await loadCoreData();
    } catch (err) {
      setFeedback({
        tone: "red",
        text: err instanceof ApiError ? err.message : t("Dezghețarea a eșuat.", "Unfreeze failed."),
      });
    }
  }

  async function handleToggleMemberStatus(member: ApiGymMember) {
    if (!gym) return;
    setFeedback(null);
    const nextStatus = member.status === "active" ? "suspended" : "active";
    try {
      await clientApi(`/gym/${gym.gymId}/members/${member.id}`, {
        method: "PATCH",
        body: { status: nextStatus },
      });
      setFeedback({
        tone: "lime",
        text:
          nextStatus === "suspended"
            ? t("Membrul a fost suspendat.", "Member suspended.")
            : t("Membrul a fost reactivat.", "Member reactivated."),
      });
      await loadCoreData();
    } catch (err) {
      setFeedback({
        tone: "red",
        text: err instanceof ApiError ? err.message : t("Actualizarea a eșuat.", "Update failed."),
      });
    }
  }

  async function handleCreatePlan(e: React.FormEvent) {
    e.preventDefault();
    if (!gym) return;
    setFeedback(null);
    try {
      await clientApi(`/gym/${gym.gymId}/plans`, {
        method: "POST",
        body: {
          name: planName.trim(),
          planType,
          durationDays: Math.max(1, Number(planDuration) || 30),
          sessionCount: planType === "session_pack" ? Math.max(1, Number(planSessions) || 10) : null,
          priceCents: Math.max(0, Math.round((Number(planPrice) || 0) * 100)),
          currency: gym.gymCurrency,
          allowedFromTime: planFromTime.trim() || null,
          allowedToTime: planToTime.trim() || null,
          allowedDaysMask: planDaysMask || ALL_DAYS_MASK,
          maxFreezeDays: Math.max(0, Number(planMaxFreeze) || 0),
        },
      });
      setPlanName("");
      setPlanFromTime("");
      setPlanToTime("");
      setPlanDaysMask(ALL_DAYS_MASK);
      setFeedback({ tone: "lime", text: t("Planul de abonament a fost creat.", "Membership plan created.") });
      await loadCoreData();
    } catch (err) {
      setFeedback({
        tone: "red",
        text: err instanceof ApiError ? err.message : t("Crearea planului a eșuat.", "Plan creation failed."),
      });
    }
  }

  async function handleTogglePlanActive(plan: ApiGymPlan) {
    if (!gym) return;
    try {
      await clientApi(`/gym/${gym.gymId}/plans/${plan.id}`, {
        method: "PATCH",
        body: { isActive: !plan.isActive },
      });
      await loadCoreData();
    } catch (err) {
      setFeedback({
        tone: "red",
        text: err instanceof ApiError ? err.message : t("Actualizarea a eșuat.", "Update failed."),
      });
    }
  }

  if (!gym) {
    return (
      <Screen title={<Text ro="Administrare Sală" en="Gym Management" />} back="/">
        <Empty icon={Users}>
          <Text ro="Nu ai acces de staff la nicio sală." en="You do not have staff access to any gym." />
        </Empty>
      </Screen>
    );
  }

  return (
    <Screen
      title={gym.gymName}
      back="/"
      right={
        <div className="no-print flex items-center gap-2">
          <Badge tone={sseConnected ? "lime" : "gold"}>
            <Radio className="mr-1 size-3" />
            {sseConnected ? "Live" : t("Offline", "Reconnecting")}
          </Badge>
          <IconButton
            icon={soundEnabled ? Volume2 : VolumeX}
            tone={soundEnabled ? "lime" : undefined}
            label={soundEnabled ? t("Sunet pornit", "Sound on") : t("Sunet oprit", "Sound off")}
            onClick={() => {
              const next = !soundEnabled;
              setSoundEnabled(next);
              if (next) playCheckinSound("allowed");
            }}
          />
          <IconButton icon={RefreshCw} label={t("Reîncarcă", "Refresh")} onClick={() => void loadCoreData()} />
        </div>
      }
    >
      {gyms.length > 1 && (
        <div className="no-print max-w-sm">
          <Select
            value={gym.gymId}
            onChange={setSelectedGymId}
            options={gyms.map((g) => ({ value: g.gymId, label: g.gymName, subtitle: g.role }))}
          />
        </div>
      )}

      <div className="no-print">
        <Segmented<ManageTab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "live", label: t("Live Intrări", "Live Desk"), icon: Activity },
            { value: "members", label: t("Membri", "Members"), icon: Users },
            { value: "plans", label: t("Planuri", "Plans"), icon: CreditCard },
            { value: "qr", label: t("QR & Rapoarte", "QR & Reports"), icon: QrCode },
          ]}
        />
      </div>

      {feedback && <Message tone={feedback.tone} className="no-print">{feedback.text}</Message>}

      {/* TAB 1: LIVE CHECK-IN DESK */}
      {tab === "live" && (
        <Stack>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card>
              <span className="text-xs font-medium text-muted">
                <Text ro="Intrări azi" en="Check-ins today" />
              </span>
              <BigNumber
                value={dashboard?.stats.todayAllowed ?? 0}
                unit={
                  dashboard && dashboard.stats.todayDenied > 0
                    ? `/ ${dashboard.stats.todayDenied} ${t("respinși", "denied")}`
                    : undefined
                }
              />
            </Card>
            <Card>
              <span className="text-xs font-medium text-muted">
                <Text ro="În sală acum (90m)" en="In gym now (90m)" />
              </span>
              <BigNumber
                value={dashboard?.stats.inGymNow ?? 0}
                unit={gym.gymCapacity ? `/ ${gym.gymCapacity}` : undefined}
              />
            </Card>
            <Card>
              <span className="text-xs font-medium text-muted">
                <Text ro="Abonamente active" en="Active subs" />
              </span>
              <BigNumber value={dashboard?.stats.activeSubscriptions ?? 0} />
            </Card>
            <Card>
              <span className="text-xs font-medium text-muted">
                <Text ro="Expiră curând" en="Expiring soon" />
              </span>
              <BigNumber value={dashboard?.stats.expiringSoonCount ?? 0} />
            </Card>
          </div>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <Input
                  type="search"
                  value={liveSearch}
                  onChange={(e) => setLiveSearch(e.target.value)}
                  placeholder={t("Caută nume, email, cod membru...", "Search name, email, code...")}
                  className="max-w-xs"
                />
                <Segmented
                  inCard
                  value={liveOutcomeFilter}
                  onChange={setLiveOutcomeFilter}
                  options={[
                    { value: "all", label: t("Toți", "All") },
                    { value: "allowed", label: t("Permiși", "Allowed") },
                    { value: "denied", label: t("Respinși", "Denied") },
                  ]}
                />
              </div>
              <Button
                small
                icon={UserCheck}
                onClick={() => {
                  setManualMemberId(members[0]?.id ?? "");
                  setManualReason("");
                  manualDialogRef.current?.showModal();
                }}
              >
                <Text ro="Check-in manual" en="Manual check-in" />
              </Button>
            </div>

            {filteredLiveItems.length === 0 ? (
              <Empty icon={Activity}>
                <Text ro="Nicio intrare înregistrată azi încă." en="No check-ins recorded today yet." />
              </Empty>
            ) : (
              <div className="flex flex-col gap-2.5">
                {filteredLiveItems.map((item) => {
                  const isAllowed = item.outcome === "allowed";
                  const tone = isAllowed ? (item.expiringSoon ? "gold" : "lime") : "red";
                  const reasonMsg = isAllowed
                    ? item.overrideReason
                      ? `${t("Override manual", "Manual override")}: ${item.overrideReason}`
                      : item.expiringSoon
                        ? t("Atenție: abonamentul expiră curând!", "Warning: subscription expiring soon!")
                        : null
                    : formatGymOutcomeMessage(
                        item.outcome,
                        {
                          endsAt: item.endsAt,
                          frozenUntil: item.frozenUntil,
                          allowedFromTime: item.allowedFromTime,
                          allowedToTime: item.allowedToTime,
                          gpsRejected: item.gpsRejected,
                        },
                        t,
                        locale,
                      );

                  return (
                    <div
                      key={item.checkinId}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-inner p-3.5"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        {isAllowed ? (
                          <CheckCircle2
                            className={`mt-0.5 size-5 shrink-0 ${item.expiringSoon ? "text-gold-text" : "text-lime-text"}`}
                          />
                        ) : (
                          <XCircle className="mt-0.5 size-5 shrink-0 text-red-text" />
                        )}
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-bold tabular-nums text-muted">
                              {new Date(item.checkedInAt).toLocaleTimeString(locale, {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                              })}
                            </span>
                            <span className="font-semibold">{item.memberName}</span>
                            {item.memberCode && <Badge>{item.memberCode}</Badge>}
                            <Badge tone={tone}>
                              {isAllowed
                                ? item.expiringSoon
                                  ? t("Expiră curând", "Expiring soon")
                                  : t("Permis", "Allowed")
                                : t("Respins", "Denied")}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted">
                            {item.memberEmail}
                            {item.planName ? ` · ${item.planName}` : ""}
                            {item.planType === "session_pack" && item.sessionsAfter !== null
                              ? ` · ${item.sessionsAfter} ${t("ședințe rămase", "sessions left")}`
                              : item.daysLeft !== null
                                ? ` · ${item.daysLeft} ${t("zile rămase", "days left")}`
                                : ""}
                          </p>
                          {reasonMsg && (
                            <p className={`mt-1 text-xs font-semibold ${isAllowed ? "text-gold-text" : "text-red-text"}`}>
                              {reasonMsg}
                            </p>
                          )}
                        </div>
                      </div>

                      {item.memberId && (!isAllowed || item.expiringSoon) && plans.length > 0 && (
                        <Button
                          variant="soft"
                          tone="lime"
                          small
                          icon={CreditCard}
                          onClick={() => openRenewDialog(item.memberId!, item.memberName)}
                        >
                          <Text ro="Reînnoiește" en="Renew" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </Stack>
      )}

      {/* TAB 2: MEMBERS & SUBSCRIPTIONS */}
      {tab === "members" && (
        <Stack>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="relative flex-1 max-w-sm">
                <Input
                  type="search"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder={t("Caută membru (nume, email, cod, telefon)...", "Search member...")}
                />
              </div>
              <Button
                small
                icon={UserPlus}
                onClick={() => {
                  setCreatedTempPassword(null);
                  addMemberDialogRef.current?.showModal();
                }}
              >
                <Text ro="Membru nou" en="New member" />
              </Button>
            </div>

            {filteredMembers.length === 0 ? (
              <Empty icon={Search}>
                <Text ro="Niciun membru găsit." en="No members found." />
              </Empty>
            ) : (
              <div className="flex flex-col gap-3">
                {filteredMembers.map((m) => {
                  const sub = m.activeSubscription;
                  const subTone =
                    sub?.status === "active"
                      ? sub.daysLeft <= 3 || (sub.sessionsRemaining !== null && sub.sessionsRemaining <= 2)
                        ? "gold"
                        : "lime"
                      : sub?.status === "frozen"
                        ? "ice"
                        : "red";

                  return (
                    <Inner key={m.id} className="gap-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">{m.displayName || m.email}</span>
                            <Badge>{m.memberCode}</Badge>
                            {m.status === "suspended" && (
                              <Badge tone="red">{t("Suspendat", "Suspended")}</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted">
                            {m.email}
                            {m.phone ? ` · ${m.phone}` : ""}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <Button
                            small
                            icon={CreditCard}
                            disabled={plans.length === 0}
                            onClick={() => openRenewDialog(m.id, m.displayName || m.email)}
                          >
                            <Text ro="Abonament" en="Subscribe" />
                          </Button>
                          {sub?.status === "active" && sub.maxFreezeDays > 0 && (
                            <Button
                              variant="soft"
                              tone="ice"
                              small
                              icon={PauseCircle}
                              onClick={() => {
                                setFreezeSubId(sub.id);
                                setFreezeDays("7");
                                freezeDialogRef.current?.showModal();
                              }}
                            >
                              <Text ro="Îngheață" en="Freeze" />
                            </Button>
                          )}
                          {sub?.status === "frozen" && (
                            <Button
                              variant="soft"
                              tone="lime"
                              small
                              icon={PlayCircle}
                              onClick={() => handleUnfreeze(sub.id)}
                            >
                              <Text ro="Dezgheață" en="Unfreeze" />
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            tone={m.status === "active" ? "red" : "lime"}
                            small
                            icon={Ban}
                            onClick={() => handleToggleMemberStatus(m)}
                          >
                            {m.status === "active" ? t("Suspendă", "Suspend") : t("Reactivează", "Activate")}
                          </Button>
                        </div>
                      </div>

                      {sub ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm bg-card px-3 py-2 text-xs">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={subTone}>{sub.status}</Badge>
                            <span className="font-semibold">{sub.planName}</span>
                            {sub.allowedFromTime && sub.allowedToTime && (
                              <span className="text-muted">
                                ({sub.allowedFromTime}–{sub.allowedToTime})
                              </span>
                            )}
                          </div>
                          <span className="tabular-nums text-muted">
                            {sub.planType === "session_pack"
                              ? `${sub.sessionsRemaining ?? 0}/${sub.sessionsTotal ?? 0} ${t("ședințe", "sessions")} · `
                              : ""}
                            {t("până pe", "until")}{" "}
                            {new Date(sub.endsAt).toLocaleDateString(locale)}
                          </span>
                        </div>
                      ) : (
                        <p className="text-xs text-muted">
                          <Text ro="Fără abonament activ." en="No active subscription." />
                        </p>
                      )}
                    </Inner>
                  );
                })}
              </div>
            )}
          </Card>
        </Stack>
      )}

      {/* TAB 3: MEMBERSHIP PLANS */}
      {tab === "plans" && (
        <Columns>
          {canManage && (
            <Stack>
              <Card>
                <CardTitle
                  description={
                    <Text
                      ro="Creează abonamente pe timp, pachete de ședințe sau abonamente Day Time cu interval orar."
                      en="Create time-based passes, session packs, or Day Time passes with hourly & weekday rules."
                    />
                  }
                >
                  <Text ro="Plan nou de abonament" en="New Membership Plan" />
                </CardTitle>
                <form onSubmit={handleCreatePlan} className="flex flex-col gap-3">
                  <Field label={<Text ro="Denumire plan" en="Plan name" />}>
                    <Input
                      required
                      value={planName}
                      onChange={(e) => setPlanName(e.target.value)}
                      placeholder={t("ex. Full 30 Zile / Day Time 07-16", "e.g. Full 30 Days / Day Time")}
                    />
                  </Field>
                  <Segmented<GymPlanType>
                    inCard
                    value={planType}
                    onChange={setPlanType}
                    options={[
                      { value: "time_based", label: t("Pe timp", "Time-based") },
                      { value: "session_pack", label: t("Pachet ședințe", "Session pack") },
                    ]}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={<Text ro="Durată (zile)" en="Duration (days)" />}>
                      <Input
                        type="number"
                        min={1}
                        max={3650}
                        required
                        value={planDuration}
                        onChange={(e) => setPlanDuration(e.target.value)}
                      />
                    </Field>
                    <Field label={`${t("Preț", "Price")} (${gym.gymCurrency})`}>
                      <Input
                        type="number"
                        step="0.01"
                        min={0}
                        required
                        value={planPrice}
                        onChange={(e) => setPlanPrice(e.target.value)}
                      />
                    </Field>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {planType === "session_pack" && (
                      <Field label={<Text ro="Număr ședințe" en="Session count" />}>
                        <Input
                          type="number"
                          min={1}
                          max={1000}
                          required
                          value={planSessions}
                          onChange={(e) => setPlanSessions(e.target.value)}
                        />
                      </Field>
                    )}
                    <Field label={<Text ro="Zile max. înghețare" en="Max freeze days" />}>
                      <Input
                        type="number"
                        min={0}
                        max={365}
                        value={planMaxFreeze}
                        onChange={(e) => setPlanMaxFreeze(e.target.value)}
                      />
                    </Field>
                  </div>

                  <Inner className="gap-2.5">
                    <span className="text-xs font-semibold text-muted">
                      <Text ro="Interval orar permis (opțional — Day Time)" en="Allowed time window (optional — Day Time)" />
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label={<Text ro="De la" en="From" />}>
                        <Input type="time" value={planFromTime} onChange={(e) => setPlanFromTime(e.target.value)} />
                      </Field>
                      <Field label={<Text ro="Până la" en="To" />}>
                        <Input type="time" value={planToTime} onChange={(e) => setPlanToTime(e.target.value)} />
                      </Field>
                    </div>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {GYM_WEEKDAYS.map((d) => {
                        const active = isDayAllowed(planDaysMask, d.isoDay);
                        return (
                          <button
                            key={d.isoDay}
                            type="button"
                            onClick={() => {
                              const next = toggleDayInMask(planDaysMask, d.isoDay);
                              if (next > 0) setPlanDaysMask(next);
                            }}
                            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                              active ? "bg-lime text-on-solid" : "bg-control text-muted"
                            }`}
                          >
                            {locale.startsWith("ro") ? d.shortRo : d.shortEn}
                          </button>
                        );
                      })}
                    </div>
                  </Inner>

                  <Button type="submit" icon={Plus}>
                    <Text ro="Creează plan" en="Create plan" />
                  </Button>
                </form>
              </Card>
            </Stack>
          )}

          <Stack>
            {plans.length === 0 ? (
              <Empty icon={CreditCard}>
                <Text ro="Nu există planuri configurate încă." en="No membership plans configured yet." />
              </Empty>
            ) : (
              plans.map((p) => (
                <Card key={p.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[18px] font-semibold">{p.name}</h3>
                        <Badge tone={p.planType === "session_pack" ? "lilac" : "lime"}>
                          {p.planType === "session_pack"
                            ? `${p.sessionCount} ${t("ședințe", "sessions")}`
                            : `${p.durationDays} ${t("zile", "days")}`}
                        </Badge>
                        {!p.isActive && <Badge tone="red">{t("Arhivat", "Archived")}</Badge>}
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {t("Valabilitate", "Validity")}: {p.durationDays} {t("zile", "days")}
                        {p.allowedFromTime && p.allowedToTime
                          ? ` · ${p.allowedFromTime}–${p.allowedToTime}`
                          : ` · ${t("Acces full-day", "All-day access")}`}
                        {p.maxFreezeDays > 0
                          ? ` · Freeze max ${p.maxFreezeDays} ${t("zile", "days")}`
                          : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-xl font-bold tabular-nums">
                        {formatMoneyCents(p.priceCents, p.currency, locale)}
                      </span>
                    </div>
                  </div>
                  {canManage && (
                    <div>
                      <Button
                        variant="outline"
                        small
                        onClick={() => handleTogglePlanActive(p)}
                      >
                        {p.isActive ? t("Arhivează plan", "Archive plan") : t("Reactivează plan", "Reactivate plan")}
                      </Button>
                    </div>
                  )}
                </Card>
              ))
            )}
          </Stack>
        </Columns>
      )}

      {/* TAB 4: QR POSTER & REPORTS & SETTINGS */}
      {tab === "qr" && (
        <QrPosterTab
          key={gym.gymId}
          gym={gym}
          recentCheckins={dashboard?.items ?? []}
          onGymUpdated={(updated) =>
            setGyms((prev) => prev.map((g) => (g.gymId === gym.gymId ? { ...g, ...updated } : g)))
          }
        />
      )}

      {/* DIALOG: Manual Check-in / Override */}
      <dialog
        ref={manualDialogRef}
        className="m-auto w-full max-w-md rounded-xl bg-card p-5 text-foreground backdrop:bg-[#000000a6]"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            <Text ro="Check-in Manual / Override" en="Manual Check-in / Override" />
          </h2>
          <IconButton icon={X} label="Close" onClick={() => manualDialogRef.current?.close()} />
        </div>
        <form onSubmit={handleManualCheckin} className="flex flex-col gap-3">
          <Field label={<Text ro="Membru" en="Member" />}>
            <Select
              searchable
              value={manualMemberId}
              onChange={setManualMemberId}
              options={members.map((m) => ({
                value: m.id,
                label: m.displayName || m.email,
                subtitle: `${m.memberCode} · ${m.email}`,
              }))}
            />
          </Field>
          <Field label={<Text ro="Motiv (auditat obligatoriu)" en="Reason (required & audited)" />}>
            <Input
              required
              minLength={2}
              value={manualReason}
              onChange={(e) => setManualReason(e.target.value)}
              placeholder={t("ex. Baterie descărcată la telefon", "e.g. Phone battery dead")}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={manualDeduct}
              onChange={(e) => setManualDeduct(e.target.checked)}
            />
            <Text ro="Scade 1 ședință dacă are pachet de ședințe" en="Deduct 1 session if on session pack" />
          </label>
          <Button type="submit" icon={UserCheck}>
            <Text ro="Confirmă intrarea" en="Confirm check-in" />
          </Button>
        </form>
      </dialog>

      {/* DIALOG: Add Member */}
      <dialog
        ref={addMemberDialogRef}
        className="m-auto w-full max-w-md rounded-xl bg-card p-5 text-foreground backdrop:bg-[#000000a6]"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            <Text ro="Adaugă Membru Nou" en="Add New Member" />
          </h2>
          <IconButton icon={X} label="Close" onClick={() => addMemberDialogRef.current?.close()} />
        </div>
        {createdTempPassword && (
          <Message tone="lime" className="mb-3">
            <Text
              ro={`Cont RepLog creat automat! Parolă temporară (noteaz-o acum): ${createdTempPassword}`}
              en={`RepLog account created! Temporary password (save now): ${createdTempPassword}`}
            />
          </Message>
        )}
        <form onSubmit={handleAddMember} className="flex flex-col gap-3">
          <Field label={<Text ro="Email (existent sau cont nou)" en="Email (existing or new account)" />}>
            <Input
              type="email"
              required
              value={newMemberEmail}
              onChange={(e) => setNewMemberEmail(e.target.value)}
              placeholder="client@example.com"
            />
          </Field>
          <Field label={<Text ro="Nume complet" en="Full name" />}>
            <Input
              value={newMemberName}
              onChange={(e) => setNewMemberName(e.target.value)}
              placeholder="Andrei Popescu"
            />
          </Field>
          <Field label={<Text ro="Telefon (opțional)" en="Phone (optional)" />}>
            <Input value={newMemberPhone} onChange={(e) => setNewMemberPhone(e.target.value)} />
          </Field>
          <Field label={<Text ro="Note recepție (opțional)" en="Notes (optional)" />}>
            <Input value={newMemberNotes} onChange={(e) => setNewMemberNotes(e.target.value)} />
          </Field>
          <Button type="submit" icon={UserPlus}>
            <Text ro="Înrolează membru" en="Enroll member" />
          </Button>
        </form>
      </dialog>

      {/* DIALOG: Activate / Renew Subscription */}
      <dialog
        ref={subDialogRef}
        className="m-auto w-full max-w-md rounded-xl bg-card p-5 text-foreground backdrop:bg-[#000000a6]"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            <Text ro="Activare / Reînnoire Abonament" en="Activate / Renew Subscription" />
          </h2>
          <IconButton icon={X} label="Close" onClick={() => subDialogRef.current?.close()} />
        </div>
        {subTargetMember && <p className="mb-3 text-sm font-semibold text-muted">{subTargetMember.label}</p>}
        <form onSubmit={handleCreateSubscription} className="flex flex-col gap-3">
          <Field label={<Text ro="Plan abonament" en="Plan" />}>
            <Select
              value={subPlanId}
              onChange={(val) => {
                setSubPlanId(val);
                const chosen = plans.find((p) => p.id === val);
                if (chosen) setSubPayAmount(String(chosen.priceCents / 100));
              }}
              options={(activePlans.length > 0 ? activePlans : plans).map((p) => ({
                value: p.id,
                label: p.name,
                subtitle: formatMoneyCents(p.priceCents, p.currency, locale),
              }))}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`${t("Sumă încasată", "Amount")} (${gym.gymCurrency})`}>
              <Input
                type="number"
                step="0.01"
                min={0}
                value={subPayAmount}
                onChange={(e) => setSubPayAmount(e.target.value)}
              />
            </Field>
            <Field label={<Text ro="Metodă plată" en="Payment method" />}>
              <Select
                value={subPayMethod}
                onChange={(v) => setSubPayMethod(v as GymPaymentMethod)}
                options={[
                  { value: "cash", label: t("Numerar", "Cash") },
                  { value: "card_pos", label: t("Card POS", "Card POS") },
                  { value: "bank_transfer", label: t("Transfer", "Transfer") },
                  { value: "online", label: "Online" },
                ]}
              />
            </Field>
          </div>
          <Field label={<Text ro="Referință bon / notă (opțional)" en="Receipt ref / note (optional)" />}>
            <Input value={subPayRef} onChange={(e) => setSubPayRef(e.target.value)} />
          </Field>
          <Button type="submit" icon={CreditCard}>
            <Text ro="Activează & Încasează" en="Activate & Record Payment" />
          </Button>
        </form>
      </dialog>

      {/* DIALOG: Freeze Subscription */}
      <dialog
        ref={freezeDialogRef}
        className="m-auto w-full max-w-sm rounded-xl bg-card p-5 text-foreground backdrop:bg-[#000000a6]"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">
            <Text ro="Îngheață Abonamentul" en="Freeze Subscription" />
          </h2>
          <IconButton icon={X} label="Close" onClick={() => freezeDialogRef.current?.close()} />
        </div>
        <form onSubmit={handleFreeze} className="flex flex-col gap-3">
          <Field label={<Text ro="Număr de zile de înghețare" en="Number of freeze days" />}>
            <Input
              type="number"
              min={1}
              max={365}
              required
              value={freezeDays}
              onChange={(e) => setFreezeDays(e.target.value)}
            />
          </Field>
          <p className="text-xs text-muted">
            <Text
              ro="La dezghețare, data de expirare a abonamentului se va prelungi automat cu zilele înghețate."
              en="When unfrozen, the subscription expiry date extends automatically by the frozen days."
            />
          </p>
          <Button type="submit" icon={PauseCircle}>
            <Text ro="Confirmă înghețarea" en="Confirm freeze" />
          </Button>
        </form>
      </dialog>
    </Screen>
  );
}
