import { copy } from "../copy";

/** Skeleton rows while data loads (no spinners). `rows` gray bars inside a white panel. */
export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="rounded-panel border border-line bg-surface" data-testid="skeleton">
      <span className="sr-only">{copy.loading}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden="true" className="flex items-center gap-6 border-b border-line px-6 py-4 last:border-b-0">
          <div className="w-1/4 space-y-2">
            <div className="skeleton h-4 w-3/4 rounded-control" />
            <div className="skeleton h-3 w-1/2 rounded-control" />
          </div>
          <div className="skeleton h-3 flex-1 rounded-control" />
          <div className="skeleton h-10 w-24 rounded-control" />
        </div>
      ))}
    </div>
  );
}

// Errors say what happened and what to do, inline, without apology (design.md).
export function ErrorNote({ error }: { error: unknown }) {
  const msg = (error instanceof Error ? error.message : String(error)).replace(/\.\s*$/, "");
  return (
    <p role="alert" className="rounded-control border border-rust/30 bg-surface px-3 py-2 text-caption text-rust">
      {copy.errorPrefix} {msg}. {copy.errorNext}
    </p>
  );
}
