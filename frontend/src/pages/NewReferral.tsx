import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, type Practice } from "../api";
import { copy } from "../copy";
import { AddPatient } from "../components/AddPatient";
import { HospitalLine, PracticeCard } from "../components/PracticeCard";
import { ErrorNote, Loading } from "../components/Status";
import { Button, Field, Num, Panel, SampleTag, inputCls } from "../components/ui";

const PAGE = 10;

// Consecutive practices in the same town share a distance and a nearest hospital: show it once.
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
  useEffect(() => {
    if (!pid && list.length) choosePatient(list[0].id);
    if (patients.data && list.length === 0) setAdding(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patients.data]);

  function choosePatient(id: string) {
    const p = list.find((x) => x.id === id);
    setPid(id);
    setPracticeId("");
    setLimit(PAGE);
    if (p?.suggested_specialty) setSpecialty(p.suggested_specialty);
    setConditionCode(p?.suggested_condition_code ?? "");
    setConditionText("");
  }

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
    onSuccess: (d) => {
      qc.invalidateQueries();
      nav(`/referrals/${d.card.id}`);
    },
  });

  if (patients.isLoading) return <Loading />;
  if (patients.error) return <ErrorNote error={patients.error} />;

  const missing = !practiceId ? t.needPractice
    : !reason.trim() ? t.needReason
    : !hasChart && !conditionText.trim() ? t.needCondition
    : !priority ? t.needPriority : "";

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
      <div className="grid gap-6 lg:grid-cols-[24rem_1fr]">
        <div className="space-y-4">
          <Panel title={t.patient} id="pt-h">
            {list.length === 0 && !adding && <p className="text-sm text-slate-600">{t.noPatients}</p>}
            {list.length > 0 && (
              <Field label={t.patient}>
                <select className={inputCls} value={pid} onChange={(e) => choosePatient(e.target.value)}>
                  {list.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.town}{p.sample ? ` · ${copy.sampleTag}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {patient && (
              <p className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                {patient.town}, {patient.county} County · {patient.coverage_label}
                {patient.age !== null && <> · <Num>{patient.age}</Num> y</>}
                <SampleTag show={patient.sample} />
              </p>
            )}
            <div className="mt-3">
              {adding ? (
                <AddPatient
                  onAdded={(p) => { setAdding(false); setPid(p.id); setConditionCode(""); setPracticeId(""); }}
                  onCancel={() => setAdding(false)}
                />
              ) : (
                <Button variant="quiet" onClick={() => setAdding(true)}>+ {t.addPatient}</Button>
              )}
            </div>
          </Panel>

          {pid && (
            <Panel title={copy.nav.newReferral} id="ref-h">
              <form
                className="space-y-3"
                onSubmit={(e) => { e.preventDefault(); if (!missing) create.mutate(); }}
              >
                <Field label={t.specialty}>
                  <select className={inputCls} value={specialty} onChange={(e) => { setSpecialty(e.target.value); setPracticeId(""); setLimit(PAGE); }}>
                    {patients.data!.specialties.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </Field>
                {hasChart ? (
                  <Field label={`${t.condition} (${t.conditionFromChart})`}>
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
                <fieldset className="text-sm text-slate-700">
                  <legend>{t.priority}</legend>
                  <div className="mt-1 flex gap-4">
                    {(["routine", "urgent"] as const).map((p) => (
                      <label key={p} className="flex items-center gap-1">
                        <input type="radio" name="priority" value={p} checked={priority === p} onChange={() => setPriority(p)} />
                        {p === "routine" ? t.routine : t.urgent}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {missing && <p className="text-xs text-slate-500">{missing}</p>}
                <Button variant="primary" type="submit" disabled={!!missing || create.isPending}>
                  {create.isPending ? t.creating : t.create}
                </Button>
                {create.error && <ErrorNote error={create.error} />}
              </form>
            </Panel>
          )}
        </div>

        {pid && (
          <Panel title={t.findPractices} id="finder-h">
            <p className="text-sm text-slate-600">{t.sortNote}</p>
            <p className="mt-1 text-sm font-medium text-slate-800">{copy.telehealthNote}</p>
            <div className="mt-3 flex flex-wrap items-center gap-4 rounded-md bg-slate-50 p-2 text-sm" role="group" aria-label={t.filters}>
              <label className="flex items-center gap-2">
                {t.within}
                <select className="rounded-md border border-slate-300 bg-white px-2 py-1" value={maxMiles ?? ""} onChange={(e) => { setMaxMiles(e.target.value ? Number(e.target.value) : null); setLimit(PAGE); }}>
                  <option value="">{t.anyDistance}</option>
                  {[25, 50, 100].map((n) => <option key={n} value={n}>{t.milesOption(n)}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={acceptsOnly} onChange={(e) => { setAcceptsOnly(e.target.checked); setLimit(PAGE); }} />
                {t.acceptsOnly}
              </label>
            </div>
            {finder.isLoading && <Loading />}
            {finder.error && <ErrorNote error={finder.error} />}
            {finder.data && (
              <>
                <p className="mt-2 text-xs text-slate-500">
                  {t.count(finder.data.results.length, finder.data.total)} · {copy.distanceBasis}
                </p>
                {finder.data.total === 0 && <p className="mt-3 text-sm text-slate-600">{t.noResults}</p>}
                <div className="mt-3 space-y-4">
                  {groups.map((g) => (
                    <section key={g.key} aria-label={g.town} data-testid="town-group">
                      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-1">
                        <h3 className="text-sm font-semibold">{t.townGroup(g.town, g.label)}</h3>
                        {g.hospital && <span className="text-xs text-slate-600"><HospitalLine h={g.hospital} /></span>}
                      </div>
                      <ul className="space-y-2">
                        {g.rows.map((p) => (
                          <PracticeCard key={p.id} p={p} chosen={p.id === practiceId} onChoose={() => setPracticeId(p.id)} medicareProminent={finder.data!.medicare_prominent} />
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
                {finder.data.has_more && (
                  <div className="mt-4 text-center">
                    <Button onClick={() => setLimit(limit + PAGE)} disabled={finder.isFetching}>{t.showMore}</Button>
                  </div>
                )}
              </>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}
