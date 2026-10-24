import type { TimelineItem } from "../api";
import { copy } from "../copy";
import { shortDate } from "../format";

// Date column, what happened, and where it came from (muted): fax, office link, email, AI call.
export function Timeline({ items }: { items: TimelineItem[] }) {
  const t = copy.timeline;
  return (
    <ol className="space-y-5" data-testid="timeline">
      {[...items].reverse().map((it, i) => {
        let what: string;
        let from: string;
        if (it.kind === "event") {
          what = it.event_kind === "stage" || !it.event_kind ? t.stage[it.stage!] ?? it.stage! : it.note ?? "";
          if (it.event_kind === "stage" && it.note) what = `${what}. ${it.note}`;
          from = [t.actor[it.actor!] ?? it.actor, it.source ? t.source[it.source] ?? it.source : ""].filter(Boolean).join(", ");
        } else {
          what = t.sent[it.message_kind ?? "follow_up"];
          from = t.channel[it.channel ?? "manual"];
        }
        return (
          <li key={i} data-kind={it.kind} className="grid grid-cols-[4.5rem_1fr] gap-3">
            <span className="text-caption text-muted">{shortDate(it.at)}</span>
            <div className="min-w-0">
              <div className="font-semibold">{what}</div>
              <div className="text-caption text-muted" data-testid="event-meta">{from}{it.edited ? `. ${t.edited}` : ""}</div>
              {it.kind === "communication" && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-caption text-hemlock">Show message</summary>
                  <pre className="mt-1 whitespace-pre-wrap rounded-control bg-paper p-3 font-sans text-caption">{it.text}</pre>
                </details>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
