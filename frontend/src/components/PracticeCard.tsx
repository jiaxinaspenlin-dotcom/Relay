import type { HospitalCard, Practice } from "../api";
import { copy } from "../copy";

export function HospitalLine({ h }: { h: HospitalCard }) {
  return (
    <span data-testid="nearest-hospital">
      {copy.hospital.label}: {h.name}, {h.distance_label}. {h.beds} {h.beds_label}, {h.icu_beds} {copy.hospital.icu}.
      {h.cms_rating !== null && <> {copy.hospital.rating} {h.cms_rating} of 5.</>}
    </span>
  );
}

// A practice result row. The selected row gets the hemlock tint (design.md).
export function PracticeRow({ p, chosen, onChoose, medicareProminent }: {
  p: Practice; chosen: boolean; onChoose: () => void; medicareProminent: boolean;
}) {
  return (
    <li
      data-testid="practice-card"
      className={`flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0 ${chosen ? "bg-hemlock-tint" : "bg-surface"}`}
    >
      <div className="min-w-0">
        <div className="font-semibold">{p.label}</div>
        <div className="text-caption text-muted">{p.address}, {p.town ?? p.city_raw}. {p.clinician_label}.</div>
        <div
          data-testid="medicare-label"
          className={`text-caption ${medicareProminent ? "font-semibold text-hemlock" : "text-muted"}`}
        >
          {p.medicare_label} ({copy.directory})
        </div>
      </div>
      <button
        type="button"
        onClick={onChoose}
        aria-pressed={chosen}
        className={`min-h-[40px] rounded-control px-4 font-semibold ${chosen ? "bg-hemlock text-white" : "border border-hemlock text-hemlock hover:bg-hemlock-tint"}`}
      >
        {chosen ? copy.newReferral.chosen : copy.newReferral.choose}
        <span className="sr-only"> {p.label}</span>
      </button>
    </li>
  );
}
