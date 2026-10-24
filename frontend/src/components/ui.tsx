import { cloneElement, useId, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from "react";
import { copy } from "../copy";

// Primitives from .kiro/steering/design.md: white surfaces, one hemlock accent, 1px borders,
// no shadows, 8px controls, 12px panels, 40px targets, sentence case.

// Button: primary (filled hemlock), secondary (outlined), quiet (text). 40px high, 8px radius.
// "outline" is the old name for secondary and renders the same.
type Variant = "primary" | "secondary" | "outline" | "quiet" | "danger";
const variants: Record<Variant, string> = {
  primary: "rounded-control bg-hemlock px-4 text-white hover:bg-[#184d4a] disabled:bg-line disabled:text-muted",
  secondary: "rounded-control border border-hemlock bg-surface px-4 text-hemlock hover:bg-hemlock-tint disabled:border-line disabled:text-muted",
  outline: "",
  quiet: "rounded-control px-1 text-hemlock underline-offset-2 hover:underline disabled:text-muted",
  danger: "rounded-control border border-rust bg-surface px-4 text-rust hover:bg-rust-tint",
};
variants.outline = variants.secondary;

export const btn = (variant: Variant = "secondary", extra = "") =>
  `inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap text-body font-semibold transition-colors disabled:cursor-not-allowed ${variants[variant]} ${extra}`;

export function Button({ variant = "secondary", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" className={btn(variant, className)} {...rest} />;
}

/** White card: 1px line border, 12px radius. The only panel style. */
export function Panel({ title, children, actions, id, className = "", testid }: {
  title?: ReactNode; children: ReactNode; actions?: ReactNode; id?: string; className?: string; testid?: string;
}) {
  return (
    <section aria-labelledby={title ? id : undefined} data-testid={testid}
      className={`rounded-panel border border-line bg-surface p-6 max-[859px]:p-4 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 id={id} className="text-body font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** Small inline label that sits after a name ("Sample"). The one tag style used everywhere. */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center self-center rounded-[6px] border border-[#DDE3E0] bg-[#F6F8F7] px-[8px] py-[2px] align-middle text-[12px] font-normal leading-[16px] text-muted">
      {children}
    </span>
  );
}

export function SampleTag({ show }: { show: boolean }) {
  return show ? <Tag>{copy.sampleTag}</Tag> : null;
}

/** White pill with a 1px border (route, coverage, authorization). */
export function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-flex h-8 items-center rounded-full border border-line bg-surface px-3 text-caption text-ink">{children}</span>;
}

export type Tone = "rust" | "amber" | "hemlock" | "muted";
const TONE: Record<Tone, string> = { rust: "text-rust font-semibold", amber: "text-amber font-semibold", hemlock: "text-hemlock font-semibold", muted: "text-muted" };

/** Status text: one line, colored by tone (rust = challenge failure, amber = stuck, muted = on track). */
export function StatusText({ tone, children, className = "", testid }: { tone: Tone; children: ReactNode; className?: string; testid?: string }) {
  return <p data-testid={testid} className={`${TONE[tone]} ${className}`}>{children}</p>;
}

export const inputCls =
  "mt-1 block min-h-[40px] w-full rounded-control border border-line bg-surface px-3 py-2 text-body text-ink focus:border-hemlock focus:outline-none";

// Explicit label/for pairing: a <label> wrapping a <select> would fold the selected option into
// the accessible name.
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

/** Wordmark glyph: filled dot, short line, ring dot. */
export function RouteGlyph({ color = "#FFFFFF" }: { color?: string }) {
  return (
    <svg width="24" height="10" viewBox="0 0 24 10" aria-hidden="true" className="inline-block">
      <circle cx="4" cy="5" r="3.5" fill={color} />
      <line x1="8" y1="5" x2="15" y2="5" stroke={color} strokeWidth="2" />
      <circle cx="19.5" cy="5" r="3" fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/20" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-xl overflow-y-auto border-l border-line bg-surface p-8"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-section font-bold">{title}</h2>
          <Button variant="quiet" onClick={onClose}>{copy.drawer.close}</Button>
        </div>
        {children}
      </div>
    </div>
  );
}
