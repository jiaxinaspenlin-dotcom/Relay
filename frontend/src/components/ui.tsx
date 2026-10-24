import { cloneElement, useId, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from "react";
import { copy } from "../copy";

// Quiet primitives from .kiro/steering/design.md: white surfaces, one hemlock accent,
// borders not shadows, 6px controls, 10px panels, 40px hit targets, sentence case.

type Variant = "primary" | "outline" | "quiet" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-hemlock text-white hover:bg-[#184d4a] disabled:bg-line disabled:text-muted",
  outline: "border border-hemlock bg-surface text-hemlock hover:bg-hemlock-tint disabled:border-line disabled:text-muted",
  quiet: "text-hemlock underline-offset-2 hover:underline disabled:text-muted",
  danger: "border border-rust bg-surface text-rust hover:bg-rust-tint",
};

export function Button({ variant = "outline", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex min-h-[40px] items-center justify-center gap-1 rounded-control px-4 text-body font-semibold transition-colors disabled:cursor-not-allowed ${variant === "quiet" ? "px-1" : ""} ${variants[variant]} ${className}`}
      {...rest}
    />
  );
}

export function Panel({ title, children, actions, id, className = "" }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; id?: string; className?: string }) {
  return (
    <section aria-labelledby={title ? id : undefined} className={`rounded-panel border border-line bg-surface p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 id={id} className="text-section font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function SampleTag({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="rounded-control border border-line bg-paper px-1.5 text-caption text-muted">{copy.sampleTag}</span>;
}

export function Chip({ children, tone = "amber" }: { children: ReactNode; tone?: "amber" | "rust" | "plain" }) {
  const cls = tone === "rust" ? "bg-rust-tint text-rust" : tone === "amber" ? "bg-amber-tint text-amber" : "bg-paper text-muted";
  return <span className={`inline-flex items-center rounded-control px-2 py-0.5 text-caption font-semibold ${cls}`}>{children}</span>;
}

export const inputCls =
  "mt-1 block min-h-[40px] w-full rounded-control border border-line bg-surface px-3 py-2 text-body text-ink focus:border-hemlock focus:outline-none";

// Explicit label/for pairing. A <label> that wraps a <select> folds the selected option's text
// into the accessible name ("Specialty Cardiology"), so the control gets its own id instead.
export function Field({ label, children, hint }: { label: string; children: ReactElement<{ id?: string; "aria-describedby"?: string }>; hint?: string }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="block text-body text-ink">
      <label htmlFor={id} className="font-semibold">{label}</label>
      {cloneElement(children, { id, ...(hint ? { "aria-describedby": hintId } : {}) })}
      {hint && <span id={hintId} className="mt-1 block text-caption text-muted">{hint}</span>}
    </div>
  );
}

export function Muted({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`text-caption text-muted ${className}`}>{children}</span>;
}

/** Route glyph for the wordmark: two dots joined by a line. */
export function RouteGlyph() {
  return (
    <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true" className="inline-block">
      <line x1="4" y1="5" x2="18" y2="5" stroke="#1F5F5B" strokeWidth="2" />
      <circle cx="4" cy="5" r="3.5" fill="#1F5F5B" />
      <circle cx="18" cy="5" r="3" fill="#FFFFFF" stroke="#1F5F5B" strokeWidth="2" />
    </svg>
  );
}
