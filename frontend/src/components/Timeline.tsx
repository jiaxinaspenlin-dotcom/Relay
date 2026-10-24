import type { TimelineItem } from "../api";
import { copy } from "../copy";
import { shortDate } from "../format";

// Date column, what happened (with the person who did it), and where it came from in muted text:
// "Sent by Sam Ortiz", "Closed by Dr. Avery Lin", "Office link", "AI call by Sam Ortiz".
function describe(it: TimelineItem): { what: string; meta: string } {
  const t = copy.timeline;
  if (it.kind === "communication") {
    const channel = t.channel[it.channel ?? "manual"];
    return { what: t.sent[it.message_kind ?? "follow_up"], meta: it.sent_by ? `${channel} by ${it.sent_by}` : channel };
  }
  const what = it.event_kind === "stage" || !it.event_kind ? t.stage[it.stage!] ?? it.stage! : it.note ?? "";
  const note = it.event_kind === "stage" || !it.event_kind ? it.note ?? "" : "";
  if (it.source === "link") return { what, meta: [t.officeLink, note].filter(Boolean).join(". ") };
  if (it.source === "ai_call") return { what, meta: [t.by("AI call", it.by || "coordinator"), note].filter(Boolean).join(". ") };
  if (it.by && it.source) return { what, meta: [t.by(`${cap(t.source[it.source] ?? it.source)}, logged`, it.by), note].filter(Boolean).join(". ") };
  if (it.by) return { what: t.by(what, it.by), meta: note };
  const who = t.actor[it.actor!] ?? it.actor ?? "";
  return { what, meta: [[who, it.source ? t.source[it.source] ?? it.source : ""].filter(Boolean).join(", "), note].filter(Boolean).join(". ") };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="space-y-5" data-testid="timeline">
      {[...items].reverse().map((it, i) => {
        const { what, meta } = describe(it);
        return (
          <li key={i} data-kind={it.kind} className="grid grid-cols-[4.5rem_1fr] gap-3">
            <span className="text-caption text-muted">{shortDate(it.at)}</span>
            <div className="min-w-0">
              <div className="font-semibold" data-testid="event-title">{what}</div>
              {(meta || it.edited) && (
                <div className="text-caption text-muted" data-testid="event-meta">{meta}{it.edited ? `${meta ? ". " : ""}${copy.timeline.edited}` : ""}</div>
              )}
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
