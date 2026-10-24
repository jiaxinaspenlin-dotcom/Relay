import type { Practice } from "../api";
import { copy } from "../copy";

export function PracticeCard({
  p,
  chosen,
  onChoose,
  medicareProminent,
}: {
  p: Practice;
  chosen: boolean;
  onChoose: () => void;
  medicareProminent: boolean;
}) {
  const h = p.nearest_hospital;
  return (
    <li
      data-testid="practice-card"
      className={"rounded border p-3 " + (chosen ? "border-accent ring-2 ring-accent/30" : "border-slate-200")}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-medium">{p.label}</div>
          <div className="text-sm text-slate-600">
            {p.address}, {p.town ?? p.city_raw}
          </div>
        </div>
        <div className="text-right font-mono text-sm">
          {p.miles !== null ? `${p.miles} ${copy.milesUnit}` : copy.distanceUnavailable}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span>
          <span className="font-mono">{p.clinician_count}</span> {copy.newReferral.clinicians}
        </span>
        <span
          data-testid="medicare-label"
          className={medicareProminent ? "rounded bg-accent-soft px-1.5 font-semibold" : ""}
        >
          {p.medicare_label} ({copy.medicare.source})
        </span>
      </div>
      {h && (
        <div className="mt-1 text-sm text-slate-700" data-testid="nearest-hospital">
          {copy.hospital.label}: {h.name}, <span className="font-mono">{h.miles}</span> {copy.milesUnit}{" "}
          {copy.hospital.fromPractice} · <span className="font-mono">{h.beds}</span> {h.beds_label} (
          <span className="font-mono">{h.icu_beds}</span> {copy.hospital.icuLabel})
          {h.cms_rating !== null && (
            <> · {copy.hospital.ratingLabel}: <span className="font-mono">{h.cms_rating}</span></>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={onChoose}
        aria-pressed={chosen}
        className="mt-2 rounded border border-accent px-2 py-0.5 text-sm text-accent"
      >
        {chosen ? copy.newReferral.chosen : copy.newReferral.choose}
      </button>
    </li>
  );
}
