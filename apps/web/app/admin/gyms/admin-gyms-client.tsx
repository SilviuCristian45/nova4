"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, ExternalLink, Plus, Power, RefreshCw, Users } from "lucide-react";
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
  Screen,
  Stack,
  buttonClass,
} from "@/app/components/ui";
import { clientApi } from "@/lib/api/client";
import type { ApiAdminGym } from "@/lib/api/gym-types";
import { ApiError } from "@/lib/api/types";

export function AdminGymsClient({ initialGyms }: { initialGyms: ApiAdminGym[] }) {
  const { t } = useLanguage();
  const [gyms, setGyms] = useState<ApiAdminGym[]>(initialGyms);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "lime" | "red"; text: string } | null>(null);

  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [timezone, setTimezone] = useState("Europe/Bucharest");
  const [currency, setCurrency] = useState("RON");
  const [capacity, setCapacity] = useState("");

  async function reloadGyms() {
    setRefreshing(true);
    try {
      const fresh = await clientApi<ApiAdminGym[]>("/admin/gyms");
      setGyms(fresh);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    if (name.trim().length < 2) {
      setFeedback({ tone: "red", text: t("Introdu numele sălii.", "Please enter a gym name.") });
      return;
    }
    try {
      const capNum = capacity.trim() ? Number(capacity) : null;
      await clientApi("/admin/gyms", {
        method: "POST",
        body: {
          name: name.trim(),
          address: address.trim() || null,
          ownerEmail: ownerEmail.trim() || undefined,
          timezone: timezone.trim() || "Europe/Bucharest",
          currency: (currency.trim() || "RON").toUpperCase(),
          capacity: capNum && Number.isInteger(capNum) && capNum > 0 ? capNum : null,
        },
      });
      setName("");
      setAddress("");
      setOwnerEmail("");
      setCapacity("");
      setFeedback({
        tone: "lime",
        text: t("Sala a fost creată cu succes.", "Gym created successfully."),
      });
      await reloadGyms();
    } catch (err) {
      setFeedback({
        tone: "red",
        text: err instanceof ApiError ? err.message : t("Crearea sălii a eșuat.", "Failed to create gym."),
      });
    }
  }

  async function handleToggleActive(gym: ApiAdminGym) {
    setFeedback(null);
    try {
      await clientApi(`/admin/gyms/${gym.id}`, {
        method: "PATCH",
        body: { isActive: !gym.isActive },
      });
      setFeedback({
        tone: "lime",
        text: !gym.isActive
          ? t(`Sala „${gym.name}” a fost reactivată.`, `Gym "${gym.name}" reactivated.`)
          : t(`Sala „${gym.name}” a fost dezactivată.`, `Gym "${gym.name}" deactivated.`),
      });
      await reloadGyms();
    } catch (err) {
      setFeedback({
        tone: "red",
        text: err instanceof ApiError ? err.message : t("Actualizarea a eșuat.", "Update failed."),
      });
    }
  }

  const totalMembers = gyms.reduce((acc, g) => acc + g.membersCount, 0);
  const totalActiveSubs = gyms.reduce((acc, g) => acc + g.activeSubscriptionsCount, 0);

  return (
    <Screen
      title={<Text ro="Administrare Săli" en="Gym Administration" />}
      back="/admin"
      right={
        <Button variant="secondary" small icon={RefreshCw} busy={refreshing} onClick={reloadGyms}>
          <Text ro="Reîncarcă" en="Refresh" />
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <span className="text-xs font-medium text-muted">
            <Text ro="Săli înregistrate" en="Registered gyms" />
          </span>
          <BigNumber value={gyms.length} />
        </Card>
        <Card>
          <span className="text-xs font-medium text-muted">
            <Text ro="Total membri" en="Total members" />
          </span>
          <BigNumber value={totalMembers} />
        </Card>
        <Card>
          <span className="text-xs font-medium text-muted">
            <Text ro="Abonamente active" en="Active subscriptions" />
          </span>
          <BigNumber value={totalActiveSubs} />
        </Card>
      </div>

      {feedback && <Message tone={feedback.tone}>{feedback.text}</Message>}

      <Columns>
        <Stack>
          <Card>
            <CardTitle
              description={
                <Text
                  ro="Creează o sală nouă și desemnează proprietarul (după emailul contului RepLog)."
                  en="Create a new gym and designate its owner by RepLog account email."
                />
              }
            >
              <Text ro="Adaugă sală nouă" en="Create new gym" />
            </CardTitle>
            <form onSubmit={handleCreate} className="flex flex-col gap-3">
              <Field label={<Text ro="Numele sălii" en="Gym name" />} htmlFor="gym-name">
                <Input
                  id="gym-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Titan Fitness Studio"
                />
              </Field>
              <Field label={<Text ro="Adresă (opțional)" en="Address (optional)" />} htmlFor="gym-address">
                <Input
                  id="gym-address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Str. Exemplu 12, București"
                />
              </Field>
              <Field
                label={<Text ro="Email proprietar (opțional)" en="Owner email (optional)" />}
                htmlFor="gym-owner"
              >
                <Input
                  id="gym-owner"
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  placeholder="owner@example.com"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={<Text ro="Monedă" en="Currency" />} htmlFor="gym-currency">
                  <Input
                    id="gym-currency"
                    maxLength={3}
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                    placeholder="RON"
                  />
                </Field>
                <Field label={<Text ro="Capacitate (opțional)" en="Capacity (optional)" />} htmlFor="gym-cap">
                  <Input
                    id="gym-cap"
                    type="number"
                    min={1}
                    value={capacity}
                    onChange={(e) => setCapacity(e.target.value)}
                    placeholder="80"
                  />
                </Field>
              </div>
              <Field label={<Text ro="Fus orar" en="Timezone" />} htmlFor="gym-tz">
                <Input
                  id="gym-tz"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="Europe/Bucharest"
                />
              </Field>
              <Button type="submit" icon={Plus}>
                <Text ro="Creează sala" en="Create gym" />
              </Button>
            </form>
          </Card>
        </Stack>

        <Stack>
          {gyms.length === 0 ? (
            <Empty icon={Building2}>
              <Text ro="Nu există încă săli create." en="No gyms created yet." />
            </Empty>
          ) : (
            gyms.map((gym) => (
              <Card key={gym.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[18px] font-semibold tracking-[-0.3px]">{gym.name}</h2>
                      <Badge tone={gym.isActive ? "lime" : "red"}>
                        {gym.isActive ? t("Activă", "Active") : t("Inactivă", "Inactive")}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted">
                      /{gym.slug} · {gym.timezone} · {gym.currency}
                    </p>
                    {gym.address && <p className="mt-1 text-sm text-soft">{gym.address}</p>}
                  </div>
                </div>

                <Inner className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-lg font-bold tabular-nums">{gym.membersCount}</div>
                    <div className="text-xs text-muted">
                      <Text ro="Membri" en="Members" />
                    </div>
                  </div>
                  <div>
                    <div className="text-lg font-bold tabular-nums">{gym.activeSubscriptionsCount}</div>
                    <div className="text-xs text-muted">
                      <Text ro="Abonamente" en="Active subs" />
                    </div>
                  </div>
                  <div>
                    <div className="text-lg font-bold tabular-nums">{gym.staffCount}</div>
                    <div className="text-xs text-muted">
                      <Text ro="Staff" en="Staff" />
                    </div>
                  </div>
                </Inner>

                {gym.ownerEmails.length > 0 && (
                  <p className="flex items-center gap-1.5 text-xs text-muted">
                    <Users className="size-3.5" />
                    {t("Proprietari", "Owners")}: {gym.ownerEmails.join(", ")}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/gym/manage?gymId=${gym.id}`}
                    className={buttonClass({ variant: "primary", small: true })}
                  >
                    <ExternalLink className="size-4" />
                    <Text ro="Deschide dashboard sală" en="Open gym dashboard" />
                  </Link>
                  <Button
                    variant={gym.isActive ? "outline" : "soft"}
                    tone={gym.isActive ? "red" : "lime"}
                    small
                    icon={Power}
                    onClick={() => handleToggleActive(gym)}
                  >
                    {gym.isActive ? t("Dezactivează", "Deactivate") : t("Reactivează", "Activate")}
                  </Button>
                </div>
              </Card>
            ))
          )}
        </Stack>
      </Columns>
    </Screen>
  );
}
