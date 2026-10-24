import type { TimelineItem } from "../api";
import { copy } from "../copy";
import { Num } from "./ui";

const STAGE_LABEL: Record<string, string> = {
  sent: "Sent", accepted: "Accepted", scheduled: "Scheduled", no_show: "No-show", seen: "Seen",
  plan_returned: "Plan returned", closed: "Closed", declined: "Declined",
  patient_barrier: "Patient barrier", cancelled: "Cancelled",
};
const RECIPIENT: Record<string, string> = { specialist: "office", patient: "patient", pcp: "PCP" };

export function Timeline({ items }: { items: TimelineItem[] }) {
  const d = copy.detail;
  return (
    <ol className="relative space-y-3 border-l-2 border-slate-200 pl-4 text-sm" data-testid="timeline">
      {[...items].reverse().map((t, i) => (
        <li key={i} data-kind={t.kind} className="relative">
          <span aria-hidden="true" className={`absolute -left-[23px] top-1 h-3 w-3 rounded-full border-2 border-white ${t.kind === "event" ? "bg-accent" : "bg-slate-400"}`} />
          <div className="text-xs text-slate-500"><Num>{t.at}</Num></div>
          {t.kind === "event" ? (
            <div>
              <span className="font-medium">{STAGE_LABEL[t.stage!] ?? t.stage}</span>{" "}
              <span className="text-slate-600">
                {d.by} {d.actor[t.actor!] ?? t.actor}{t.source ? ` ${d.via} ${t.source}` : ""}
              </span>
              {t.note && <div className="text-slate-700">{t.note}</div>}
            </div>
          ) : (
            <div>
              <span className="font-medium">
                {t.message_kind === "referral" ? "Referral" : "Follow-up"} {d.sentTo.toLowerCase()} {RECIPIENT[t.recipient!] ?? t.recipient}
              </span>{" "}
              <span className="text-slate-600">({d.channel[t.channel ?? "manual"]})</span>
              {t.edited && <span className="text-xs text-slate-500"> · {d.edited}</span>}
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-2 font-sans text-xs text-slate-800">{t.text}</pre>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
