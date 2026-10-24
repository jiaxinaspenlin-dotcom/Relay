import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { copy } from "../copy";
import { PracticeCard } from "../components/PracticeCard";
import { ErrorNote, Loading } from "../components/Status";

export default function NewReferral() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const patients = useQuery({ queryKey: ["patients"], queryFn: api.patients });
  const [pid, setPid] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [conditionCode, setConditionCode] = useState("");
  const [reason, setReason] = useState("");
  const [priority, setPriority] = useState<"" | "routine" | "urgent">("");
  const [practiceId, setPracticeId] = useState("");

  // Default to the live-demo patient and their suggested specialty/condition from the seed.
  useEffect(() => {
    const first = patients.data?.patients[0];
    if (first && !pid) {
      setPid(first.id);
      setSpecialty(first.suggested_specialty);
      setConditionCode(first.suggested_condition_code);
    }
  }, [patients.data, pid]);

  const patient = patients.data?.patients.find((p) => p.id === pid);
  const conditions = useQuery({
    queryKey: ["conditions", pid],
    queryFn: () => api.conditions(pid),
    enabled: !!pid,
  });
  const finder = useQuery({
    queryKey: ["finder", specialty, pid],
    queryFn: () => api.finder(specialty, pid),
    enabled: !!pid && !!specialty,
  });

  const send = useMutation({
    mutationFn: () =>
      api.createReferral({
        patient_id: pid,
        specialty,
        practice_id: practiceId,
        reason_text: reason,
        priority,
        condition_code: conditionCode,
      }),
    onSuccess: (d) => {
      qc.invalidateQueries();
      nav(`/referrals/${d.card.id}`);
    },
  });

  if (patients.isLoading) return <Loading />;
  if (patients.error) return <div className="p-6"><ErrorNote error={patients.error} /></div>;

  const missing = !practiceId
    ? copy.newReferral.needPractice
    : !reason.trim()
      ? copy.newReferral.needReason
      : "";
  const field = "mt-1 block w-full rounded border border-slate-300 px-2 py-1";

  return (
    <div className="grid gap-6 p-6 lg:grid-cols-[22rem_1fr]">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!missing && priority) send.mutate();
        }}
      >
        <h1 className="text-xl font-semibold">{copy.newReferral.title}</h1>
        <label className="block text-sm">
          {copy.newReferral.patient}
          <select
            className={field}
            value={pid}
            onChange={(e) => {
              const p = patients.data!.patients.find((x) => x.id === e.target.value)!;
              setPid(p.id);
              setSpecialty(p.suggested_specialty);
              setConditionCode(p.suggested_condition_code);
              setPracticeId("");
            }}
          >
            {patients.data!.patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.synthetic_name} · {p.town}{p.live_demo ? ` (${copy.newReferral.liveDemo})` : ""}
              </option>
            ))}
          </select>
        </label>
        {patient && (
          <p className="text-xs text-slate-600">
            {copy.newReferral.payer}: {patient.payer} · {patient.town}, {patient.county} County
          </p>
        )}
        <label className="block text-sm">
          {copy.newReferral.specialty}
          <select
            className={field}
            value={specialty}
            onChange={(e) => {
              setSpecialty(e.target.value);
              setPracticeId("");
            }}
          >
            {patients.data!.specialties.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          {copy.newReferral.condition}
          <select className={field} value={conditionCode} onChange={(e) => setConditionCode(e.target.value)}>
            {conditions.data?.conditions.map((c) => (
              <option key={c.code} value={c.code}>{c.display}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          {copy.newReferral.reason}
          <textarea className={field} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <fieldset className="text-sm">
          <legend>{copy.newReferral.priority}</legend>
          {(["routine", "urgent"] as const).map((p) => (
            <label key={p} className="mr-4">
              <input
                type="radio"
                name="priority"
                value={p}
                checked={priority === p}
                onChange={() => setPriority(p)}
                required
              />{" "}
              {p === "routine" ? copy.newReferral.routine : copy.newReferral.urgent}
            </label>
          ))}
        </fieldset>
        {missing && <p className="text-sm text-slate-600">{missing}</p>}
        <button
          type="submit"
          disabled={!!missing || !priority || send.isPending}
          className="rounded bg-accent px-3 py-1.5 text-white disabled:opacity-50"
        >
          {send.isPending ? copy.newReferral.sending : copy.newReferral.send}
        </button>
        {send.error && <ErrorNote error={send.error} />}
        <p className="text-xs text-slate-500">{copy.deliveryNote}</p>
      </form>

      <section aria-labelledby="finder-h">
        <h2 id="finder-h" className="text-lg font-semibold">{copy.newReferral.findPractices}</h2>
        <p className="text-sm text-slate-600">{copy.newReferral.sortNote}</p>
        <p className="mt-1 text-sm font-medium">{copy.telehealthNote}</p>
        {finder.isLoading && <Loading />}
        {finder.error && <ErrorNote error={finder.error} />}
        {finder.data && (
          <>
            <p className="mt-1 text-xs text-slate-500">
              {finder.data.results.length} {copy.newReferral.of} {finder.data.total} {copy.newReferral.shown} ·{" "}
              {copy.distanceBasis}
            </p>
            <ul className="mt-3 space-y-2">
              {finder.data.results.map((p) => (
                <PracticeCard
                  key={p.id}
                  p={p}
                  chosen={p.id === practiceId}
                  onChoose={() => setPracticeId(p.id)}
                  medicareProminent={finder.data!.medicare_prominent}
                />
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
