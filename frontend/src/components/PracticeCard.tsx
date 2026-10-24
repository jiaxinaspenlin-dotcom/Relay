import type { HospitalCard, Practice } from "../api";
import { copy } from "../copy";
import { Num } from "./ui";

export function HospitalLine({ h }: { h: HospitalCard }) {
  return (
    <span data-testid="nearest-hospital">
      {copy.hospital.label}: <span className="font-medium">{h.name}</span>, {h.distance_label} ·{" "}
      <Num>{h.beds}</Num> {h.beds_label} (<Num>{h.icu_beds}</Num> {copy.hospital.icuLabel})
      {h.cms_rating !== null && <> · {copy.hospital.ratingLabel} <Num>{h.cms_rating}</Num>/5</>}
    </span>
  );
}

export function PracticeCard({ p, chosen, onChoose, medicareProminent }: {
  p: Practice; chosen: boolean; onChoose: () => void; medicareProminent: boolean;
}) {
  return (
    <li
      data-testid="practice-card"
      className={`flex flex-wrap items-center justify-between gap-3 rounded-md border bg-white p-3 ${chosen ? "border-accent ring-2 ring-accent/25" : "border-slate-200"}`}
    >
      <div className="min-w-0">
        <div className="font-medium">{p.label}</div>
        <div className="text-sm text-slate-600">{p.address}, {p.town ?? p.city_raw}</div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
          <span>{p.clinician_label}</span>
          <span
            data-testid="medicare-label"
            className={medicareProminent ? "rounded bg-accent-soft px-1.5 font-medium text-accent" : "text-slate-700"}
          >
            {p.medicare_label} ({copy.directory})
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onChoose}
        aria-pressed={chosen}
        className={`rounded-md px-3 py-1 text-sm font-medium ${chosen ? "bg-accent text-white" : "border border-accent text-accent hover:bg-accent-soft"}`}
      >
        {chosen ? copy.newReferral.chosen : copy.newReferral.choose}
        <span className="sr-only"> {p.label}</span>
      </button>
    </li>
  );
}
