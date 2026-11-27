import Link from "next/link";
import {
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  ClipboardList,
  Plus,
  Target,
  Utensils,
} from "lucide-react";
import { Text } from "@/app/components/language-provider";
import { getLanguage } from "@/app/language";
import { localDate } from "@/lib/daily-metrics";
import { getSessionUser, serverApi } from "@/lib/api/server";
import { getUserTargets } from "./action";
import { Badge, Card, Eyebrow, ProgressBar, Screen, TextLink, buttonClass, cx } from "@/app/components/ui";

export const dynamic = "force-dynamic";

interface ApiMeal {
  id: string;
  items: {
    totalKcal: number;
    totalProteinG: number;
    totalCarbsG: number;
    totalFatG: number;
  }[];
}

interface ApiMealPlan {
  id: string;
  title: string;
  targetKcal: number | null;
  coachName: string;
}

export default async function MealsHubPage() {
  const { t, locale } = await getLanguage();
  const user = await getSessionUser();

  let kcal = 0;
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  let mealCount = 0;
  let goal = 0;
  let goalProtein = 0;
  let goalCarbs = 0;
  let goalFat = 0;
  let activePlan: { id: string; title: string; target_kcal: number | null; coachName: string } | null = null;

  if (user) {
    const [meals, targets, mealPlans] = await Promise.all([
      serverApi<ApiMeal[]>(`/meals?date=${encodeURIComponent(localDate())}`).catch(() => []),
      getUserTargets(),
      serverApi<ApiMealPlan[]>("/meals/plan").catch(() => []),
    ]);
    for (const meal of meals) {
      for (const item of meal.items ?? []) {
        kcal += Number(item.totalKcal) || 0;
        protein += Number(item.totalProteinG) || 0;
        carbs += Number(item.totalCarbsG) || 0;
        fat += Number(item.totalFatG) || 0;
      }
    }
    kcal = Math.round(kcal);
    protein = Math.round(protein);
    carbs = Math.round(carbs);
    fat = Math.round(fat);
    mealCount = meals.length;
    goal = Number(targets.targets?.kcal) || 0;
    goalProtein = Number(targets.targets?.protein) || 0;
    goalCarbs = Number(targets.targets?.carbs) || 0;
    goalFat = Number(targets.targets?.fat) || 0;

    const firstPlan = mealPlans[0];
    if (firstPlan) {
      activePlan = {
        id: firstPlan.id,
        title: firstPlan.title,
        target_kcal: firstPlan.targetKcal ?? null,
        coachName: firstPlan.coachName?.trim() || t("Antrenor", "Coach"),
      };
    }
  }

  const over = goal > 0 && kcal > goal;
  const remaining = goal > 0 ? Math.abs(goal - kcal) : 0;
  const kcalPct = goal > 0 ? Math.min(100, Math.round((kcal / goal) * 100)) : 0;

  const macroCards = [
    {
      label: t("Proteine", "Protein"),
      value: protein,
      target: goalProtein,
      tone: "coral" as const,
      dot: "bg-coral",
    },
    {
      label: t("Carbohidrați", "Carbs"),
      value: carbs,
      target: goalCarbs,
      tone: "ice" as const,
      dot: "bg-ice",
    },
    {
      label: t("Grăsimi", "Fat"),
      value: fat,
      target: goalFat,
      tone: "gold" as const,
      dot: "bg-gold",
    },
  ];

  const navTiles = [
    {
      href: "/meals/history",
      icon: CalendarDays,
      tone: "lime" as const,
      title: t("Istoric mese", "Meal history"),
      subtitle: t("Jurnalul tău alimentar zilnic", "Your daily food diary"),
    },
    {
      href: "/meals/progress",
      icon: BarChart3,
      tone: "ice" as const,
      title: t("Statistici & macro", "Stats & macros"),
      subtitle: t("Tendințe calorii și macronutrienți", "Calorie and macro trends"),
    },
    {
      href: "/meals/progress/targets",
      icon: Target,
      tone: "coral" as const,
      title: t("Obiective & TDEE", "Targets & TDEE"),
      subtitle: t("Calorii și macro zilnice adaptive", "Adaptive daily macro targets"),
    },
    {
      href: "/meals/plan",
      icon: ClipboardList,
      tone: "lilac" as const,
      title: t("Plan alimentar", "Meal plan"),
      subtitle: t("Planul de la antrenor & export PDF", "Coach meal plan & PDF export"),
    },
  ];

  return (
    <Screen
      title={<Text ro="Nutriție" en="Nutrition" />}
      right={
        <Link href="/meals/insert" className={buttonClass({ small: true })}>
          <Plus className="size-4" strokeWidth={2.4} />
          <Text ro="Adaugă masă" en="Add meal" />
        </Link>
      }
    >
      {/* Hero Fuel Instrument Card */}
      <Card className="relative overflow-hidden">
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3.5px] bg-lime" />
        <div className="flex flex-wrap items-center justify-between gap-2 pl-1">
          <div className="flex items-center gap-2">
            <Eyebrow>{t("Calorii & macro azi", "Today's fuel")}</Eyebrow>
            <Badge>
              {mealCount}{" "}
              {t(mealCount === 1 ? "masă" : "mese", mealCount === 1 ? "meal" : "meals")}
            </Badge>
          </div>
          <TextLink href="/meals/progress">{t("Analiză completă", "Full analytics")}</TextLink>
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-3 pl-1">
          <p className="flex flex-wrap items-baseline gap-x-2.5">
            <span className="text-[40px] font-bold leading-none tracking-[-0.04em] tabular-nums sm:text-[44px]">
              {kcal.toLocaleString(locale)}
            </span>
            <span className="font-mono text-[13.5px] font-medium text-muted tabular-nums">
              {goal ? `/ ${goal.toLocaleString(locale)} kcal` : "kcal"}
            </span>
          </p>
          {goal > 0 && (
            <span className={cx("font-mono text-[12px] font-semibold tabular-nums", over ? "text-red-text" : "text-lime-text")}>
              {over
                ? `+${remaining.toLocaleString(locale)} kcal ${t("peste", "over")}`
                : `${remaining.toLocaleString(locale)} kcal ${t("rămase", "left")}`}
            </span>
          )}
        </div>

        {goal > 0 && (
          <div className="pl-1">
            <ProgressBar value={kcalPct} tone={over ? "red" : "lime"} />
          </div>
        )}

        <div className="grid grid-cols-1 gap-2.5 pl-1 pt-1 sm:grid-cols-3">
          {macroCards.map((macro) => {
            const pct = macro.target > 0 ? Math.min(100, Math.round((macro.value / macro.target) * 100)) : 0;
            return (
              <div key={macro.label} className="flex flex-col gap-2 rounded-md border border-card-border bg-inner p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted">
                    <span className={cx("size-2 rounded-full", macro.dot)} />
                    {macro.label}
                  </span>
                  {macro.target > 0 && (
                    <span className="font-mono text-[10.5px] text-muted tabular-nums">{pct}%</span>
                  )}
                </div>
                <p className="flex items-baseline gap-1 font-mono tabular-nums">
                  <span className="text-[20px] font-bold tracking-[-0.02em] text-foreground">{macro.value}g</span>
                  {macro.target > 0 && <span className="text-[12px] text-muted">/ {macro.target}g</span>}
                </p>
                {macro.target > 0 && <ProgressBar value={pct} tone={macro.tone} />}
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-card-border pl-1 pt-3.5">
          <Link href="/meals/insert" className={buttonClass()}>
            <Plus className="size-4" strokeWidth={2.4} />
            <Text ro="Înregistrează o masă" en="Log a meal" />
          </Link>
          <Link href="/meals/history" className={buttonClass({ variant: "secondary" })}>
            <Text ro="Vezi mesele de azi" en="View today's log" />
            <ArrowUpRight className="size-4 text-muted" />
          </Link>
        </div>
      </Card>

      {activePlan && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.09em] text-lime-text">
                <Utensils className="size-3.5" />
                <Text ro="Plan alimentar activ" en="Active meal plan" />
              </span>
              <h2 className="text-[19px] font-bold tracking-[-0.02em]">{activePlan.title}</h2>
              <p className="text-[12.5px] text-muted">
                {t("Antrenor", "Coach")}: <span className="font-medium text-soft">{activePlan.coachName}</span>
              </p>
            </div>
            {activePlan.target_kcal !== null && <Badge tone="lime">{activePlan.target_kcal} kcal</Badge>}
          </div>
          <Link href="/meals/plan" className={buttonClass({ variant: "secondary", small: true, className: "w-fit" })}>
            <Utensils className="size-3.5" />
            <Text ro="Deschide planul & Export PDF" en="Open meal plan & PDF export" />
          </Link>
        </Card>
      )}

      {/* 4-Tile Quick Navigation Grid */}
      <section aria-label={t("Secțiuni nutriție", "Nutrition sections")} className="flex flex-col gap-3">
        <Eyebrow>{t("Instrumente nutriție", "Nutrition tools")}</Eyebrow>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {navTiles.map((tile) => {
            const Icon = tile.icon;
            const tint =
              tile.tone === "lime"
                ? "bg-lime-soft text-lime-text border-lime-border"
                : tile.tone === "coral"
                  ? "bg-coral-soft text-coral-text border-coral-border"
                  : tile.tone === "ice"
                    ? "bg-ice-soft text-ice-text border-ice-border"
                    : "bg-lilac-soft text-lilac-text border-lilac-border";
            return (
              <Link
                key={tile.href}
                href={tile.href}
                className="surface-card group flex flex-col gap-3 rounded-lg border border-card-border bg-card p-4 transition-colors hover:border-card-border-strong hover:bg-inner/40 active:scale-[0.99]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cx("flex size-9 items-center justify-center rounded-md border", tint)}>
                    <Icon className="size-4" strokeWidth={2} />
                  </span>
                  <ArrowUpRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[14.5px] font-semibold tracking-[-0.01em] text-foreground">{tile.title}</span>
                  <span className="text-[12px] text-muted">{tile.subtitle}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </Screen>
  );
}
