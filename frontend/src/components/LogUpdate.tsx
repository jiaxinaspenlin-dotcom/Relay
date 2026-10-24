import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { copy } from "../copy";
import { PlanFields, emptyPlan } from "./PlanFields";
import { ErrorNote } from "./Status";
import { Button, Field, Panel, inputCls } from "./ui";

type Action = keyof typeof copy.logUpdate.actions;
type Source = keyof typeof copy.logUpdate.sources;

// R2.5: the coordinator records what the office reported by phone, fax, or another way.
// Only actions allowed by loop/states.py are offered.
export function LogUpdate({ rid, actions }: { rid: string; actions: string[] }) {
  const qc = useQueryClient();
  const [action, setAction] = useState<Action | "">("");
  const [source, setSource] = useState<Source | "">("");
  const [note, setNote] = useState("");
  const [apptDate, setApptDate] = useState("");
  const [apptTime, setApptTime] = useState("");
  const [plan, setPlan] = useState(emptyPlan);
  const t = copy.logUpdate;

  const m = useMutation({
    mutationFn: () => api.logUpdate(rid, {
      action, source, note,
      ...(action === "scheduled" ? { appointment_date: apptDate, appointment_time: apptTime || null } : {}),
      ...(action === "plan_received" ? { plan: { ...plan, visit_date: plan.visit_date || null } } : {}),
    }),
    onSuccess: () => {
      qc.invalidateQueries();
      setAction(""); setNote(""); setApptDate(""); setApptTime(""); setPlan(emptyPlan);
    },
  });

  if (actions.length === 0) return null;
  const ready = action && source && (action !== "scheduled" || apptDate) &&
    (action !== "plan_received" || (plan.assessment.trim() && plan.plan.trim()));

  return (
    <Panel title={t.title} id="log-h">
      <form aria-label={t.title} className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) m.mutate(); }}>
        <p className="text-xs text-slate-500">{t.help}</p>
        <fieldset className="text-sm">
          <legend className="text-slate-700">{t.action}</legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {actions.map((a) => (
              <label key={a} className="flex items-center gap-1">
                <input type="radio" name="action" value={a} checked={action === a} onChange={() => setAction(a as Action)} />
                {t.actions[a as Action]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="text-sm">
          <legend className="text-slate-700">{t.source}</legend>
          <div className="mt-1 flex flex-wrap gap-x-4">
            {(Object.keys(t.sources) as Source[]).map((s) => (
              <label key={s} className="flex items-center gap-1">
                <input type="radio" name="source" value={s} checked={source === s} onChange={() => setSource(s)} />
                {t.sources[s]}
              </label>
            ))}
          </div>
        </fieldset>
        {action === "scheduled" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t.appointmentDate}><input type="date" className={inputCls} value={apptDate} onChange={(e) => setApptDate(e.target.value)} required /></Field>
            <Field label={t.appointmentTime}><input type="time" className={inputCls} value={apptTime} onChange={(e) => setApptTime(e.target.value)} /></Field>
          </div>
        )}
        {action === "plan_received" && <PlanFields value={plan} onChange={setPlan} />}
        <Field label={t.note}><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Button variant="primary" type="submit" disabled={!ready || m.isPending}>{t.submit}</Button>
        {m.error && <ErrorNote error={m.error} />}
      </form>
    </Panel>
  );
}
