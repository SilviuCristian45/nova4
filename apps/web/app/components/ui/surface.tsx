// Server-safe building blocks: architectural surfaces with hairline borders, telemetry eyebrows, crisp tabular numerals.

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, ChevronRight, type LucideIcon } from "lucide-react";
import { Text } from "@/app/components/language-provider";
import { cx, toneBorder, toneSoft, toneText, type Tone } from "./tone";

// Shared page width inside the App Shell: balanced reading & bento measure across phones, tablets, and desktops.
export const pageWidth = "mx-auto w-full max-w-xl md:max-w-3xl lg:max-w-5xl";

// Page frame: optional back arrow + tight display title, then the content column. The dashboard passes `back={false}`.
export function Screen({ title, back = "/", right, children, className }: {
  title?: ReactNode; back?: string | false; right?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <main className={cx(pageWidth, "flex flex-col gap-5 px-4 py-5 pb-12 text-foreground sm:px-6 lg:gap-6 lg:px-8 lg:py-8", className)}>
      {(title || back) && (
        <header className="flex items-center gap-2.5 border-b border-card-border pb-4">
          {back && (
            <Link
              href={back}
              className="flex size-9 shrink-0 items-center justify-center rounded-md border border-card-border bg-card text-soft transition-colors hover:bg-inner hover:text-foreground active:opacity-70"
            >
              <ArrowLeft className="size-4" />
              <span className="sr-only"><Text ro="Înapoi" en="Back" /></span>
            </Link>
          )}
          {title ? <h1 className="min-w-0 flex-1 text-[24px] font-bold leading-tight tracking-[-0.03em] sm:text-[26px]">{title}</h1> : <div className="flex-1" />}
          {right}
        </header>
      )}
      {children}
    </main>
  );
}

// Responsive grid for cards: one column on phones, `two` from md, `three` from lg (default: same as `two`).
// `top` aligns items to the top so cards of different heights don't stretch.
export function Columns({ children, className, three, top = true }: { children: ReactNode; className?: string; three?: boolean; top?: boolean }) {
  return (
    <div className={cx("grid grid-cols-1 gap-4 md:grid-cols-2 lg:gap-5", three && "lg:grid-cols-3", top && "items-start", className)}>
      {children}
    </div>
  );
}

// A vertical stack of cards: one column of a `Columns` grid.
export function Stack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("flex min-w-0 flex-col gap-4 lg:gap-5", className)}>{children}</div>;
}

export function Card({ children, tone, padded = true, className, ...rest }: ComponentProps<"section"> & { tone?: Tone; padded?: boolean }) {
  return (
    <section {...rest} className={cx(
      "surface-card flex flex-col gap-3.5 rounded-lg border",
      tone ? cx(toneSoft[tone], toneBorder[tone]) : "border-card-border bg-card",
      padded ? "p-5" : "gap-0 overflow-hidden",
      className,
    )}>
      {children}
    </section>
  );
}

export function Inner({ children, className, ...rest }: ComponentProps<"div">) {
  return <div {...rest} className={cx("flex flex-col gap-2 rounded-md border border-card-border bg-inner p-3.5", className)}>{children}</div>;
}

export function Label({ children, className, ...rest }: ComponentProps<"label">) {
  return <label {...rest} className={cx("pl-0.5 text-[12.5px] font-medium text-muted", className)}>{children}</label>;
}

// Mono uppercase telemetry eyebrow used on dashboard instruments and section headers.
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx("font-mono text-[10.5px] font-semibold uppercase tracking-[0.09em] text-muted", className)}>
      {children}
    </span>
  );
}

// Section title inside a card (settings and similar), with an optional description.
export function CardTitle({ children, description }: { children: ReactNode; description?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-foreground">{children}</h2>
      {description && <p className="text-[13px] text-soft">{description}</p>}
    </div>
  );
}

