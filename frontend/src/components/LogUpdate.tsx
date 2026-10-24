import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { copy } from "../copy";
import { ErrorNote } from "./Status";

type Action = keyof typeof copy.logUpdate.actions;
type Source = keyof typeof copy.logUpdate.sources;

// R2.5: the primary real-world input path. Only actions allowed by loop/states.py are offered.
export function LogUpdate({ rid, actions }: { rid: string; actions: string[] }) {
  const qc = useQueryClient();
  const [action, setAction] = useState<Action | "">("");
  const [source, setSource] = useState<Source | "">("");
  const [note, setNote] = useState("");
  const [apptDate, setApptDate] = useState("");
  const [plan, setPlan] = useState({ visit_date: "", assessment: "", plan: "", actions_for_pcp: "", questions_contact: "" });
  const t = copy.logUpdate;

  const m = useMutation({
    mutationFn: () =>
      api.logUpdate(rid, {
        action,
        source,
        note,
        ...(action === "scheduled" ? { appointment_date: apptDate } : {}),
        ...(action === "plan_received"
          ? { plan: { ...plan, visit_date: plan.visit_date || null } }
          : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries();
      setAction("");
      setNote("");
      setApptDate("");
    },
  });

  if (actions.length === 0) return <p className="text-sm text-slate-600">{t.none}</p>;
  const field = "mt-1 block w-full rounded border border-slate-300 px-2 py-1";
  const ready =
    action && source &&
    (action !== "scheduled" || apptDate) &&
    (action !== "plan_received" || (plan.assessment.trim() && plan.plan.trim()));

  return (
    <form
      aria-label={t.title}
      className="space-y-3 rounded border border-slate-200 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) m.mutate();
      }}
    >
      <h2 className="font-semibold">{t.title}</h2>
      <p className="text-xs text-slate-600">{t.help}</p>
      <fieldset className="text-sm">
        <legend>{t.action}</legend>
        <div className="flex flex-wrap gap-3">
          {actions.map((a) => (
            <label key={a}>
              <input type="radio" name="action" value={a} checked={action === a} onChange={() => setAction(a as Action)} />{" "}
              {t.actions[a as Action]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="text-sm">
        <legend>{t.source}</legend>
        <div className="flex flex-wrap gap-3">
          {(Object.keys(t.sources) as Source[]).map((s) => (
            <label key={s}>
              <input type="radio" name="source" value={s} checked={source === s} onChange={() => setSource(s)} />{" "}
              {t.sources[s]}
            </label>
          ))}
        </div>
      </fieldset>
      {action === "scheduled" && (
        <label className="block text-sm">
          {t.appointmentDate}
          <input type="date" className={field} value={apptDate} onChange={(e) => setApptDate(e.target.value)} required />
        </label>
      )}
      {action === "plan_received" && (
        <fieldset className="space-y-2 rounded bg-slate-50 p-2 text-sm">
          <legend className="font-medium">{t.planForm.legend}</legend>
          <label className="block">
            {t.planForm.visitDate}
            <input type="date" className={field} value={plan.visit_date} onChange={(e) => setPlan({ ...plan, visit_date: e.target.value })} />
          </label>
          {([
            ["assessment", t.planForm.assessment],
            ["plan", t.planForm.plan],
            ["actions_for_pcp", t.planForm.actions],
            ["questions_contact", t.planForm.contact],
          ] as const).map(([k, label]) => (
            <label key={k} className="block">
              {label}
              <textarea className={field} rows={2} value={plan[k]} onChange={(e) => setPlan({ ...plan, [k]: e.target.value })} />
            </label>
          ))}
          <p className="text-xs text-slate-500">{t.planForm.omitted}</p>
        </fieldset>
      )}
      <label className="block text-sm">
        {t.note}
        <input className={field} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button type="submit" disabled={!ready || m.isPending} className="rounded bg-accent px-3 py-1 text-white disabled:opacity-50">
        {t.submit}
      </button>
      {m.error && <ErrorNote error={m.error} />}
    </form>
  );
}
