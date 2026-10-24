import { copy } from "../copy";
import type { StepperItem } from "../api";

// Sent → Accepted → Scheduled → Seen → Plan back → Closed. Reached steps show their date.
export function LoopStepper({ steps, compact = false }: { steps: StepperItem[]; compact?: boolean }) {
  return (
    <ol aria-label={copy.stepper.label} className="flex flex-wrap items-center gap-1 text-xs">
      {steps.map((s, i) => {
        const done = s.at !== null;
        return (
          <li key={s.stage} className="flex items-center gap-1">
            <span
              className={
                "rounded px-1.5 py-0.5 " +
                (done ? "bg-accent text-white" : "border border-slate-300 text-slate-500")
              }
            >
              <span className="sr-only">{done ? "done: " : "not yet: "}</span>
              {s.label}
              {done && !compact && <span className="ml-1 font-mono opacity-90">{s.at}</span>}
            </span>
            {i < steps.length - 1 && <span aria-hidden="true" className="text-slate-400">→</span>}
          </li>
        );
      })}
    </ol>
  );
}
