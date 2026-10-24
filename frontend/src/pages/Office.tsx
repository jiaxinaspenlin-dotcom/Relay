import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { copy } from "../copy";
import { shortDate, time12 } from "../format";
import { Wordmark } from "../App";
import { PlanFields, emptyPlan } from "../components/PlanFields";
import { RouteTrack } from "../components/RouteTrack";
import { ErrorNote, Loading } from "../components/Status";
import { Button, Field, Muted, inputCls } from "../components/ui";

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

  const shell = (body: ReactNode) => (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-3">
          <Wordmark />
          <span className="text-caption text-muted">{t.title}</span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-5 px-5 py-6">{body}</main>
    </div>
  );

  if (q.isLoading) return shell(<Loading />);
  if (q.error) return shell(<p role="alert" className="rounded-panel border border-line bg-surface p-6">{t.invalid}</p>);
  const v = q.data!;
  const ready = action && (action !== "declined" || reason.trim()) && (action !== "scheduled" || (date && time)) &&
    (action !== "plan_returned" || (plan.assessment.trim() && plan.plan.trim()));
  const row = (k: string, val: ReactNode) => (<><dt className="text-muted">{k}</dt><dd>{val}</dd></>);

  return shell(
    <>
      {v.sample && <p className="rounded-control border border-line bg-surface px-3 py-2 text-caption text-muted">{t.sample}</p>}
      <p>{t.intro(v.from.practice)}</p>

      <section className="space-y-4 rounded-panel border border-line bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-section font-semibold">{v.specialty} referral for {v.patient.name}</h1>
          <span className="text-caption text-muted" data-testid="office-status">{t.status}: <span className="font-semibold text-ink">{v.stage_label}</span></span>
        </div>
        <RouteTrack steps={v.stepper} />
        <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2">
          {row(t.patient, v.patient.name)}
          {row(t.dob, v.patient.dob ? shortDate(v.patient.dob) + `, ${v.patient.dob.slice(0, 4)}` : "Not recorded")}
          {row(t.town, v.patient.town)}
          {row(t.condition, v.condition)}
          {row(t.reason, v.reason_text)}
          {row(t.priority, <span className="capitalize">{v.priority}</span>)}
          {row(t.from, `${v.from.clinician}, ${v.from.practice}`)}
          {row(t.contact, v.from.coordinator)}
          {v.appointment && row(t.appointment, `${shortDate(v.appointment.start)}${v.appointment.time ? `, ${time12(v.appointment.time)}` : ""}`)}
        </dl>
      </section>

      {done && <p role="status" className="rounded-control bg-hemlock-tint px-3 py-2 text-hemlock">{t.done}</p>}

      <section className="rounded-panel border border-line bg-surface p-5">
        {v.actions.length === 0 ? <p className="text-muted">{t.noActions}</p> : (
          <form aria-label={t.title} className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (ready && action) act.mutate(action); }}>
            <fieldset>
              <legend className="mb-2 font-semibold">{t.choose}</legend>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t.choose}>
                {(v.actions as Action[]).map((a) => (
                  <button
                    key={a} type="button" role="radio" aria-checked={action === a}
                    onClick={() => { setAction(a); setDone(false); }}
                    className={`min-h-[40px] rounded-control border px-4 font-semibold ${action === a ? "border-hemlock bg-hemlock-tint text-hemlock" : "border-line bg-surface text-ink hover:border-hemlock"}`}
                  >
                    {label[a]}
                  </button>
                ))}
              </div>
            </fieldset>
            {action === "declined" && <Field label={t.declineReason}><textarea className={inputCls} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required /></Field>}
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

      <details>
        <summary className="cursor-pointer text-hemlock">{t.history}</summary>
        <ol className="mt-2 space-y-1">
          {v.history.map((h, i) => <li key={i} className="grid grid-cols-[4rem_1fr]"><span className="text-caption text-muted">{shortDate(h.at)}</span>{h.label}</li>)}
        </ol>
      </details>
      <Muted>{t.privacy}</Muted>
    </>,
  );
}
