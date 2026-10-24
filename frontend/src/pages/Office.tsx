import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { copy } from "../copy";
import { LoopStepper } from "../components/LoopStepper";
import { PlanFields, emptyPlan } from "../components/PlanFields";
import { ErrorNote, Loading } from "../components/Status";
import { Button, Field, Num, inputCls } from "../components/ui";

type Action = "accepted" | "declined" | "scheduled" | "seen" | "no_show" | "plan_returned";

// The specialist office's update page. No login: the link is the credential for one referral.
export default function OfficePage() {
  const { token = "" } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["office", token], queryFn: () => api.office(token), retry: false });
  const [action, setAction] = useState<Action | "">("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [plan, setPlan] = useState(emptyPlan);
  const [done, setDone] = useState(false);
  const t = copy.office;

  const act = useMutation({
    mutationFn: (a: Action) => api.officeAct(token, {
      action: a, reason,
      ...(a === "scheduled" ? { appointment_date: date, appointment_time: time } : {}),
      ...(a === "plan_returned" ? { plan: { ...plan, visit_date: plan.visit_date || null } } : {}),
    }),
    onSuccess: (v) => {
      qc.setQueryData(["office", token], v);
      setDone(true); setAction(""); setReason(""); setDate(""); setTime(""); setPlan(emptyPlan);
    },
  });

  const label: Record<Action, string> = {
    accepted: t.accept, declined: t.decline, scheduled: t.schedule, seen: t.seen, no_show: t.noShow, plan_returned: t.returnPlan,
  };

  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-baseline justify-between px-5 py-3">
          <span className="text-lg font-semibold tracking-tight text-accent">{copy.appName}</span>
          <span className="text-xs text-slate-500">{t.title}</span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-4 px-5 py-6">{body}</main>
    </div>
  );

  if (q.isLoading) return shell(<Loading />);
  if (q.error) return shell(<p role="alert" className="rounded-lg border border-slate-200 bg-white p-6">{t.invalid}</p>);
  const v = q.data!;
  const ready = action && (action !== "declined" || reason.trim()) && (action !== "scheduled" || (date && time)) &&
    (action !== "plan_returned" || (plan.assessment.trim() && plan.plan.trim()));

  return shell(
    <>
      {v.sample && <p className="rounded-md bg-amber-50 px-3 py-1.5 text-sm text-amber-900">{t.sample}</p>}
      <p className="text-sm text-slate-700">{t.intro(v.from.practice)}</p>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-lg font-semibold">{v.specialty} · {v.patient.name}</h1>
          <span className="text-sm text-slate-600" data-testid="office-status">{t.status}: <span className="font-medium">{v.stage_label}</span></span>
        </div>
        <LoopStepper steps={v.stepper} />
        <dl className="mt-4 grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-slate-500">{t.patient}</dt><dd>{v.patient.name}</dd>
          <dt className="text-slate-500">{t.dob}</dt><dd><Num>{v.patient.dob ?? "—"}</Num></dd>
          <dt className="text-slate-500">{t.town}</dt><dd>{v.patient.town}</dd>
          <dt className="text-slate-500">{t.condition}</dt><dd>{v.condition}</dd>
          <dt className="text-slate-500">{t.reason}</dt><dd>{v.reason_text}</dd>
          <dt className="text-slate-500">{t.priority}</dt><dd className="capitalize">{v.priority}</dd>
          <dt className="text-slate-500">{t.from}</dt><dd>{v.from.clinician}, {v.from.practice}</dd>
          <dt className="text-slate-500">{t.contact}</dt><dd>{v.from.coordinator}</dd>
          {v.appointment && (<><dt className="text-slate-500">{t.appointment}</dt><dd><Num>{v.appointment.start}{v.appointment.time ? ` ${v.appointment.time}` : ""}</Num></dd></>)}
        </dl>
      </section>

      {done && <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{t.done}</p>}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        {v.actions.length === 0 ? (
          <p className="text-sm text-slate-600">{t.noActions}</p>
        ) : (
          <form aria-label={t.title} className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready && action) act.mutate(action); }}>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t.status}>
              {(v.actions as Action[]).map((a) => (
                <button
                  key={a} type="button" role="radio" aria-checked={action === a}
                  onClick={() => { setAction(a); setDone(false); }}
                  className={`rounded-md border px-3 py-1.5 text-sm font-medium ${action === a ? "border-accent bg-accent text-white" : "border-slate-300 bg-white hover:border-accent"}`}
                >
                  {label[a]}
                </button>
              ))}
            </div>
            {action === "declined" && (
              <Field label={t.declineReason}><textarea className={inputCls} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required /></Field>
            )}
            {action === "scheduled" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label={t.date}><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
                <Field label={t.time}><input type="time" className={inputCls} value={time} onChange={(e) => setTime(e.target.value)} required /></Field>
              </div>
            )}
            {action === "plan_returned" && <PlanFields value={plan} onChange={setPlan} />}
            {action && <Button variant="primary" type="submit" disabled={!ready || act.isPending}>{t.submit}</Button>}
            {act.error && <ErrorNote error={act.error} />}
          </form>
        )}
      </section>

      <details className="text-sm text-slate-600">
        <summary className="cursor-pointer">{t.history}</summary>
        <ul className="mt-2 space-y-0.5">
          {v.history.map((h, i) => <li key={i}><Num>{h.at}</Num> · {h.label}</li>)}
        </ul>
      </details>
      <p className="text-xs text-slate-500">{t.privacy}</p>
    </>,
  );
}
