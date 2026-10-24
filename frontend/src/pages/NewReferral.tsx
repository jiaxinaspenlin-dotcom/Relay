import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api, type Practice } from "../api";
import { copy } from "../copy";
import { AddPatient } from "../components/AddPatient";
import { HospitalLine, PracticeRow } from "../components/PracticeCard";
import { SendButtons, type Channel } from "../components/SendButtons";
import { ErrorNote, Loading } from "../components/Status";
import { Button, Field, Muted, SampleTag, inputCls } from "../components/ui";

const PAGE = 10;

// Consecutive practices in one town share a distance and nearest hospital: show them once.
function groupByTown(rows: Practice[]) {
  const groups: { key: string; town: string; label: string; hospital: Practice["nearest_hospital"]; rows: Practice[] }[] = [];
  for (const r of rows) {
    const town = r.town ?? r.city_raw;
    const last = groups[groups.length - 1];
    if (last && last.town === town) last.rows.push(r);
    else groups.push({ key: `${town}-${groups.length}`, town, label: r.distance_label, hospital: r.nearest_hospital, rows: [r] });
  }
  return groups;
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`step-${n}`} className="space-y-4">
      <h2 id={`step-${n}`} className="text-section font-bold"><span className="text-muted">{n}.</span> {title}</h2>
      {children}
    </section>
  );
}

