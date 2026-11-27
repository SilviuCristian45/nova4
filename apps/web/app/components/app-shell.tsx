"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Award,
  BookOpen,
  Building2,
  CalendarDays,
  Camera,
  Compass,
  Dumbbell,
  LayoutGrid,
  Plus,
  QrCode,
  Settings,
  Shield,
  Target,
  TrendingUp,
  Trophy,
  Utensils,
  type LucideIcon,
} from "lucide-react";
import { BrandMark } from "./brand-mark";
import { LanguageSelector, useLanguage } from "./language-provider";
import { NotificationBell } from "./notification-bell";
import { OfflineStatus } from "./offline-status";
import { SignOutButton } from "./sign-out-button";
import { ThemeToggle } from "./theme-toggle";
import { cx } from "./ui/tone";

const STANDALONE_PATHS = ["/login", "/register", "/offline", "/privacy", "/plan"];

interface NavItem {
  href: string;
  labelRo: string;
  labelEn: string;
  icon: LucideIcon;
  match?: (pathname: string) => boolean;
  dot?: "lime" | "coral" | "lilac";
}

const TRAINING_NAV: NavItem[] = [
  { href: "/", labelRo: "Acasă", labelEn: "Overview", icon: LayoutGrid, match: (p) => p === "/" },
  {
    href: "/history",
    labelRo: "Antrenamente",
    labelEn: "Workouts",
    icon: Dumbbell,
    match: (p) => p === "/history" || p.startsWith("/edit/"),
  },
  { href: "/exercises", labelRo: "Exerciții", labelEn: "Exercises", icon: BookOpen },
  { href: "/stats", labelRo: "Progres", labelEn: "Progress", icon: TrendingUp },
  { href: "/records", labelRo: "Recorduri", labelEn: "Records", icon: Trophy },
  { href: "/photos", labelRo: "Poze progres", labelEn: "Photos", icon: Camera },
];

const NUTRITION_NAV: NavItem[] = [
  { href: "/meals", labelRo: "Nutriție", labelEn: "Nutrition", icon: Utensils, match: (p) => p === "/meals" || p === "/meals/insert" || p === "/meals/plan" },
  { href: "/meals/history", labelRo: "Jurnal mese", labelEn: "Food log", icon: CalendarDays },
  { href: "/meals/progress/targets", labelRo: "Obiective", labelEn: "Targets", icon: Target, match: (p) => p.startsWith("/meals/progress") },
];

const WORKSPACE_BASE_NAV: NavItem[] = [
  { href: "/explore", labelRo: "Programe", labelEn: "Programs", icon: Compass },
  { href: "/gym", labelRo: "Sală & QR", labelEn: "Gym & QR", icon: QrCode, match: (p) => p === "/gym" || p === "/gym/scan" },
];

const dotColor = {
  lime: "bg-lime",
  coral: "bg-coral",
  lilac: "bg-lilac",
} as const;

export interface AppShellProps {
  signedIn: boolean;
  userName?: string | null;
  userEmail?: string | null;
  isCoach?: boolean;
  hasGymStaff?: boolean;
  isSuperAdmin?: boolean;
  initialUnread: number;
  children: ReactNode;
}

