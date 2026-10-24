import { copy } from "../copy";

export function Loading() {
  return <p role="status" className="p-6 text-slate-600">{copy.loading}</p>;
}

export function ErrorNote({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <p role="alert" className="rounded bg-rose-50 p-2 text-sm text-rose-900">
      {copy.errorPrefix} {msg}
    </p>
  );
}
