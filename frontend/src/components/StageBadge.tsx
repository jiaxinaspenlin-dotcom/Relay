import { stageColors } from "../copy";

// Stage colors are always paired with the stage label.
export function StageBadge({ stage, label }: { stage: string; label: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${stageColors[stage] ?? "bg-slate-100"}`}>
      {label}
    </span>
  );
}
