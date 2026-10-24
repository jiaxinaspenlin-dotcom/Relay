import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { copy } from "../copy";
import { PlanFields, emptyPlan } from "./PlanFields";
import { ErrorNote } from "./Status";
import { Button, Field, Muted, Panel, inputCls } from "./ui";

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
  const radio = "flex min-h-[40px] items-center gap-2";

  return (
    <Panel title={t.title} id="log-h">
      <form aria-label={t.title} className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) m.mutate(); }}>
        <Muted>{t.help}</Muted>
        <fieldset>
          <legend className="font-semibold">{t.action}</legend>
          <div className="flex flex-wrap gap-x-4">
            {actions.map((a) => (
              <label key={a} className={radio}>
                <input type="radio" name="action" value={a} checked={action === a} onChange={() => setAction(a as Action)} className="h-4 w-4 accent-hemlock" />
                {t.actions[a as Action]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="font-semibold">{t.source}</legend>
          <div className="flex flex-wrap gap-x-4">
            {(Object.keys(t.sources) as Source[]).map((s) => (
              <label key={s} className={radio}>
                <input type="radio" name="source" value={s} checked={source === s} onChange={() => setSource(s)} className="h-4 w-4 accent-hemlock" />
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
        <Button variant="outline" type="submit" disabled={!ready || m.isPending}>{t.submit}</Button>
        {m.error && <ErrorNote error={m.error} />}
      </form>
    </Panel>
  );
}
