import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, type Practice } from "../api";
import { copy } from "../copy";
import { AddPatient } from "../components/AddPatient";
import { HospitalLine, PracticeRow } from "../components/PracticeCard";
import { ErrorNote, Loading } from "../components/Status";
import { Button, Field, Muted, SampleTag, inputCls } from "../components/ui";

const PAGE = 10;

// Consecutive practices in the same town share a distance and nearest hospital: show it once.
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

export default function NewReferral() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const patients = useQuery({ queryKey: ["patients"], queryFn: api.patients });
  const [adding, setAdding] = useState(false);
  const [pid, setPid] = useState("");
  const [specialty, setSpecialty] = useState("Cardiology");
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

  function choosePatient(id: string, all = list) {
    const p = all.find((x) => x.id === id);
    setPid(id);
    setPracticeId("");
    setLimit(PAGE);
    if (p?.suggested_specialty) setSpecialty(p.suggested_specialty);
    setConditionCode(p?.suggested_condition_code ?? "");
    setConditionText("");
  }

  useEffect(() => {
    if (!patients.data) return;
    if (!pid && list.length) choosePatient(list[0].id, list);
    if (list.length === 0) setAdding(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patients.data]);

  const patient = list.find((p) => p.id === pid);
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
    mutationFn: () => api.createReferral({
      patient_id: pid, specialty, practice_id: practiceId, reason_text: reason, priority,
      condition_code: hasChart ? conditionCode : "", condition_text: hasChart ? "" : conditionText,
    }),
    onSuccess: (d) => { qc.invalidateQueries(); nav(`/referrals/${d.card.id}`); },
  });

  if (patients.isLoading) return <Loading />;
  if (patients.error) return <ErrorNote error={patients.error} />;

  const missing = !practiceId ? t.needPractice
    : !reason.trim() ? t.needReason
    : !hasChart && !conditionText.trim() ? t.needCondition
    : !priority ? t.needPriority : "";

  return (
    <div className="space-y-5">
      <h1 className="text-page font-bold">{t.title}</h1>
      <div className="grid items-start gap-6 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-4 rounded-panel border border-line bg-surface p-5">
          {list.length > 0 && (
            <Field label={t.patient}>
              <select className={inputCls} value={pid} onChange={(e) => choosePatient(e.target.value)}>
                {list.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}, {p.town}{p.sample ? ` (${copy.sampleTag})` : ""}</option>
                ))}
              </select>
            </Field>
          )}
          {patient && (
            <p className="flex flex-wrap items-center gap-2 text-caption text-muted">
              {patient.town}, {patient.county} County. {patient.coverage_label}.
              {patient.age !== null && <> Age {patient.age}.</>}
              <SampleTag show={patient.sample} />
            </p>
          )}
          {list.length === 0 && !adding && <p className="text-muted">{t.noPatients}</p>}
          {adding ? (
            <AddPatient
              onAdded={(p) => { setAdding(false); setPid(p.id); setConditionCode(""); setConditionText(""); setPracticeId(""); setLimit(PAGE); }}
              onCancel={list.length ? () => setAdding(false) : undefined}
            />
          ) : (
            <Button variant="quiet" onClick={() => setAdding(true)}>{t.addPatient}</Button>
          )}

          {pid && !adding && (
            <form className="space-y-4 border-t border-line pt-4" aria-label={t.title} onSubmit={(e) => { e.preventDefault(); if (!missing) create.mutate(); }}>
              <Field label={t.specialty}>
                <select className={inputCls} value={specialty} onChange={(e) => { setSpecialty(e.target.value); setPracticeId(""); setLimit(PAGE); }}>
                  {patients.data!.specialties.map((s) => <option key={s}>{s}</option>)}
                </select>
              </Field>
              {hasChart ? (
                <Field label={t.conditionFromChart}>
                  <select className={inputCls} value={conditionCode} onChange={(e) => setConditionCode(e.target.value)}>
                    {conditions.data!.conditions.map((c) => <option key={c.code} value={c.code}>{c.display}</option>)}
                  </select>
                </Field>
              ) : (
                <Field label={t.condition}>
                  <input className={inputCls} value={conditionText} onChange={(e) => setConditionText(e.target.value)} />
                </Field>
              )}
              <Field label={t.reason}>
                <textarea className={inputCls} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <fieldset>
                <legend className="font-semibold">{t.priority}</legend>
                <div className="mt-1 flex gap-5">
                  {(["routine", "urgent"] as const).map((p) => (
                    <label key={p} className="flex min-h-[40px] items-center gap-2">
                      <input type="radio" name="priority" value={p} checked={priority === p} onChange={() => setPriority(p)} className="h-4 w-4 accent-hemlock" />
                      {p === "routine" ? t.routine : t.urgent}
                    </label>
                  ))}
                </div>
              </fieldset>
              {missing && <Muted>{missing}</Muted>}
              <div>
                <Button variant="primary" type="submit" disabled={!!missing || create.isPending}>{create.isPending ? t.creating : t.create}</Button>
              </div>
              {create.error && <ErrorNote error={create.error} />}
            </form>
          )}
        </div>

        {pid && !adding && (
          <section aria-labelledby="results-h" className="space-y-3">
            <div>
              <h2 id="results-h" className="text-section font-semibold">{t.results}</h2>
              <p className="text-caption text-muted">{t.sortNote} {copy.telehealthNote}</p>
            </div>
            <div className="flex flex-wrap items-center gap-4" role="group" aria-label="Filters">
              <label className="flex items-center gap-2">
                <span className="font-semibold">{t.within}</span>
                <select className="min-h-[40px] rounded-control border border-line bg-surface px-3" value={maxMiles ?? ""} onChange={(e) => { setMaxMiles(e.target.value ? Number(e.target.value) : null); setLimit(PAGE); }}>
                  <option value="">{t.anyDistance}</option>
                  {[25, 50, 100].map((n) => <option key={n} value={n}>{t.milesOption(n)}</option>)}
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
                <Muted>{t.count(finder.data.results.length, finder.data.total)} {copy.distanceBasis}</Muted>
                {finder.data.total === 0 && <p className="text-muted">{t.noResults}</p>}
                <div className="space-y-4">
                  {groups.map((g) => (
                    <section key={g.key} aria-label={g.town} data-testid="town-group" className="overflow-hidden rounded-panel border border-line bg-surface">
                      <div className="border-b border-line bg-paper px-4 py-2">
                        <h3 className="font-semibold">{g.label === `In ${g.town}` ? g.label : `${g.town}, ${g.label}`}</h3>
                        {g.hospital && <div className="text-caption text-muted"><HospitalLine h={g.hospital} /></div>}
                      </div>
                      <ul>
                        {g.rows.map((p) => (
                          <PracticeRow key={p.id} p={p} chosen={p.id === practiceId} onChoose={() => setPracticeId(p.id)} medicareProminent={finder.data!.medicare_prominent} />
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
                {finder.data.has_more && (
                  <div><Button onClick={() => setLimit(limit + PAGE)} disabled={finder.isFetching}>{t.showMore}</Button></div>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
