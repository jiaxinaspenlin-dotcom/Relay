import type { TimelineItem } from "../api";
import { copy } from "../copy";
import { shortDate } from "../format";

// Each entry: date, a title for what happened ("Received", "AI call", "Referral sent"), and one
// compact muted subtitle joined with " · ":
// "AI call by Sam Ortiz, 2:33 · Missing: insurance authorization · Scheduling: Mon–Fri 8–4 · 413-555-0142".
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function describe(it: TimelineItem): { title: string; subtitle: string } {
  const t = copy.timeline;
  const join = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" · ");
  if (it.kind === "communication") {
    const channel = t.channel[it.channel ?? "manual"];
    return { title: t.sent[it.message_kind ?? "follow_up"], subtitle: join(cap(it.sent_by ? t.by(channel, it.sent_by) : channel), it.edited && t.edited) };
  }
  const stageEvent = it.event_kind === "stage" || !it.event_kind;
  const title = stageEvent ? t.stage[it.stage!] ?? it.stage! : t.kind[it.event_kind!] ?? cap(it.event_kind!);
  const note = it.note ?? "";
  let who: string;
  if (it.source === "link") who = t.officeLink;
  else if (it.source === "ai_call") who = t.by("AI call", it.by || "coordinator") + (it.call_duration ? `, ${it.call_duration}` : "");
  else if (it.by && it.source) who = t.by(`${cap(t.source[it.source] ?? it.source)}, logged`, it.by);
  else if (it.by) who = t.byPerson(it.by);
  else who = [t.actor[it.actor!] ?? it.actor ?? "", it.source ? t.source[it.source] ?? it.source : ""].filter(Boolean).join(", ");
  return { title, subtitle: join(who, note) };
}

export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="space-y-4" data-testid="timeline">
      {[...items].reverse().map((it, i) => {
        const { title, subtitle } = describe(it);
        return (
          <li key={i} data-kind={it.kind} className="grid grid-cols-[64px_1fr] gap-3">
            <span className="pt-px text-caption text-muted">{shortDate(it.at)}</span>
            <div className="min-w-0">
              <div className="font-semibold" data-testid="event-title">{title}</div>
              {subtitle && <div className="text-caption text-muted" data-testid="event-meta">{subtitle}</div>}
              {it.kind === "communication" && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-caption text-hemlock">{copy.timeline.showMessage}</summary>
                  <pre className="mt-1 whitespace-pre-wrap rounded-control border border-line bg-surface p-3 font-sans text-caption">{it.text}</pre>
                </details>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
