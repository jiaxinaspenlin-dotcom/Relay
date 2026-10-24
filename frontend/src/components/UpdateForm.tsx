import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type UpdateBody } from "../api";
import { copy } from "../copy";
import { PlanFields, emptyPlan, type PlanState } from "./PlanFields";
import { ErrorNote } from "./Status";
import { Button, Field, inputCls } from "./ui";

export type UpdatePrefill = {
  action: string;
  missing?: string[];
  contact_mode?: string;
  note?: string;
  phone?: string | null;
  fromAi?: boolean;
};

const MISSING = ["records", "insurance_authorization", "test_results", "other"];

/** Inputs that depend on the chosen action (shared by Log update and the office link page). */
export function ActionFields({ action, state, set }: { action: string; state: ActionState; set: (s: ActionState) => void }) {
  const t = copy.update;
  const radio = "flex min-h-[40px] items-center gap-2";
  if (action === "missing") {
    return (
      <fieldset>
        <legend className="font-semibold">{t.actions.missing}</legend>
        {MISSING.map((m) => (
          <label key={m} className={radio}>
            <input type="checkbox" className="h-4 w-4 accent-hemlock" checked={state.missing.includes(m)}
              onChange={(e) => set({ ...state, missing: e.target.checked ? [...state.missing, m] : state.missing.filter((x) => x !== m) })} />
            {t.missingItems[m]}
          </label>
        ))}
      </fieldset>
    );
  }
  if (action === "authorization") {
    return (
      <fieldset>
        <legend className="font-semibold">{t.actions.authorization}</legend>
        {Object.entries(t.auth).map(([k, label]) => (
          <label key={k} className={radio}>
            <input type="radio" name="auth" className="h-4 w-4 accent-hemlock" checked={state.authorization === k} onChange={() => set({ ...state, authorization: k })} />
            {label}
          </label>
        ))}
      </fieldset>
    );
  }
  if (action === "patient_contacted") {
    return (
      <fieldset>
        <legend className="font-semibold">{t.actions.patient_contacted}</legend>
        {Object.entries(t.contact).map(([k, label]) => (
          <label key={k} className={radio}>
            <input type="radio" name="contact" className="h-4 w-4 accent-hemlock" checked={state.contact_mode === k} onChange={() => set({ ...state, contact_mode: k })} />
            {label}
          </label>
        ))}
      </fieldset>
    );
  }
  if (action === "scheduled") {
    return (
      <div className="grid grid-cols-2 gap-3">
        <Field label={t.date}><input type="date" className={inputCls} value={state.date} onChange={(e) => set({ ...state, date: e.target.value })} required /></Field>
        <Field label={t.time}><input type="time" className={inputCls} value={state.time} onChange={(e) => set({ ...state, time: e.target.value })} /></Field>
      </div>
    );
  }
  if (action === "plan_returned") return <PlanFields value={state.plan} onChange={(plan) => set({ ...state, plan })} />;
  return null;
}

export type ActionState = { missing: string[]; authorization: string; contact_mode: string; date: string; time: string; note: string; plan: PlanState };
export const emptyAction: ActionState = { missing: [], authorization: "", contact_mode: "", date: "", time: "", note: "", plan: emptyPlan };

export function actionReady(action: string, s: ActionState, requireTime = false): boolean {
  if (!action) return false;
  if (action === "missing") return s.missing.length > 0;
  if (action === "authorization") return !!s.authorization;
  if (action === "patient_contacted") return !!s.contact_mode;
  if (action === "scheduled") return !!s.date && (!requireTime || !!s.time);
  if (action === "declined") return !!s.note.trim();
  if (action === "plan_returned") return !!s.plan.assessment.trim() && !!s.plan.plan.trim();
  return true;
}

export function toBody(action: string, s: ActionState): UpdateBody {
  return {
    action,
    note: s.note,
    ...(action === "missing" ? { missing: s.missing } : {}),
    ...(action === "authorization" ? { authorization: s.authorization } : {}),
    ...(action === "patient_contacted" ? { contact_mode: s.contact_mode } : {}),
    ...(action === "scheduled" ? { appointment_date: s.date, appointment_time: s.time || null } : {}),
    ...(action === "plan_returned" ? { plan: { ...s.plan, visit_date: s.plan.visit_date || null } } : {}),
  };
}

// Coordinator Log update: what the office said by phone, fax, or another way (or an AI call
// suggestion the coordinator confirms). Only allowed actions are offered.
export function UpdateForm({ rid, actions, prefill, officePhone, onDone }: {
  rid: string; actions: string[]; prefill?: UpdatePrefill | null; officePhone?: string; onDone?: () => void;
}) {
  const qc = useQueryClient();
  const t = copy.update;
  const [action, setAction] = useState("");
  const [source, setSource] = useState("");
  const [state, setState] = useState<ActionState>(emptyAction);
  useEffect(() => {
    if (!prefill) return;
    setAction(prefill.action);
    setSource(prefill.fromAi ? "ai_call" : "");
    setState({ ...emptyAction, missing: prefill.missing ?? [], contact_mode: prefill.contact_mode ?? "", note: prefill.note ?? "" });
  }, [prefill]);

  const save = useMutation({
    mutationFn: async () => {
      const d = await api.logUpdate(rid, { ...toBody(action, state), source });
      if (prefill?.phone && !officePhone) await api.setOfficePhone(rid, prefill.phone);
      return d;
    },
    onSuccess: () => { qc.invalidateQueries(); setAction(""); setState(emptyAction); onDone?.(); },
  });
  const ready = actionReady(action, state) && !!source;

  return (
    <form aria-label={t.title} className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (ready) save.mutate(); }}>
      {prefill?.fromAi && <p className="rounded-control bg-hemlock-tint px-3 py-2 text-caption font-semibold text-hemlock">{t.ai}</p>}
      <Field label={copy.update.title}>
        <select className={inputCls} value={action} onChange={(e) => { setAction(e.target.value); setState(emptyAction); }}>
          <option value="">Choose</option>
          {actions.map((a) => <option key={a} value={a}>{t.actions[a]}</option>)}
        </select>
      </Field>
      {action && <ActionFields action={action} state={state} set={setState} />}
      {action && (
        <Field label={action === "declined" ? t.reason : t.note}>
          <input className={inputCls} value={state.note} onChange={(e) => setState({ ...state, note: e.target.value })} />
        </Field>
      )}
      {source === "ai_call" ? null : (
        <fieldset>
          <legend className="font-semibold">{t.source}</legend>
          <div className="flex flex-wrap gap-x-5">
            {Object.entries(t.sources).map(([k, label]) => (
              <label key={k} className="flex min-h-[40px] items-center gap-2">
                <input type="radio" name="source" className="h-4 w-4 accent-hemlock" checked={source === k} onChange={() => setSource(k)} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <Button variant="primary" type="submit" disabled={!ready || save.isPending}>{t.save}</Button>
      {save.error && <ErrorNote error={save.error} />}
    </form>
  );
}
