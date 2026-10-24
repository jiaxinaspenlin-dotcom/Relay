import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { api } from "../api";
import { copy } from "../copy";
import { ErrorNote, Loading } from "./Status";
import { Button, Drawer } from "./ui";

/** Quiet "Export" menu: FHIR file for another clinic's system, a readable FHIR view, a printable
 * one-page summary. Keyboard: Enter/Space opens, arrows move, Escape closes. */
export function ExportMenu({ rid }: { rid: string }) {
  const t = copy.exportMenu;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    if (!open) return;
    items.current[0]?.focus();
    const onDoc = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const onKey = (e: React.KeyboardEvent) => {
    const i = items.current.findIndex((el) => el === document.activeElement);
    if (e.key === "Escape") { setOpen(false); (wrap.current?.querySelector("button") as HTMLButtonElement | null)?.focus(); }
    if (e.key === "ArrowDown") { e.preventDefault(); items.current[(i + 1) % items.current.length]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); items.current[(i + items.current.length - 1) % items.current.length]?.focus(); }
  };
  const item = "flex w-full flex-col items-start gap-1 rounded-control px-3 py-2 text-left hover:bg-paper focus-visible:outline-offset-[-2px]";
  return (
    <div ref={wrap} className="relative" onKeyDown={onKey}>
      <Button variant="quiet" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} className="px-2">
        {t.label}<ChevronDown size={16} strokeWidth={1.8} aria-hidden="true" />
      </Button>
      {open && (
        <div role="menu" aria-label={t.label} className="absolute right-0 top-12 z-30 w-[300px] rounded-panel border border-line bg-surface p-2 shadow-pop">
          <a role="menuitem" ref={(el) => { items.current[0] = el; }} href={api.fhirUrl(rid)} download={`relay-${rid}-fhir.json`} className={item} onClick={() => setOpen(false)}>
            <span className="font-semibold text-ink">{t.fhir}</span>
            <span className="text-caption text-muted">{t.fhirHint}</span>
          </a>
          <button role="menuitem" type="button" ref={(el) => { items.current[1] = el; }} className={item} onClick={() => { setOpen(false); setView(true); }}>
            <span className="font-semibold text-ink">{t.view}</span>
          </button>
          <a role="menuitem" ref={(el) => { items.current[2] = el; }} href={`/summary/${rid}`} target="_blank" rel="noreferrer" className={item} onClick={() => setOpen(false)}>
            <span className="font-semibold text-ink">{t.print}</span>
          </a>
        </div>
      )}
      {view && <FhirDrawer rid={rid} onClose={() => setView(false)} />}
    </div>
  );
}

function FhirDrawer({ rid, onClose }: { rid: string; onClose: () => void }) {
  const t = copy.exportMenu;
  const q = useQuery({
    queryKey: ["fhir", rid],
    queryFn: async () => {
      const r = await fetch(api.fhirUrl(rid), { credentials: "same-origin" });
      if (!r.ok) throw new Error(r.statusText);
      return r.json();
    },
  });
  return (
    <Drawer title={t.view} onClose={onClose}>
      <dl className="mb-4 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-caption" data-testid="fhir-legend">
        {t.legend.map(([k, v]) => (
          <div key={k} className="contents"><dt className="font-semibold">{k}</dt><dd className="text-muted">{v}</dd></div>
        ))}
      </dl>
      {q.isLoading && <Loading rows={2} />}
      {q.error && <ErrorNote error={q.error} />}
      {q.data && (
        <pre data-testid="fhir-json" className="overflow-x-auto rounded-control border border-line bg-surface p-4 text-[12px] leading-4">
          {JSON.stringify(q.data, null, 2)}
        </pre>
      )}
    </Drawer>
  );
}