function isRouteActive(pathname: string, item: NavItem): boolean {
  if (item.match) return item.match(pathname);
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function initialsFrom(name?: string | null, email?: string | null): string {
  const src = (name?.trim() || email?.trim() || "R").replace(/@.*/, "");
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

export function AppShell({
  signedIn,
  userName,
  userEmail,
  isCoach = false,
  hasGymStaff = false,
  isSuperAdmin = false,
  initialUnread,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const { t } = useLanguage();

  const isStandalone =
    !signedIn ||
    STANDALONE_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  if (isStandalone) {
    return (
      <div className="flex min-h-dvh flex-col">
        <div className="no-print mx-auto flex w-full max-w-5xl items-center justify-between gap-2 px-5 pt-4 lg:px-8">
          <Link href="/" className="inline-flex items-center gap-2.5 text-foreground transition-opacity hover:opacity-80">
            <BrandMark size="sm" />
            <span className="text-[16px] font-bold tracking-[-0.03em]">RepLog</span>
          </Link>
          <div className="flex items-center gap-1.5">
            <LanguageSelector compact />
            <ThemeToggle compact />
          </div>
        </div>
        <OfflineStatus />
        <div className="flex flex-1 flex-col">{children}</div>
      </div>
    );
  }

  const workspaceNav: NavItem[] = [
    ...WORKSPACE_BASE_NAV,
    ...(isCoach ? [{ href: "/coach", labelRo: "Studio Antrenor", labelEn: "Coach Studio", icon: Award, dot: "lime" as const }] : []),
    ...(hasGymStaff ? [{ href: "/gym/manage", labelRo: "Recepție Sală", labelEn: "Gym Desk", icon: Building2, dot: "coral" as const }] : []),
    ...(isSuperAdmin ? [{ href: "/admin", labelRo: "Admin", labelEn: "Admin", icon: Shield, dot: "lilac" as const }] : []),
  ];

  const mobileTabs: Array<{ href: string; labelRo: string; labelEn: string; icon: LucideIcon; primary?: boolean; match: (p: string) => boolean }> = [
    { href: "/", labelRo: "Acasă", labelEn: "Home", icon: LayoutGrid, match: (p) => p === "/" },
    { href: "/history", labelRo: "Sesiuni", labelEn: "Workouts", icon: Dumbbell, match: (p) => p === "/history" || p.startsWith("/edit/") || p === "/exercises" || p === "/records" },
    { href: "/insert", labelRo: "Log", labelEn: "Log", icon: Plus, primary: true, match: (p) => p === "/insert" },
    { href: "/meals", labelRo: "Nutriție", labelEn: "Meals", icon: Utensils, match: (p) => p.startsWith("/meals") },
    { href: "/stats", labelRo: "Progres", labelEn: "Progress", icon: TrendingUp, match: (p) => p === "/stats" || p === "/photos" || p === "/checkin/weekly" },
  ];

  const displayLabel = userName?.trim() || userEmail?.split("@")[0] || "RepLog";

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* Desktop persistent left sidebar */}
      <aside className="no-print hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-[244px] lg:shrink-0 lg:flex-col lg:border-r lg:border-card-border lg:bg-card">
        <div className="flex h-16 items-center justify-between border-b border-card-border px-4">
          <Link href="/" className="inline-flex items-center gap-2.5 text-foreground transition-opacity hover:opacity-85">
            <BrandMark />
            <span className="text-[17px] font-bold tracking-[-0.03em]">RepLog</span>
          </Link>
          <span className="rounded-sm bg-inner px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
            OS
          </span>
        </div>

        <div className="px-3 pt-3.5 pb-1">
          <Link
            href="/insert"
            className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-lime px-3.5 text-[13.5px] font-semibold text-on-solid transition-colors hover:bg-lime-hover active:scale-[0.985]"
          >
            <Plus className="size-4" strokeWidth={2.4} />
            <span>{t("Antrenament nou", "Log workout")}</span>
          </Link>
        </div>

        <nav aria-label={t("Navigare principală", "Primary navigation")} className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-3.5">
          <SidebarGroup label={t("Antrenament", "Training")} items={TRAINING_NAV} pathname={pathname} t={t} />
          <SidebarGroup label={t("Nutriție", "Nutrition")} items={NUTRITION_NAV} pathname={pathname} t={t} />
          <SidebarGroup label={t("Spațiu", "Workspace")} items={workspaceNav} pathname={pathname} t={t} />
        </nav>

        <div className="flex flex-col gap-2 border-t border-card-border p-3">
          <Link
            href="/settings"
            className={cx(
              "group flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors hover:bg-inner",
              pathname === "/settings" && "bg-inner",
            )}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-card-border bg-inner font-mono text-[11px] font-bold text-foreground">
              {initialsFrom(userName, userEmail)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] font-semibold leading-tight text-foreground">{displayLabel}</span>
              {userEmail && <span className="truncate text-[11px] text-muted">{userEmail}</span>}
            </span>
            <Settings className="size-4 shrink-0 text-muted transition-colors group-hover:text-foreground" />
          </Link>

          <div className="flex items-center justify-between gap-1 px-0.5">
            <div className="flex items-center gap-1">
              <NotificationBell initialUnread={initialUnread} compact />
              <ThemeToggle compact />
              <LanguageSelector compact />
            </div>
            <SignOutButton compact />
          </div>
        </div>
      </aside>

      {/* Mobile & tablet sticky top chrome */}
      <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between border-b border-card-border bg-surface-glass px-4 backdrop-blur-xl lg:hidden">
        <Link href="/" className="inline-flex items-center gap-2 text-foreground">
          <BrandMark size="sm" />
          <span className="text-[16px] font-bold tracking-[-0.03em]">RepLog</span>
        </Link>
        <div className="flex items-center gap-1">
          <NotificationBell initialUnread={initialUnread} compact />
          <LanguageSelector compact />
          <ThemeToggle compact />
          <Link
            href="/settings"
            aria-label={t("Setări", "Settings")}
            title={t("Setări", "Settings")}
            className={cx(
              "inline-flex size-9 shrink-0 items-center justify-center rounded-md text-soft transition-colors hover:bg-control hover:text-foreground",
              pathname === "/settings" && "bg-control text-foreground",
            )}
          >
            <Settings className="size-[18px]" />
          </Link>
        </div>
      </header>

      {/* Main page canvas */}
      <div className="flex min-w-0 flex-1 flex-col pb-24 lg:pb-0">
        <OfflineStatus />
        {children}
      </div>

      {/* Mobile bottom tab bar */}
      <nav
        aria-label={t("Navigare mobilă", "Mobile navigation")}
        className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-card-border bg-nav-glass backdrop-blur-xl lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto grid h-16 max-w-lg grid-cols-5 items-center px-1.5">
          {mobileTabs.map((tab) => {
            const active = tab.match(pathname);
            const Icon = tab.icon;
            if (tab.primary) {
              return (
                <div key={tab.href} className="flex items-center justify-center">
                  <Link
                    href={tab.href}
                    aria-label={t("Antrenament nou", "Start workout")}
                    className="flex size-11 items-center justify-center rounded-full bg-lime text-on-solid transition-transform hover:bg-lime-hover active:scale-95"
                  >
                    <Icon className="size-5" strokeWidth={2.5} />
                  </Link>
                </div>
              );
            }
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "relative flex h-full flex-col items-center justify-center gap-1 transition-colors",
                  active ? "text-foreground" : "text-muted hover:text-soft",
                )}
              >
                {active && <span className="absolute top-0 h-[2.5px] w-6 rounded-b-full bg-lime" />}
                <Icon className={cx("size-[19px]", active && "text-lime-text")} strokeWidth={active ? 2.2 : 1.8} />
                <span className={cx("text-[10.5px] leading-none", active ? "font-semibold" : "font-medium")}>
                  {t(tab.labelRo, tab.labelEn)}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function SidebarGroup({
  label,
  items,
  pathname,
  t,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
  t: (ro: string, en: string) => string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="px-2.5 pb-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.09em] text-muted">
        {label}
      </p>
      {items.map((item) => {
        const active = isRouteActive(pathname, item);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] transition-colors",
              active
                ? "bg-inner font-semibold text-foreground"
                : "font-medium text-soft hover:bg-inner/70 hover:text-foreground",
            )}
          >
            {active && (
              <span
                aria-hidden="true"
                className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-lime"
              />
            )}
            <Icon
              className={cx(
                "size-[17px] shrink-0 transition-colors",
                active ? "text-lime-text" : "text-muted group-hover:text-foreground",
              )}
              strokeWidth={active ? 2.1 : 1.85}
            />
            <span className="min-w-0 flex-1 truncate">{t(item.labelRo, item.labelEn)}</span>
            {item.dot && <span className={cx("size-1.5 shrink-0 rounded-full", dotColor[item.dot])} />}
          </Link>
        );
      })}
    </div>
  );
}
