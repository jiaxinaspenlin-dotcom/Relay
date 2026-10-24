import type { StepperItem, StuckFlag } from "../api";
import { copy } from "../copy";
import { FAILURE_RULES, plural } from "../format";

// The signature element (design.md): stage nodes on a line. Completed nodes are filled hemlock,
// the current node is ringed, future nodes are line gray. On a stuck referral the segment after
// the current node becomes an elapsed bar: days waiting ÷ limit, capped at 2×, tick at the limit.

const STAGE_RULES = new Set([
  "sent_no_response", "accepted_no_appointment", "appointment_not_confirmed", "no_show",
  "seen_no_plan", "plan_not_acknowledged",
]);

export function primaryFlag(flags: StuckFlag[]): StuckFlag | undefined {
  return flags.find((f) => STAGE_RULES.has(f.rule));
}

export function ElapsedCaption({ flag }: { flag: StuckFlag }) {
  const unit = flag.unit === "business days" ? "business day" : "day";
  const waiting = `${plural(flag.days, unit)} waiting`;
  return (
    <span className="text-caption text-muted">
      {waiting},{" "}
      <abbr title={`${copy.practiceSetting}: ${plural(flag.threshold, unit)}`} className="no-underline">
        limit {flag.threshold}
      </abbr>
    </span>
  );
}

function ElapsedBar({ flag }: { flag: StuckFlag }) {
  const ratio = flag.threshold > 0 ? Math.min(flag.days / flag.threshold, 2) : 2;
  const failure = FAILURE_RULES.has(flag.rule);
  return (
    <span className={`relative block h-2 w-full overflow-hidden rounded-full ${failure ? "bg-rust-tint" : "bg-amber-tint"}`}>
      <span
        className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none ${failure ? "bg-rust" : "bg-amber"}`}
        style={{ width: `${(ratio / 2) * 100}%` }}
      />
      {flag.threshold > 0 && <span aria-hidden="true" className="absolute inset-y-[-2px] left-1/2 w-0.5 bg-ink/60" />}
    </span>
  );
}

export function RouteTrack({ steps, flags = [], size = "md" }: { steps: StepperItem[]; flags?: StuckFlag[]; size?: "md" | "lg" }) {
  const current = steps.reduce((acc, s, i) => (s.at ? i : acc), -1);
  const flag = primaryFlag(flags);
  const node = size === "lg" ? "h-4 w-4" : "h-3 w-3";
  const label = (s: StepperItem, i: number) =>
    `${s.label}: ${s.at ? "done" : i === current + 1 && flag ? "waiting" : "not yet"}`;

  return (
    <div>
      <ol aria-label={copy.stepper.label} className="flex w-full">
        {steps.map((s, i) => {
          const done = s.at !== null;
          const isCurrent = i === current;
          const last = i === steps.length - 1;
          const stuckHere = isCurrent && !!flag;
          return (
            <li key={s.stage} aria-label={label(s, i)} className={`flex min-w-0 flex-col ${last ? "shrink-0" : stuckHere ? "flex-[3]" : "flex-1"}`}>
              <div className="flex items-center">
                <span
                  aria-hidden="true"
                  className={`block shrink-0 rounded-full border-2 ${node} ${done ? "border-hemlock bg-hemlock" : "border-line bg-surface"} ${isCurrent ? "ring-4 ring-hemlock-tint" : ""}`}
                />
                {!last && (
                  <span aria-hidden="true" className="mx-1 flex flex-1 items-center">
                    {stuckHere ? <ElapsedBar flag={flag!} /> : <span className={`block h-0.5 w-full ${i < current ? "bg-hemlock" : "bg-line"}`} />}
                  </span>
                )}
              </div>
              <span aria-hidden="true" className={`mt-1 truncate pr-1 text-caption ${done ? "text-ink" : "text-muted"}`}>{s.label}</span>
            </li>
          );
        })}
      </ol>
      {flag && <div className="mt-1"><ElapsedCaption flag={flag} /></div>}
    </div>
  );
}
