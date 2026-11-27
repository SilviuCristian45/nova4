import { cx } from "./ui/tone";

// Minimal geometric RepLog mark: ascending rep bars inside a precision rounded tile.
export function BrandMark({ size = "md", className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  const box = size === "sm" ? "size-7 rounded-[8px]" : size === "lg" ? "size-11 rounded-[12px]" : "size-8 rounded-[9px]";
  const svg = size === "sm" ? "size-4" : size === "lg" ? "size-6" : "size-[18px]";
  return (
    <span
      aria-hidden="true"
      className={cx("inline-flex shrink-0 items-center justify-center bg-lime text-on-solid", box, className)}
    >
      <svg viewBox="0 0 24 24" fill="none" className={svg}>
        <rect x="3.5" y="13.5" width="4" height="7" rx="1.2" fill="currentColor" opacity="0.45" />
        <rect x="10" y="9" width="4" height="11.5" rx="1.2" fill="currentColor" opacity="0.75" />
        <rect x="16.5" y="3.5" width="4" height="17" rx="1.2" fill="currentColor" />
      </svg>
    </span>
  );
}
