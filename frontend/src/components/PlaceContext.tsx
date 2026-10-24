import type { PlaceItem } from "../api";
import { copy } from "../copy";
import { Muted, Panel } from "./ui";

// Context describes places, never people (R6). Small definition lists, a source link, and a
// muted "What this can't tell you" line on every item.
export function PlaceContext({ items, town }: { items: PlaceItem[]; town: string }) {
  return (
    <Panel title={copy.detail.placeContext} id="pc-h">
      <Muted>{copy.detail.placeContextNote} {town}.</Muted>
      <div className="mt-4 space-y-5">
        {items.map((it) => (
          <article key={it.kind}>
            <h3 className="font-semibold">{it.title}</h3>
            <dl className="mt-1 space-y-0.5 text-caption">
              {it.values?.map((v) => (
                <div key={v.measure} className="flex justify-between gap-3">
                  <dt className="text-muted">{v.measure}</dt>
                  <dd className="shrink-0">{v.value}{v.unit} <span className="text-muted">({v.ci_low} to {v.ci_high})</span></dd>
                </div>
              ))}
              {it.block_groups !== undefined && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">Block groups</dt>
                  <dd>{it.block_groups}{it.criteria && it.criteria.length > 0 ? `: ${it.criteria.map((c) => `${c.criteria.toLowerCase()} (${c.block_groups})`).join(", ")}` : ""}</dd>
                </div>
              )}
              {it.designations?.map((d) => (
                <div key={d.hpsa_id} className="flex justify-between gap-3">
                  <dt className="text-muted">{d.name}{d.includes_town ? " (includes this town)" : ""}</dt>
                  <dd className="shrink-0">{d.designation_type}{d.score !== null ? `, score ${d.score}` : ""}</dd>
                </div>
              ))}
              {it.hospitals?.map((h) => (
                <div key={h.name} className="flex justify-between gap-3">
                  <dt className="text-muted">{h.name}, {h.town}</dt>
                  <dd className="shrink-0">{h.miles === 0 ? "in town" : `${h.miles} mi`}, {h.beds} beds</dd>
                </div>
              ))}
            </dl>
            <p className="mt-1 text-caption text-muted">
              {copy.detail.source}: <a className="text-hemlock underline" href={it.source_url} target="_blank" rel="noreferrer">{it.source}</a>, {it.year}. {it.level}.
            </p>
            <p className="text-caption text-muted">{copy.detail.cannotTell} {it.cannot_tell_you}</p>
          </article>
        ))}
      </div>
    </Panel>
  );
}
