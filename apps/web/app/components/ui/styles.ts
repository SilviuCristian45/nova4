// Class recipes shared by client components and by server pages that render links or native controls.

import { cx, toneBorder, toneSoft, toneText, type Tone } from "./tone";

export type ButtonVariant = "primary" | "secondary" | "outline" | "soft" | "danger";

const variantClass: Record<Exclude<ButtonVariant, "soft">, string> = {
  primary: "bg-lime text-on-solid border-transparent hover:bg-lime-hover",
  secondary: "bg-control text-foreground border-card-border hover:bg-inner hover:border-card-border-strong",
  outline: "bg-transparent text-foreground border-card-border-strong hover:bg-inner",
  danger: "bg-red text-white border-transparent hover:opacity-90",
};

// Tactile architectural button: crisp 12px radius, real desktop hover states, subtle active press.
export function buttonClass({ variant = "primary", tone = "lime", large, small, className }: {
  variant?: ButtonVariant; tone?: Tone; large?: boolean; small?: boolean; className?: string;
} = {}) {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded-md border font-semibold tracking-[-0.01em] transition-[background-color,border-color,color,opacity,transform] duration-150 active:scale-[0.985]",
    "disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45",
    large ? "min-h-[52px] px-6 text-[15.5px]" : small ? "min-h-9 px-3.5 text-[13px]" : "min-h-[44px] px-4.5 text-[14px]",
    variant === "soft" ? cx(toneSoft[tone], toneBorder[tone], "hover:opacity-90") : variantClass[variant],
    className,
  );
}

// Round/squircle icon button. `plain` drops the fill; a tone gives it a soft accent fill.
export function iconButtonClass({ tone, plain, className }: { tone?: Tone; plain?: boolean; className?: string } = {}) {
  return cx(
    "inline-flex size-10 shrink-0 items-center justify-center rounded-md border transition-colors active:opacity-70 disabled:opacity-30",
    plain
      ? cx("border-transparent bg-transparent hover:bg-inner", tone ? toneText[tone] : "text-soft hover:text-foreground")
      : tone
        ? cx(toneSoft[tone], toneBorder[tone], "hover:opacity-90")
        : "border-card-border bg-control text-soft hover:bg-inner hover:text-foreground",
    className,
  );
}

// Filled input with crisp hairline border and focused elevation. `big` is the bold centred variant for weight and reps.
// `compact` narrows the side padding for the small number fields of the set form.
export function inputClass({ big, center, compact, className }: { big?: boolean; center?: boolean; compact?: boolean; className?: string } = {}) {
  return cx(
    "min-h-[46px] w-full min-w-0 rounded-md border border-card-border bg-inner text-foreground outline-none",
    compact ? "px-1" : "px-3.5",
    "transition-colors hover:border-card-border-strong focus:border-lime focus:bg-card focus-visible:outline-none disabled:opacity-50",
    big ? "text-[17px] font-bold" : "text-[14.5px]",
    (big || center) && "text-center font-bold tabular-nums",
    className,
  );
}