export default function NewReferral() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const patients = useQuery({ queryKey: ["patients"], queryFn: api.patients });
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [pid, setPid] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [conditionCode, setConditionCode] = useState("");
  const [conditionText, setConditionText] = useState("");
  const [reason, setReason] = useState("");
  const [priority, setPriority] = useState<"" | "routine" | "urgent">("");
  const [practiceId, setPracticeId] = useState("");
  const [maxMiles, setMaxMiles] = useState<number | null>(null);
  const [acceptsOnly, setAcceptsOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const t = copy.newReferral;
  const list = patients.data?.patients ?? [];
  useEffect(() => { if (patients.data && list.length === 0) setAdding(true); }, [patients.data, list.length]);

  const matches = list.filter((p) => !search.trim() || `${p.name} ${p.town}`.toLowerCase().includes(search.trim().toLowerCase()));
  const patient = list.find((p) => p.id === pid);
  function choose(id: string) {
    const p = list.find((x) => x.id === id);
    setPid(id); setPracticeId(""); setLimit(PAGE);
    setSpecialty(p?.suggested_specialty ?? "");
    setConditionCode(p?.suggested_condition_code ?? ""); setConditionText("");
  }

  const conditions = useQuery({ queryKey: ["conditions", pid], queryFn: () => api.conditions(pid), enabled: !!pid });
  const hasChart = !!conditions.data?.has_chart;
  const finder = useQuery({
    queryKey: ["finder", specialty, pid, maxMiles, acceptsOnly, limit],
    queryFn: () => api.finder(specialty, pid, { maxMiles, acceptsOnly, limit }),
    enabled: !!pid && !!specialty,
    placeholderData: keepPreviousData,
  });
  const groups = useMemo(() => groupByTown(finder.data?.results ?? []), [finder.data]);

  const create = useMutation({
    mutationFn: async (channel: Channel) => {
      const d = await api.createReferral({
        patient_id: pid, specialty, practice_id: practiceId, reason_text: reason, priority,
        condition_code: hasChart ? conditionCode : "", condition_text: hasChart ? "" : conditionText,
      });
      const sent = await api.sendReferral(d.card.id, channel);
      return { rid: d.card.id, commId: sent.communication_id, message: sent.message };
    },
  });

  if (patients.isLoading) return <Loading />;
  if (patients.error) return <ErrorNote error={patients.error} />;
  const n = t.needs;
  const missing = !pid ? n.patient : !practiceId ? n.practice
    : !hasChart && !conditionText.trim() ? n.condition : !reason.trim() ? n.reason : !priority ? n.priority : "";

  // Create, record the send, then hand the text to the chosen channel (SendButtons does the
  // channel action around `send`).
  const send = async (channel: Channel) => {
    const r = await create.mutateAsync(channel);
    qc.invalidateQueries();
    setTimeout(() => nav(`/referrals/${r.rid}`), 0);
    return { commId: r.commId, rid: r.rid, subject: r.message.subject, text: r.message.text };
  };

  return (
    <div className="space-y-12">
      <div>
        <Link to="/" className="inline-flex min-h-[40px] items-center gap-1 text-hemlock hover:underline"><ChevronLeft size={18} strokeWidth={1.8} aria-hidden="true" />{copy.detail.back}</Link>
        <h1 className="mt-2 text-page font-bold">{t.title}</h1>
      </div>

      <Step n={1} title={t.step1}>
        {!adding && list.length > 0 && (
          <div className="max-w-xl space-y-3">
            <Field label={t.search}><input type="search" className={inputCls} value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
            <ul className="overflow-hidden rounded-panel border border-line bg-surface" aria-label={t.step1}>
              {matches.slice(0, 6).map((p) => (
                <li key={p.id} className="border-b border-line last:border-b-0">
                  <button type="button" onClick={() => choose(p.id)} aria-pressed={pid === p.id}
                    className={`flex min-h-[48px] w-full items-center justify-between gap-3 px-6 text-left ${pid === p.id ? "bg-hemlock-tint" : "hover:bg-paper"}`}>
                    <span><span className="font-semibold">{p.name}</span> <span className="text-caption text-muted">{p.town}</span></span>
                    <span className="flex items-center gap-2 text-caption text-muted">{p.coverage_label}<SampleTag show={p.sample} /></span>
                  </button>
                </li>
              ))}
              {matches.length === 0 && <li className="px-6 py-3 text-muted">{t.noMatch}</li>}
            </ul>
          </div>
        )}
        {adding ? (
          <div className="max-w-xl">
            <AddPatient onAdded={(p) => { setAdding(false); setPid(p.id); setSpecialty(""); setConditionCode(""); setPracticeId(""); }}
              onCancel={list.length ? () => setAdding(false) : undefined} />
          </div>
        ) : (
          <Button onClick={() => setAdding(true)}>{t.addPatient}</Button>
        )}
        {patient && !adding && <Muted>{patient.name}, {patient.town}. {patient.coverage_label}.</Muted>}
      </Step>

      {pid && !adding && (
        <Step n={2} title={t.step2}>
          <div className="max-w-xl">
            <Field label={t.step2}>
              <select className={inputCls} value={specialty} onChange={(e) => { setSpecialty(e.target.value); setPracticeId(""); setLimit(PAGE); }}>
                <option value="">Choose</option>
                {patients.data!.specialties.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
          </div>
        </Step>
      )}

      {pid && specialty && !adding && (
        <Step n={3} title={t.step3}>
          <p className="text-caption text-muted">{t.sortNote} {t.telehealth}</p>
          <div className="flex flex-wrap items-center gap-4" role="group" aria-label="Filters">
            <label className="flex items-center gap-2">
              <span className="font-semibold">{t.within}</span>
              <select className="min-h-[40px] rounded-control border border-line bg-surface px-3" value={maxMiles ?? ""} onChange={(e) => { setMaxMiles(e.target.value ? Number(e.target.value) : null); setLimit(PAGE); }}>
                <option value="">{t.anyDistance}</option>
                {[25, 50, 100].map((m) => <option key={m} value={m}>{t.milesOption(m)}</option>)}
              </select>
            </label>
            <label className="flex min-h-[40px] items-center gap-2">
              <input type="checkbox" className="h-4 w-4 accent-hemlock" checked={acceptsOnly} onChange={(e) => { setAcceptsOnly(e.target.checked); setLimit(PAGE); }} />
              {t.acceptsOnly}
            </label>
          </div>
          {finder.isLoading && <Loading />}
          {finder.error && <ErrorNote error={finder.error} />}
          {finder.data && (
            <>
              {finder.data.total === 0 && <p className="text-muted">{t.noResults}</p>}
              <div className="space-y-4">
                {groups.map((g) => (
                  <section key={g.key} aria-label={g.town} data-testid="town-group" className="overflow-hidden rounded-panel border border-line bg-surface">
                    <div className="border-b border-line px-6 py-3">
                      <h3 className="font-semibold">{g.label === `In ${g.town}` ? g.label : `${g.town}, ${g.label}`}</h3>
                      {g.hospital && <div className="text-caption text-muted"><HospitalLine h={g.hospital} /></div>}
                    </div>
                    <ul>
                      {g.rows.map((p) => <PracticeRow key={p.id} p={p} chosen={p.id === practiceId} onChoose={() => setPracticeId(p.id)} medicareProminent={finder.data!.medicare_prominent} />)}
                    </ul>
                  </section>
                ))}
              </div>
              <div className="flex items-center gap-4">
                {finder.data.has_more && <Button onClick={() => setLimit(limit + PAGE)} disabled={finder.isFetching}>{t.showMore}</Button>}
                <Muted>{t.count(finder.data.results.length, finder.data.total)}</Muted>
              </div>
            </>
          )}
        </Step>
      )}

      {pid && practiceId && !adding && (
        <Step n={4} title={t.step4}>
          <div className="max-w-xl space-y-4">
            {hasChart ? (
              <Field label={t.conditionFromChart}>
                <select className={inputCls} value={conditionCode} onChange={(e) => setConditionCode(e.target.value)}>
                  {conditions.data!.conditions.map((c) => <option key={c.code} value={c.code}>{c.display}</option>)}
                </select>
              </Field>
            ) : (
              <Field label={t.condition}><input className={inputCls} value={conditionText} onChange={(e) => setConditionText(e.target.value)} /></Field>
            )}
            <Field label={t.reason}><textarea className={inputCls} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <fieldset>
              <legend className="font-semibold">{t.priority}</legend>
              <div className="mt-1 flex gap-6">
                {(["routine", "urgent"] as const).map((p) => (
                  <label key={p} className="flex min-h-[40px] items-center gap-2">
                    <input type="radio" name="priority" className="h-4 w-4 accent-hemlock" checked={priority === p} onChange={() => setPriority(p)} />
                    {p === "routine" ? t.routine : t.urgent}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </Step>
      )}

      {pid && practiceId && !adding && (
        <Step n={5} title={t.send}>
          <Muted className="block">{missing || t.sendHelp}</Muted>
          <SendButtons rid="" subject="" text="" primary="copy" disabled={!!missing || create.isPending} send={send} />
          {create.error && <ErrorNote error={create.error} />}
        </Step>
      )}
    </div>
  );
}
