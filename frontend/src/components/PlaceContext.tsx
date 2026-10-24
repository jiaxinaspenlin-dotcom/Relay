import type { PlaceItem } from "../api";
import { copy } from "../copy";
import { Num, Panel } from "./ui";

// Context describes places, never people (R6). Every item shows source, year, level, and limits.
export function PlaceContext({ items, town }: { items: PlaceItem[]; town: string }) {
  return (
    <Panel title={`${copy.detail.placeContext}: ${town}`} id="pc-h">
      <p className="mb-3 text-xs text-slate-500">{copy.detail.placeContextNote}</p>
      <div className="space-y-4">
        {items.map((it) => (
          <article key={it.kind} className="text-sm">
            <h3 className="font-medium">{it.title}</h3>
            {it.values && (
              <ul className="mt-1 space-y-0.5">
                {it.values.map((v) => (
                  <li key={v.measure} className="flex justify-between gap-3">
                    <span className="text-slate-700">{v.measure}</span>
                    <span className="shrink-0"><Num>{v.value}{v.unit}</Num> <span className="text-xs text-slate-500">(<Num>{v.ci_low}–{v.ci_high}</Num>)</span></span>
                  </li>
                ))}
              </ul>
            )}
            {it.block_groups !== undefined && (
              <p className="mt-1 text-slate-700">
                <Num>{it.block_groups}</Num> block groups
                {it.criteria && it.criteria.length > 0 && ": " + it.criteria.map((c) => `${c.criteria} (${c.block_groups})`).join(", ")}
              </p>
            )}
            {it.designations && (
              <ul className="mt-1 space-y-0.5 text-slate-700">
                {it.designations.map((d) => (
                  <li key={d.hpsa_id}>
                    {d.name} · {d.designation_type}
                    {d.score !== null && <> · score <Num>{d.score}</Num></>}
                    {d.includes_town && <span className="ml-1 rounded bg-slate-100 px-1 text-xs">includes this town</span>}
                  </li>
                ))}
              </ul>
            )}
            {it.hospitals && (
              <ul className="mt-1 space-y-0.5 text-slate-700">
                {it.hospitals.map((h) => (
                  <li key={h.name}>
                    {h.name} ({h.town}) · {h.miles === 0 ? `in ${h.town}` : <><Num>{h.miles}</Num> {copy.milesUnit}</>} · <Num>{h.beds}</Num> {h.beds_label}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-xs text-slate-500">
              {copy.detail.source}: <a className="underline" href={it.source_url} target="_blank" rel="noreferrer">{it.source}</a> · {it.year} · {it.level}
            </p>
            <p className="text-xs text-slate-500">{copy.detail.cannotTell} {it.cannot_tell_you}</p>
          </article>
        ))}
      </div>
    </Panel>
  );
}
