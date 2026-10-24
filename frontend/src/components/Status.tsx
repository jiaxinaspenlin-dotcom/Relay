import { copy } from "../copy";

export function Loading() {
  return <p role="status" className="py-6 text-muted">{copy.loading}</p>;
}

// Errors say what happened and what to do, without apology (design.md).
export function ErrorNote({ error }: { error: unknown }) {
  const msg = (error instanceof Error ? error.message : String(error)).replace(/\.\s*$/, "");
  return (
    <p role="alert" className="rounded-control border border-rust/30 bg-rust-tint px-3 py-2 text-caption text-rust">
      {copy.errorPrefix} {msg}. {copy.errorNext}
    </p>
  );
}
