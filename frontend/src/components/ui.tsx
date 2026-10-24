import type { ButtonHTMLAttributes, ReactNode } from "react";
import { copy, stageColors } from "../copy";

// Calm operations-tool primitives: white surfaces, one accent, monospace numbers.

type Variant = "primary" | "secondary" | "quiet" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent/90 disabled:bg-slate-300",
  secondary: "border border-slate-300 bg-white text-slate-800 hover:border-accent hover:text-accent disabled:text-slate-400",
  quiet: "text-accent underline-offset-2 hover:underline disabled:text-slate-400",
  danger: "border border-rose-300 bg-white text-rose-800 hover:bg-rose-50",
};

export function Button({ variant = "secondary", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...rest}
    />
  );
}

export function Panel({ title, children, actions, id, className = "" }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; id?: string; className?: string }) {
  return (
    <section aria-labelledby={id} className={`rounded-lg border border-slate-200 bg-white p-4 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 id={id} className="text-sm font-semibold uppercase tracking-wide text-slate-600">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function StageBadge({ stage, label }: { stage: string; label: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${stageColors[stage] ?? "bg-slate-100"}`}>
      {label}
    </span>
  );
}

export function SampleTag({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0 text-[11px] font-medium uppercase tracking-wide text-amber-900">
      {copy.sampleTag}
    </span>
  );
}

export function Num({ children }: { children: ReactNode }) {
  return <span className="font-mono tabular-nums">{children}</span>;
}

export const inputCls =
  "mt-1 block w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm text-slate-700">
      {label}
      {children}
      {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