export function Field({ label, htmlFor, children, className }: { label: ReactNode; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

export function Badge({ children, tone, className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={cx(
      "inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 font-mono text-[10.5px] font-semibold tracking-[0.02em]",
      tone ? cx(toneSoft[tone], toneBorder[tone]) : "border-card-border bg-control text-soft",
      className,
    )}>
      {children}
    </span>
  );
}

export function Message({ children, tone = "red", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <div role={tone === "red" ? "alert" : "status"} className={cx("rounded-md border p-3.5 text-[13.5px] font-medium", toneSoft[tone], toneBorder[tone], className)}>
      {children}
    </div>
  );
}

const barFill: Record<Tone, string> = {
  lime: "bg-lime", coral: "bg-coral", ice: "bg-ice", lilac: "bg-lilac", gold: "bg-gold", red: "bg-red",
};

export function ProgressBar({ value, tone = "lime", className }: { value: number; tone?: Tone; className?: string }) {
  const width = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div className={cx("h-1.5 overflow-hidden rounded-full bg-inner", className)}>
      <div className={cx("h-full rounded-full transition-[width] duration-500", barFill[tone])} style={{ width: `${width}%` }} />
    </div>
  );
}

export function Empty({ icon: Icon, children, tone = "lime" }: { icon: LucideIcon; children: ReactNode; tone?: Tone }) {
  return (
    <div className="surface-card flex flex-col items-center gap-3 rounded-lg border border-card-border bg-card px-5 py-12 text-center">
      <span className={cx("flex size-12 items-center justify-center rounded-md border", toneSoft[tone], toneBorder[tone])}>
        <Icon className={cx("size-5", toneText[tone])} strokeWidth={1.85} />
      </span>
      <p className="max-w-xs text-sm font-medium text-muted">{children}</p>
    </div>
  );
}

// Quiet text link inside a card ("Chart ›").
export function TextLink({ href, children, tone = "lime", className }: { href: string; children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <Link href={href} className={cx("group inline-flex items-center gap-0.5 text-[13px] font-semibold transition-opacity hover:opacity-80 active:opacity-60", toneText[tone], className)}>
      {children}
      <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

// Refined architectural primary call-to-action card (used on Nutrition, Coach, Gym hubs).
export function CtaCard({ href, label, title }: { href: string; label: ReactNode; title: ReactNode }) {
  return (
    <Link
      href={href}
      className="surface-card group relative flex min-h-[112px] items-center justify-between gap-4 overflow-hidden rounded-lg border border-card-border bg-card p-5 transition-colors hover:border-lime-border active:scale-[0.99]"
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3.5px] bg-lime" />
      <div className="flex min-w-0 flex-col gap-1 pl-1">
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.09em] text-lime-text">
          {label}
        </span>
        <span className="text-[22px] font-bold leading-tight tracking-[-0.03em] text-foreground sm:text-[24px]">
          {title}
        </span>
      </div>
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-lime text-on-solid transition-transform duration-150 group-hover:scale-105">
        <ArrowUpRight className="size-5 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" strokeWidth={2.25} />
      </span>
    </Link>
  );
}

// One card holding a list of navigation rows separated by hairlines.
export function LinkList({ items }: { items: { href: string; title: ReactNode; subtitle?: ReactNode; icon?: LucideIcon }[] }) {
  return (
    <Card padded={false}>
      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <div key={item.href}>
            {index > 0 && <div className="mx-5 h-px bg-line" />}
            <Link
              href={item.href}
              className="group flex items-center gap-3.5 px-5 py-3.5 transition-colors hover:bg-inner/70 active:bg-inner"
            >
              {Icon && (
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-card-border bg-inner text-soft transition-colors group-hover:text-foreground">
                  <Icon className="size-4" />
                </span>
              )}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">{item.title}</span>
                {item.subtitle && <span className="text-[12.5px] text-muted">{item.subtitle}</span>}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
            </Link>
          </div>
        );
      })}
    </Card>
  );
}

// Big bold number followed by a muted unit or goal, aligned on the baseline.
export function BigNumber({ value, unit, className }: { value: ReactNode; unit?: ReactNode; className?: string }) {
  return (
    <p className={cx("flex flex-wrap items-baseline gap-x-2", className)}>
      <span className="text-[36px] font-bold leading-none tracking-[-0.04em] tabular-nums sm:text-[40px]">{value}</span>
      {unit && <span className="font-mono text-[13px] font-medium text-muted tabular-nums">{unit}</span>}
    </p>
  );
}
