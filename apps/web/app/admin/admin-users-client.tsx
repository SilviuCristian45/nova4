"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Ban,
  Camera,
  Check,
  CheckCircle2,
  Copy,
  Dumbbell,
  KeyRound,
  Pencil,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  Utensils,
  X,
} from "lucide-react";
import type { UserRole, WeightUnit } from "@replog/shared";
import { useLanguage } from "@/app/components/language-provider";
import {
  Badge,
  BigNumber,
  Button,
  Card,
  CardTitle,
  Empty,
  Field,
  IconButton,
  Inner,
  Input,
  Message,
  Screen,
  Segmented,
} from "@/app/components/ui";
import { clientApi } from "@/lib/api/client";
import { ApiError, type ApiAdminUser, type ApiAdminUserListResponse } from "@/lib/api/types";

type StatusFilter = "all" | "active" | "disabled";
type RoleFilter = "all" | "client" | "coach";

function generateRandomPassword(length = 14): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%*";
  const bytes = new Uint8Array(length);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function formatDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

export function AdminUsersClient({
  initialData,
  currentUserId,
}: {
  initialData: ApiAdminUserListResponse;
  currentUserId: string;
}) {
  const { t, locale } = useLanguage();
  const [data, setData] = useState<ApiAdminUserListResponse>(initialData);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "lime" | "red"; text: string } | null>(null);

  // Create modal state
  const createDialogRef = useRef<HTMLDialogElement>(null);
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createName, setCreateName] = useState("");
  const [createRole, setCreateRole] = useState<UserRole>("client");
  const [createUnit, setCreateUnit] = useState<WeightUnit>("kg");
  const [createSteps, setCreateSteps] = useState("10000");
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit modal state
  const editDialogRef = useRef<HTMLDialogElement>(null);
  const [editTarget, setEditTarget] = useState<ApiAdminUser | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<UserRole>("client");
  const [editUnit, setEditUnit] = useState<WeightUnit>("kg");
  const [editSteps, setEditSteps] = useState("10000");
  const [editError, setEditError] = useState<string | null>(null);

  // Reset password modal state
  const resetDialogRef = useRef<HTMLDialogElement>(null);
  const [resetTarget, setResetTarget] = useState<ApiAdminUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [copiedPassword, setCopiedPassword] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  // Delete confirmation modal state
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiAdminUser | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Close dialogs on backdrop click (matches Select primitive behavior).
  useEffect(() => {
    const refs = [createDialogRef, editDialogRef, resetDialogRef, deleteDialogRef];
    const cleanups: (() => void)[] = [];
    for (const ref of refs) {
      const el = ref.current;
      if (!el) continue;
      const onClick = (event: MouseEvent) => {
        if (event.target === el) el.close();
      };
      el.addEventListener("click", onClick);
      cleanups.push(() => el.removeEventListener("click", onClick));
    }
    return () => cleanups.forEach((fn) => fn());
  }, []);

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.items.filter((item) => {
      if (statusFilter === "active" && item.disabled) return false;
      if (statusFilter === "disabled" && !item.disabled) return false;
      if (roleFilter !== "all" && item.role !== roleFilter) return false;
      if (needle) {
        const hitEmail = item.email.toLowerCase().includes(needle);
        const hitName = (item.displayName ?? "").toLowerCase().includes(needle);
        if (!hitEmail && !hitName) return false;
      }
      return true;
    });
  }, [data.items, query, statusFilter, roleFilter]);

  async function reloadUsers() {
    setRefreshing(true);
    try {
      const fresh = await clientApi<ApiAdminUserListResponse>("/admin/users");
      setData(fresh);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("Nu s-au putut încărca utilizatorii.", "Could not load users.");
      setFeedback({ tone: "red", text: msg });
    } finally {
      setRefreshing(false);
    }
  }

  function openCreateDialog() {
    setCreateEmail("");
    setCreatePassword(generateRandomPassword());
    setCreateName("");
    setCreateRole("client");
    setCreateUnit("kg");
    setCreateSteps("10000");
    setCreateError(null);
    setCopiedPassword(false);
    createDialogRef.current?.showModal();
  }

  async function handleCreateUser() {
    setCreateError(null);
    const stepsNum = Number(createSteps);
    if (!createEmail.trim()) {
      setCreateError(t("Adresa de email este obligatorie.", "Email address is required."));
      return;
    }
    if (createPassword.length < 8) {
      setCreateError(t("Parola trebuie să aibă minim 8 caractere.", "Password must be at least 8 characters."));
      return;
    }
    if (!Number.isInteger(stepsNum) || stepsNum < 1 || stepsNum > 200000) {
      setCreateError(t("Ținta de pași trebuie să fie un număr între 1 și 200000.", "Steps goal must be between 1 and 200000."));
      return;
    }

    try {
      const created = await clientApi<ApiAdminUser>("/admin/users", {
        method: "POST",
        body: {
          email: createEmail.trim(),
          password: createPassword,
          displayName: createName.trim() || null,
          role: createRole,
          weightUnit: createUnit,
          dailyStepsGoal: stepsNum,
        },
      });
      createDialogRef.current?.close();
      setFeedback({
        tone: "lime",
        text: t(`Contul ${created.email} a fost creat.`, `Account ${created.email} was created.`),
      });
      await reloadUsers();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : t("Crearea contului a eșuat.", "Failed to create account."));
    }
  }

  function openEditDialog(user: ApiAdminUser) {
    setEditTarget(user);
    setEditEmail(user.email);
    setEditName(user.displayName ?? "");
    setEditRole(user.role);
    setEditUnit(user.weightUnit);
    setEditSteps(String(user.dailyStepsGoal));
    setEditError(null);
    editDialogRef.current?.showModal();
  }

  async function handleEditUser() {
    if (!editTarget) return;
    setEditError(null);
    const stepsNum = Number(editSteps);
    if (!editEmail.trim()) {
      setEditError(t("Adresa de email este obligatorie.", "Email address is required."));
      return;
    }
    if (!Number.isInteger(stepsNum) || stepsNum < 1 || stepsNum > 200000) {
      setEditError(t("Ținta de pași trebuie să fie între 1 și 200000.", "Steps goal must be between 1 and 200000."));
      return;
    }

    try {
      const updated = await clientApi<ApiAdminUser>(`/admin/users/${editTarget.id}`, {
        method: "PATCH",
        body: {
          email: editEmail.trim(),
          displayName: editName.trim() || null,
          role: editRole,
          weightUnit: editUnit,
          dailyStepsGoal: stepsNum,
        },
      });
      editDialogRef.current?.close();
      setFeedback({
        tone: "lime",
        text: t(`Contul ${updated.email} a fost actualizat.`, `Account ${updated.email} was updated.`),
      });
      await reloadUsers();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : t("Actualizarea a eșuat.", "Failed to update account."));
    }
  }

  async function handleToggleStatus(user: ApiAdminUser) {
    setFeedback(null);
    const nextDisabled = !user.disabled;
    try {
      await clientApi<ApiAdminUser>(`/admin/users/${user.id}/status`, {
        method: "PATCH",
        body: { disabled: nextDisabled },
      });
      setFeedback({
        tone: "lime",
        text: nextDisabled
          ? t(
              `Contul ${user.email} a fost dezactivat și toate sesiunile active au fost revocate.`,
              `Account ${user.email} was disabled and all active sessions were revoked.`,
            )
          : t(`Contul ${user.email} a fost reactivat.`, `Account ${user.email} was re-enabled.`),
      });
      await reloadUsers();
    } catch (err) {
      setFeedback({
        tone: "red",
        text: err instanceof ApiError ? err.message : t("Schimbarea statusului a eșuat.", "Status update failed."),
      });
    }
  }

  function openResetDialog(user: ApiAdminUser) {
    setResetTarget(user);
    setNewPassword(generateRandomPassword());
    setCopiedPassword(false);
    setResetError(null);
    resetDialogRef.current?.showModal();
  }

  async function handleResetPassword() {
    if (!resetTarget) return;
    setResetError(null);
    if (newPassword.length < 8) {
      setResetError(t("Parola nouă trebuie să aibă minim 8 caractere.", "New password must be at least 8 characters."));
      return;
    }
    try {
      await clientApi(`/admin/users/${resetTarget.id}/reset-password`, {
        method: "POST",
        body: { newPassword },
      });
      resetDialogRef.current?.close();
      setFeedback({
        tone: "lime",
        text: t(
          `Parola pentru ${resetTarget.email} a fost resetată și sesiunile active au fost revocate.`,
          `Password for ${resetTarget.email} was reset and active sessions were revoked.`,
        ),
      });
    } catch (err) {
      setResetError(err instanceof ApiError ? err.message : t("Resetarea parolei a eșuat.", "Password reset failed."));
    }
  }

  function openDeleteDialog(user: ApiAdminUser) {
    setDeleteTarget(user);
    setDeleteConfirmText("");
    setDeleteError(null);
    deleteDialogRef.current?.showModal();
  }

  async function handleDeleteUser() {
    if (!deleteTarget) return;
    setDeleteError(null);
    if (deleteConfirmText.trim().toLowerCase() !== deleteTarget.email.trim().toLowerCase()) {
      setDeleteError(
        t("Introdu exact adresa de email a contului pentru confirmare.", "Type the account's exact email to confirm."),
      );
      return;
    }
    try {
      await clientApi(`/admin/users/${deleteTarget.id}`, { method: "DELETE" });
      deleteDialogRef.current?.close();
      setFeedback({
        tone: "lime",
        text: t(
          `Contul ${deleteTarget.email} și toate datele/pozele asociate au fost șterse permanent.`,
          `Account ${deleteTarget.email} and all associated data/photos were permanently deleted.`,
        ),
      });
      await reloadUsers();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : t("Ștergerea contului a eșuat.", "Failed to delete account."));
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPassword(true);
      setTimeout(() => setCopiedPassword(false), 2000);
    } catch {
      // Clipboard unavailable in insecure context
    }
  }

  return (
    <Screen
      title={t("Administrare utilizatori", "User administration")}
      back="/"
      right={
        <div className="flex items-center gap-2">
          <IconButton
            icon={RefreshCw}
            label={t("Reîncarcă", "Refresh")}
            onClick={() => void reloadUsers()}
            disabled={refreshing}
          />
          <Button small icon={UserPlus} onClick={openCreateDialog}>
            {t("Utilizator nou", "New user")}
          </Button>
        </div>
      }
    >
      {/* Summary KPI cards — filled surfaces, RepLog BigNumber & semantic Badges */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Card>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-muted">{t("Total conturi", "Total accounts")}</span>
            <Badge tone="ice">
              <Users className="mr-1 size-3" />
              {t("Toți", "All")}
            </Badge>
          </div>
          <BigNumber value={data.stats.total} />
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-muted">{t("Activi", "Active")}</span>
            <Badge tone="lime">{t("Activi", "Active")}</Badge>
          </div>
          <BigNumber value={data.stats.active} />
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-muted">{t("Dezactivați", "Disabled")}</span>
            <Badge tone="red">{t("Blocați", "Disabled")}</Badge>
          </div>
          <BigNumber value={data.stats.disabled} />
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-muted">{t("Antrenori", "Coaches")}</span>
            <Badge tone="lilac">{t("Coach", "Coach")}</Badge>
          </div>
          <BigNumber value={data.stats.coaches} unit={`/ ${data.stats.clients} ${t("clienți", "clients")}`} />
        </Card>
      </div>

      {feedback && <Message tone={feedback.tone}>{feedback.text}</Message>}

      {/* Search & Filters Card */}
      <Card>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12 lg:items-center">
          <div className="flex items-center gap-2 lg:col-span-5">
            <Search className="size-4 shrink-0 text-muted" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Caută după email sau nume...", "Search by email or name...")}
            />
          </div>
          <div className="lg:col-span-4">
            <Segmented<StatusFilter>
              inCard
              label={t("Filtru status", "Status filter")}
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "all", label: t("Toți", "All") },
                { value: "active", label: t("Activi", "Active") },
                { value: "disabled", label: t("Dezactivați", "Disabled") },
              ]}
            />
          </div>
          <div className="lg:col-span-3">
            <Segmented<RoleFilter>
              inCard
              label={t("Filtru rol", "Role filter")}
              value={roleFilter}
              onChange={setRoleFilter}
              options={[
                { value: "all", label: t("Toți", "All") },
                { value: "client", label: t("Clienți", "Clients") },
                { value: "coach", label: t("Antrenori", "Coaches") },
              ]}
            />
          </div>
        </div>
      </Card>

      {/* Users list */}
      {filteredItems.length === 0 ? (
        <Empty icon={Users} tone="lilac">
          {t("Nu a fost găsit niciun utilizator pentru filtrele selectate.", "No users match the selected filters.")}
        </Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredItems.map((user) => {
            const isSelf = user.id === currentUserId;
            return (
              <Card key={user.id}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[17px] font-semibold">
                        {user.displayName?.trim() || user.email}
                      </span>
                      {user.isSuperAdmin && (
                        <Badge tone="lilac">
                          <Shield className="mr-1 size-3" />
                          Super Admin
                        </Badge>
                      )}
                      {isSelf && <Badge>{t("Tu", "You")}</Badge>}
                      <Badge tone={user.role === "coach" ? "gold" : "ice"}>
                        {user.role === "coach" ? t("Antrenor", "Coach") : t("Client", "Client")}
                      </Badge>
                      <Badge tone={user.disabled ? "red" : "lime"}>
                        {user.disabled ? t("Dezactivat", "Disabled") : t("Activ", "Active")}
                      </Badge>
                    </div>

                    <p className="truncate text-sm text-soft">{user.email}</p>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                      <span>
                        {t("Creat:", "Created:")} <strong className="font-medium text-soft">{formatDate(user.createdAt, locale)}</strong>
                      </span>
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Dumbbell className="size-3.5 text-lime-text" />
                        {user.workoutsCount} {t("antr.", "workouts")}
                      </span>
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Utensils className="size-3.5 text-coral-text" />
                        {user.mealsCount} {t("mese", "meals")}
                      </span>
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Camera className="size-3.5 text-ice-text" />
                        {user.photosCount} {t("poze", "photos")}
                      </span>
                      <span className="tabular-nums">
                        {user.weightUnit.toUpperCase()} · {user.dailyStepsGoal.toLocaleString(locale)} {t("pași/zi", "steps/day")}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="secondary" small icon={Pencil} onClick={() => openEditDialog(user)}>
                      {t("Editează", "Edit")}
                    </Button>
                    <Button
                      variant="soft"
                      tone="gold"
                      small
                      icon={KeyRound}
                      onClick={() => openResetDialog(user)}
                    >
                      {t("Parolă", "Password")}
                    </Button>
                    <Button
                      variant="soft"
                      tone={user.disabled ? "lime" : "coral"}
                      small
                      icon={user.disabled ? CheckCircle2 : Ban}
                      disabled={isSelf && !user.disabled}
                      title={
                        isSelf && !user.disabled
                          ? t("Nu îți poți dezactiva propriul cont de Super Admin", "You cannot disable your own Super Admin account")
                          : undefined
                      }
                      onClick={() => handleToggleStatus(user)}
                    >
                      {user.disabled ? t("Activează", "Enable") : t("Dezactivează", "Disable")}
                    </Button>
                    <Button
                      variant="soft"
                      tone="red"
                      small
                      icon={Trash2}
                      disabled={isSelf}
                      title={
                        isSelf
                          ? t("Nu îți poți șterge propriul cont de Super Admin", "You cannot delete your own Super Admin account")
                          : undefined
                      }
                      onClick={() => openDeleteDialog(user)}
                    >
                      {t("Șterge", "Delete")}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* CREATE USER DIALOG */}
      <dialog
        ref={createDialogRef}
        className="fixed inset-x-0 bottom-0 top-auto m-0 mx-auto hidden max-h-[90vh] w-full max-w-lg flex-col rounded-t-xl bg-background p-0 text-foreground backdrop:bg-[#000000a6] open:flex sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2 sm:rounded-xl"
      >
        <div className="flex items-center gap-2 p-5 pb-3">
          <h2 className="flex-1 text-[20px] font-bold tracking-[-0.4px]">
            {t("Creează utilizator nou", "Create new user")}
          </h2>
          <IconButton icon={X} label={t("Închide", "Close")} onClick={() => createDialogRef.current?.close()} />
        </div>
        <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-5 pb-6">
          {createError && <Message tone="red">{createError}</Message>}

          <Field label="Email" htmlFor="admin-create-email">
            <Input
              id="admin-create-email"
              type="email"
              value={createEmail}
              onChange={(e) => setCreateEmail(e.target.value)}
              placeholder="user@example.com"
            />
          </Field>

          <Field label={t("Parolă inițială (minim 8 caractere)", "Initial password (min 8 chars)")} htmlFor="admin-create-password">
            <div className="flex items-center gap-2">
              <Input
                id="admin-create-password"
                type="text"
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
              />
              <IconButton
                icon={Sparkles}
                tone="lime"
                label={t("Generează parolă", "Generate password")}
                onClick={() => setCreatePassword(generateRandomPassword())}
              />
              <IconButton
                icon={copiedPassword ? Check : Copy}
                label={t("Copiază parola", "Copy password")}
                onClick={() => void copyToClipboard(createPassword)}
              />
            </div>
          </Field>

          <Field label={t("Nume afișat (opțional)", "Display name (optional)")} htmlFor="admin-create-name">
            <Input
              id="admin-create-name"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder={t("ex. Andrei Popescu", "e.g. Alex Smith")}
            />
          </Field>

          <Field label={t("Rol", "Role")}>
            <Segmented<UserRole>
              value={createRole}
              onChange={setCreateRole}
              options={[
                { value: "client", label: t("Client", "Client") },
                { value: "coach", label: t("Antrenor", "Coach") },
              ]}
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("Unitate greutate", "Weight unit")}>
              <Segmented<WeightUnit>
                value={createUnit}
                onChange={setCreateUnit}
                options={[
                  { value: "kg", label: "kg" },
                  { value: "lb", label: "lb" },
                ]}
              />
            </Field>
            <Field label={t("Țintă pași/zi", "Daily steps goal")} htmlFor="admin-create-steps">
              <Input
                id="admin-create-steps"
                type="number"
                min={1}
                max={200000}
                value={createSteps}
                onChange={(e) => setCreateSteps(e.target.value)}
              />
            </Field>
          </div>

          <div className="mt-2 flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => createDialogRef.current?.close()}>
              {t("Anulează", "Cancel")}
            </Button>
            <Button icon={UserPlus} onClick={handleCreateUser}>
              {t("Creează cont", "Create account")}
            </Button>
          </div>
        </div>
      </dialog>

      {/* EDIT USER DIALOG */}
      <dialog
        ref={editDialogRef}
        className="fixed inset-x-0 bottom-0 top-auto m-0 mx-auto hidden max-h-[90vh] w-full max-w-lg flex-col rounded-t-xl bg-background p-0 text-foreground backdrop:bg-[#000000a6] open:flex sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2 sm:rounded-xl"
      >
        <div className="flex items-center gap-2 p-5 pb-3">
          <h2 className="flex-1 text-[20px] font-bold tracking-[-0.4px]">
            {t("Editează utilizator", "Edit user")}
          </h2>
          <IconButton icon={X} label={t("Închide", "Close")} onClick={() => editDialogRef.current?.close()} />
        </div>
        <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-5 pb-6">
          {editError && <Message tone="red">{editError}</Message>}

          <Field label="Email" htmlFor="admin-edit-email">
            <Input
              id="admin-edit-email"
              type="email"
              value={editEmail}
              onChange={(e) => setEditEmail(e.target.value)}
            />
          </Field>

          <Field label={t("Nume afișat", "Display name")} htmlFor="admin-edit-name">
            <Input
              id="admin-edit-name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
            />
          </Field>

          <Field label={t("Rol", "Role")}>
            <Segmented<UserRole>
              value={editRole}
              onChange={setEditRole}
              options={[
                { value: "client", label: t("Client", "Client") },
                { value: "coach", label: t("Antrenor", "Coach") },
              ]}
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("Unitate greutate", "Weight unit")}>
              <Segmented<WeightUnit>
                value={editUnit}
                onChange={setEditUnit}
                options={[
                  { value: "kg", label: "kg" },
                  { value: "lb", label: "lb" },
                ]}
              />
            </Field>
            <Field label={t("Țintă pași/zi", "Daily steps goal")} htmlFor="admin-edit-steps">
              <Input
                id="admin-edit-steps"
                type="number"
                min={1}
                max={200000}
                value={editSteps}
                onChange={(e) => setEditSteps(e.target.value)}
              />
            </Field>
          </div>

          <div className="mt-2 flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => editDialogRef.current?.close()}>
              {t("Anulează", "Cancel")}
            </Button>
            <Button onClick={handleEditUser}>{t("Salvează modificările", "Save changes")}</Button>
          </div>
        </div>
      </dialog>

      {/* RESET PASSWORD DIALOG */}
      <dialog
        ref={resetDialogRef}
        className="fixed inset-x-0 bottom-0 top-auto m-0 mx-auto hidden max-h-[90vh] w-full max-w-lg flex-col rounded-t-xl bg-background p-0 text-foreground backdrop:bg-[#000000a6] open:flex sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2 sm:rounded-xl"
      >
        <div className="flex items-center gap-2 p-5 pb-3">
          <h2 className="flex-1 text-[20px] font-bold tracking-[-0.4px]">
            {t("Resetează parola", "Reset password")}
          </h2>
          <IconButton icon={X} label={t("Închide", "Close")} onClick={() => resetDialogRef.current?.close()} />
        </div>
        <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-5 pb-6">
          {resetError && <Message tone="red">{resetError}</Message>}

          <Inner>
            <span className="text-xs text-muted">{t("Cont vizat", "Target account")}</span>
            <strong className="text-sm">{resetTarget?.email}</strong>
            <span className="text-xs text-soft">
              {t(
                "Toate sesiunile active ale utilizatorului vor fi revocate imediat.",
                "All active sessions for this user will be immediately revoked.",
              )}
            </span>
          </Inner>

          <Field label={t("Parolă nouă (minim 8 caractere)", "New password (min 8 chars)")} htmlFor="admin-reset-password">
            <div className="flex items-center gap-2">
              <Input
                id="admin-reset-password"
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <IconButton
                icon={Sparkles}
                tone="lime"
                label={t("Generează parolă", "Generate password")}
                onClick={() => setNewPassword(generateRandomPassword())}
              />
              <IconButton
                icon={copiedPassword ? Check : Copy}
                label={t("Copiază parola", "Copy password")}
                onClick={() => void copyToClipboard(newPassword)}
              />
            </div>
          </Field>

          <div className="mt-2 flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => resetDialogRef.current?.close()}>
              {t("Anulează", "Cancel")}
            </Button>
            <Button icon={KeyRound} onClick={handleResetPassword}>
              {t("Resetează parola", "Reset password")}
            </Button>
          </div>
        </div>
      </dialog>

      {/* DELETE USER DIALOG */}
      <dialog
        ref={deleteDialogRef}
        className="fixed inset-x-0 bottom-0 top-auto m-0 mx-auto hidden max-h-[90vh] w-full max-w-lg flex-col rounded-t-xl bg-background p-0 text-foreground backdrop:bg-[#000000a6] open:flex sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2 sm:rounded-xl"
      >
        <div className="flex items-center gap-2 p-5 pb-3">
          <h2 className="flex-1 text-[20px] font-bold tracking-[-0.4px] text-red-text">
            {t("Șterge definitiv contul", "Permanently delete account")}
          </h2>
          <IconButton icon={X} label={t("Închide", "Close")} onClick={() => deleteDialogRef.current?.close()} />
        </div>
        <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-5 pb-6">
          {deleteError && <Message tone="red">{deleteError}</Message>}

          <Card tone="red">
            <CardTitle
              description={t(
                "Această acțiune este ireversibilă. Va șterge pozele din S3/MinIO, conexiunea Google Drive și toate datele contului (antrenamente, mese, metrici, coaching).",
                "This action cannot be undone. It will permanently delete stored S3/MinIO photos, Google Drive link, and all account data (workouts, meals, metrics, coaching).",
              )}
            >
              {deleteTarget?.email}
            </CardTitle>
          </Card>

          <Field
            label={t("Tastează email-ul utilizatorului pentru confirmare", "Type the user's email to confirm")}
            htmlFor="admin-delete-confirm"
          >
            <Input
              id="admin-delete-confirm"
              type="email"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={deleteTarget?.email ?? ""}
            />
          </Field>

          <div className="mt-2 flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => deleteDialogRef.current?.close()}>
              {t("Anulează", "Cancel")}
            </Button>
            <Button variant="danger" icon={Trash2} onClick={handleDeleteUser}>
              {t("Șterge definitiv", "Delete permanently")}
            </Button>
          </div>
        </div>
      </dialog>
    </Screen>
  );
}
