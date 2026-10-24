import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { copy } from "../copy";
import { shortDate, time12 } from "../format";
import { Wordmark } from "../App";
import { ActionFields, actionReady, emptyAction, toBody, type ActionState } from "../components/UpdateForm";
import { ErrorNote, Loading } from "../components/Status";
import { Field, btn, inputCls } from "../components/ui";

// For specialist office staff on a phone: no rail, no app chrome, no login. The link is the
// credential for one referral.
export default function OfficePage() {
  const { token = "" } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["office", token], queryFn: () => api.office(token), retry: false });
  const [action, setAction] = useState("");
  const [state, setState] = useState<ActionState>(emptyAction);
  const [done, setDone] = useState("");
  const t = copy.office;
  const labels = copy.update.actions;

  const act = useMutation({
    mutationFn: () => api.officeAct(token, toBody(action, state)),
    onSuccess: (v) => {
      qc.setQueryData(["office", token], v);
      setDone(labels[action]); setAction(""); setState(emptyAction);
    },
  });

  const shell = (body: ReactNode) => (
    <div className="min-h-screen bg-paper">
      <main className="mx-auto max-w-md space-y-6 px-6 py-8">
        <Wordmark color="#1F5F5B" />
        {body}
      </main>
    </div>
  );
  if (q.isLoading) return shell(<Loading />);
  if (q.error) return shell(<p role="alert">{t.invalid}</p>);
  const v = q.data!;
  const ready = actionReady(action, state, true);

  return shell(
    <>
      <div>
        <h1 className="text-page font-bold">{t.title(v.specialty)}</h1>
        <p className="text-muted">{t.from(v.from.practice)}</p>
        {v.sample && <p className="mt-1 text-caption text-muted">{t.sample}</p>}
      </div>

      <dl className="space-y-2 rounded-panel border border-line bg-surface p-6">
        <div className="flex justify-between gap-3"><dt className="text-muted">{t.patient}</dt><dd className="text-right font-semibold">{v.patient.name}</dd></div>
        {v.patient.dob && <div className="flex justify-between gap-3"><dt className="text-muted">{t.dob}</dt><dd>{shortDate(v.patient.dob)}, {v.patient.dob.slice(0, 4)}</dd></div>}
        <div className="flex justify-between gap-3"><dt className="text-muted">{t.reason}</dt><dd className="text-right">{v.reason_text}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted">{t.status}</dt><dd className="text-right font-semibold" data-testid="office-status">{v.status_label}</dd></div>
        {v.appointment && <div className="flex justify-between gap-3"><dt className="text-muted">{copy.update.actions.scheduled}</dt><dd>{shortDate(v.appointment.start)}{v.appointment.time ? `, ${time12(v.appointment.time)}` : ""}</dd></div>}
      </dl>

      {done && <p role="status" className="text-hemlock" data-testid="office-done">{t.done(done)}</p>}

      {v.actions.length === 0 ? <p className="text-muted">{t.noActions}</p> : (
        <form aria-label={t.choose} className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) act.mutate(); }}>
          <div className="space-y-2" role="radiogroup" aria-label={t.choose}>
            {v.actions.map((a) => (
              <div key={a}>
                <button type="button" role="radio" aria-checked={action === a}
                  onClick={() => { setAction(a); setState(emptyAction); setDone(""); }}
                  className={`w-full rounded-tile border px-[14px] py-[14px] text-left font-semibold ${action === a ? "border-hemlock bg-hemlock-tint text-hemlock" : "border-line bg-surface text-ink hover:border-hemlock"}`}>
                  {labels[a]}
                </button>
                {action === a && (
                  <div className="space-y-3 px-1 pt-3">
                    <ActionFields action={a} state={state} set={setState} />
                    {(a === "declined" || a === "missing") && (
                      <Field label={a === "declined" ? copy.update.reason : copy.update.note}>
                        <textarea className={inputCls} rows={2} value={state.note} onChange={(e) => setState({ ...state, note: e.target.value })} />
                      </Field>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <button type="submit" className={btn("primary", "w-full")} disabled={!ready || act.isPending}>{t.send}</button>
          {act.error && <ErrorNote error={act.error} />}
        </form>
      )}
      <p className="text-caption text-muted">{t.privacy}</p>
    </>,
  );
}
