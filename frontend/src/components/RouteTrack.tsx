import type { StepperItem, StuckFlag } from "../api";
import { copy } from "../copy";
import { FAILURE_RULES, shortDate } from "../format";

// The route track (design.md): 7 equal columns, a 12px dot centered in each, joined by a 2px line.
// Completed: filled hemlock with a hemlock line. Current: a 3px ring, rust or amber when stuck.
// Future: white with a gray border. When stuck, a 6px bar starts at the current dot's center,
// length = days waiting / limit x one column (capped at 2), with a thin tick at the limit.

const STAGE_RULES = new Set([
  "sent_no_receipt", "received_incomplete", "not_scheduled", "seen_no_plan", "plan_not_acknowledged",
  "no_show", "declined_not_rerouted", "authorization_pending",
]);

export function primaryFlag(flags: StuckFlag[]): StuckFlag | undefined {
  return flags.find((f) => STAGE_RULES.has(f.rule)) ?? flags[0];
}

export function RouteTrack({ steps, flags = [], labels = false }: { steps: StepperItem[]; flags?: StuckFlag[]; labels?: boolean }) {
  const n = steps.length;
  const current = steps.reduce((acc, s, i) => (s.at ? i : acc), -1);
  const flag = primaryFlag(flags);
  const failure = flag ? FAILURE_RULES.has(flag.rule) : false;
  const col = 100 / n;
  const center = (i: number) => col * i + col / 2;
  const ratio = flag ? (flag.threshold > 0 ? Math.min(flag.days / flag.threshold, 2) : 1) : 0;
  const barStart = center(Math.max(current, 0));
  const barWidth = Math.min(ratio * col, 100 - barStart);
  const tone = failure ? { ring: "border-rust", fill: "bg-rust-tint", edge: "border-rust", solid: "bg-rust" }
                       : { ring: "border-amber", fill: "bg-amber-tint", edge: "border-amber", solid: "bg-amber" };
  const doneLineEnd = current > 0 ? center(current) : center(0);

  return (
    <div className="w-full">
      <div className="relative h-4" role="img" aria-label={`${copy.track.label}: ${steps.filter((s) => s.at).map((s) => s.label).join(", ") || "not sent"}${flag ? `. ${flag.status}` : ""}`}>
        <span aria-hidden="true" className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-line" style={{ left: `${center(0)}%`, width: `${center(n - 1) - center(0)}%` }} />
        {current > 0 && (
          <span aria-hidden="true" className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-hemlock" style={{ left: `${center(0)}%`, width: `${doneLineEnd - center(0)}%` }} />
        )}
        {flag && current >= 0 && (
          <span aria-hidden="true" className={`absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full border ${tone.fill} ${tone.edge} transition-[width] duration-300 ease-out motion-reduce:transition-none`}
            style={{ left: `${barStart}%`, width: `${barWidth}%` }}>
            {flag.threshold > 0 && ratio > 0 && (
              <span className="absolute -top-1 -bottom-1 w-px bg-ink" style={{ left: `${Math.min((1 / ratio) * 100, 100)}%` }} />
            )}
          </span>
        )}
        {steps.map((s, i) => {
          const done = s.at !== null && i < current;
          const isCurrent = i === current;
          const cls = isCurrent
            ? flag ? `bg-surface border-[3px] ${tone.ring}` : "bg-hemlock border-hemlock border-2"
            : done ? "bg-hemlock border-hemlock border-2" : "bg-surface border-line border-2";
          return (
            <span key={s.stage} aria-hidden="true" className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ${cls}`} style={{ left: `${center(i)}%` }} />
          );
        })}
      </div>
      {labels && (
        <ol className="mt-2 grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          {steps.map((s, i) => (
            <li key={s.stage} className="text-center">
              <span className={`block text-caption ${s.at ? "text-ink" : "text-muted"} ${i === current && flag ? "font-semibold" : ""}`}>{s.label}</span>
              <span className="block text-[12px] leading-4 text-muted">{s.at ? shortDate(s.at) : ""}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
