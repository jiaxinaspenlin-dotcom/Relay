import type { TimelineItem } from "../api";
import { copy } from "../copy";
import { shortDate } from "../format";

const STAGE_LABEL: Record<string, string> = {
  sent: "Sent", accepted: "Accepted", scheduled: "Scheduled", no_show: "No-show", seen: "Seen",
  plan_returned: "Plan returned", closed: "Closed", declined: "Declined",
  patient_barrier: "Patient barrier", cancelled: "Cancelled",
};

// Events and messages, newest first: date, actor, and how the update arrived.
export function Timeline({ items }: { items: TimelineItem[] }) {
  const d = copy.detail;
  return (
    <ol className="space-y-4" data-testid="timeline">
      {[...items].reverse().map((t, i) => (
        <li key={i} data-kind={t.kind} className="grid grid-cols-[4rem_1fr] gap-3">
          <span className="text-caption text-muted">{shortDate(t.at)}</span>
          {t.kind === "event" ? (
            <div>
              <div className="font-semibold">{STAGE_LABEL[t.stage!] ?? t.stage}</div>
              <div className="text-caption text-muted" data-testid="event-meta">
                {d.actor[t.actor!] ?? t.actor}{t.source ? `, ${d.source_[t.source] ?? t.source}` : ""}
              </div>
              {t.note && <div className="mt-0.5">{t.note}</div>}
            </div>
          ) : (
            <div>
              <div className="font-semibold">
                {t.message_kind === "referral" ? "Referral sent to" : "Follow-up sent to"} {d.sentTo[t.recipient!] ?? t.recipient}, {d.channel[t.channel ?? "manual"]}
              </div>
              {t.edited && <div className="text-caption text-muted">{d.edited}</div>}
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-control bg-paper p-2 font-sans text-caption">{t.text}</pre>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
