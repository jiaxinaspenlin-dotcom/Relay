import type { PlaceItem } from "../api";
import { copy } from "../copy";

// Context describes places, never people (R6). Every item shows source, year, level, and limits.
export function PlaceContext({ items }: { items: PlaceItem[] }) {
  return (
    <section aria-labelledby="pc-h" className="space-y-3">
      <h2 id="pc-h" className="font-semibold">{copy.detail.placeContext}</h2>
      {items.map((it) => (
        <article key={it.kind} className="rounded border border-slate-200 p-3 text-sm">
          <h3 className="font-medium">{it.title}</h3>
          {it.values && (
            <ul className="mt-1">
              {it.values.map((v) => (
                <li key={v.measure}>
                  {v.measure}: <span className="font-mono">{v.value}{v.unit}</span>{" "}
                  <span className="text-xs text-slate-500">(95% CI {v.ci_low}–{v.ci_high})</span>
                </li>
              ))}
            </ul>
          )}
          {it.block_groups !== undefined && (
            <p className="mt-1">
              <span className="font-mono">{it.block_groups}</span> block groups
              {it.criteria && it.criteria.length > 0 && ": " + it.criteria.map((c) => `${c.criteria} (${c.block_groups})`).join(", ")}
            </p>
          )}
          {it.designations && (
            <ul className="mt-1">
              {it.designations.map((d) => (
                <li key={d.hpsa_id}>
                  {d.name} · {d.designation_type}
                  {d.score !== null && <> · score <span className="font-mono">{d.score}</span></>}
                  {d.includes_town && <span className="ml-1 rounded bg-slate-100 px-1 text-xs">includes this town</span>}
                </li>
              ))}
            </ul>
          )}
          {it.hospitals && (
            <ul className="mt-1">
              {it.hospitals.map((h) => (
                <li key={h.name}>
                  {h.name} ({h.town}) · <span className="font-mono">{h.miles}</span> {copy.milesUnit} ·{" "}
                  <span className="font-mono">{h.beds}</span> {h.beds_label} · <span className="font-mono">{h.icu_beds}</span> {copy.hospital.icuLabel}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-slate-600">
            {copy.detail.source}:{" "}
            <a className="underline" href={it.source_url} target="_blank" rel="noreferrer">{it.source}</a> · {it.year} · {it.level}
          </p>
          <p className="text-xs text-slate-600">{copy.detail.cannotTell} {it.cannot_tell_you}</p>
        </article>
      ))}
    </section>
  );
}
