import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type PatientBrief } from "../api";
import { copy } from "../copy";
import { ErrorNote } from "./Status";
import { Button, Field, inputCls } from "./ui";

const COVERAGE = ["medicare", "medicaid", "commercial", "other", "unknown"] as const;
const COVERAGE_LABEL: Record<string, string> = {
  medicare: "Medicare", medicaid: "Medicaid", commercial: "Commercial", other: "Other", unknown: "Unknown",
};

export function AddPatient({ onAdded, onCancel }: { onAdded: (p: PatientBrief) => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const towns = useQuery({ queryKey: ["towns"], queryFn: api.towns, staleTime: Infinity });
  const [name, setName] = useState("");
  const [town, setTown] = useState("");
  const [coverage, setCoverage] = useState<string>("unknown");
  const [dob, setDob] = useState("");
  const t = copy.patientForm;
  const validTown = !!towns.data?.towns.includes(town);
  const add = useMutation({
    mutationFn: () => api.addPatient({ name, town, coverage, dob: dob || null }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["patients"] });
      onAdded(p);
    },
  });

  return (
    <form
      aria-label={t.title}
      className="space-y-3 rounded-lg border border-accent/40 bg-accent-soft/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim() && validTown) add.mutate();
      }}
    >
      <h3 className="text-sm font-semibold">{t.title}</h3>
      <Field label={t.name}>
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required autoComplete="off" />
      </Field>
      <Field label={t.town} hint={town && !validTown ? t.badTown : t.townHelp}>
        <input className={inputCls} list="ma-towns" value={town} onChange={(e) => setTown(e.target.value)} required autoComplete="off" />
        <datalist id="ma-towns">
          {towns.data?.towns.map((x) => <option key={x} value={x} />)}
        </datalist>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.coverage}>
          <select className={inputCls} value={coverage} onChange={(e) => setCoverage(e.target.value)}>
            {COVERAGE.map((c) => <option key={c} value={c}>{COVERAGE_LABEL[c]}</option>)}
          </select>
        </Field>
        <Field label={t.dob}>
          <input type="date" className={inputCls} value={dob} onChange={(e) => setDob(e.target.value)} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button variant="primary" type="submit" disabled={!name.trim() || !validTown || add.isPending}>{t.save}</Button>
        <Button variant="quiet" onClick={onCancel}>{t.cancel}</Button>
      </div>
      {add.error && <ErrorNote error={add.error} />}
    </form>
  );
}
