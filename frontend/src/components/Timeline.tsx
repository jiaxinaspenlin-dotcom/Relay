import type { TimelineItem } from "../api";
import { copy } from "../copy";

const STAGE_LABEL: Record<string, string> = {
  sent: "Sent", accepted: "Accepted", scheduled: "Scheduled", no_show: "No-show", seen: "Seen",
  plan_returned: "Plan returned", closed: "Closed", declined: "Declined",
  patient_barrier: "Patient barrier", cancelled: "Cancelled",
};

export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="space-y-2 border-l border-slate-200 pl-4 text-sm" data-testid="timeline">
      {items.map((t, i) => (
        <li key={i} data-kind={t.kind}>
          <span className="font-mono text-xs text-slate-500">{t.at}</span>{" "}
          {t.kind === "event" ? (
            <>
              <span className="font-medium">{STAGE_LABEL[t.stage!] ?? t.stage}</span>{" "}
              <span className="text-slate-600">
                ({t.actor}{t.source ? `, ${copy.detail.via} ${t.source}` : ""})
              </span>
              {t.note && <span className="block text-slate-700">{t.note}</span>}
            </>
          ) : (
            <>
              <span className="font-medium">{copy.detail.communication} {t.recipient}</span>
              {t.edited && <span className="text-xs text-slate-500"> · {copy.detail.edited}</span>}
              <pre className="mt-1 whitespace-pre-wrap rounded bg-slate-50 p-2 font-sans text-slate-800">{t.text}</pre>
            </>
          )}
        </li>
      ))}
    </ol>
  );
}
