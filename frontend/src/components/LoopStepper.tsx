import { copy } from "../copy";
import type { StepperItem } from "../api";

// The route track: Sent → Accepted → Scheduled → Seen → Plan back → Closed.
// Reached stops are filled; the current stop is ringed; a stuck referral's next stop is amber.
export function LoopStepper({ steps, stuck = false, compact = false }: { steps: StepperItem[]; stuck?: boolean; compact?: boolean }) {
  const lastDone = steps.reduce((acc, s, i) => (s.at ? i : acc), -1);
  return (
    <ol aria-label={copy.stepper.label} className="flex w-full items-start">
      {steps.map((s, i) => {
        const done = s.at !== null;
        const current = i === lastDone;
        const next = i === lastDone + 1;
        const dot = done
          ? "bg-accent border-accent"
          : next && stuck
            ? "bg-amber-100 border-amber-500"
            : "bg-white border-slate-300";
        return (
          <li key={s.stage} className="relative flex flex-1 flex-col items-center text-center">
            {i > 0 && (
              <span
                aria-hidden="true"
                className={`absolute right-1/2 top-[7px] h-0.5 w-full ${i <= lastDone ? "bg-accent" : "bg-slate-200"}`}
              />
            )}
            <span
              aria-hidden="true"
              className={`relative z-10 h-4 w-4 rounded-full border-2 ${dot} ${current ? "ring-4 ring-accent/20" : ""}`}
            />
            <span className={`mt-1 text-[11px] leading-tight ${done ? "text-slate-800" : "text-slate-400"}`}>
              <span className="sr-only">{done ? "Done: " : next && stuck ? "Waiting: " : "Not yet: "}</span>
              {s.label}
            </span>
            {!compact && done && <span className="font-mono text-[10px] text-slate-500">{s.at}</span>}
          </li>
        );
      })}
    </ol>
  );
}
