import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { copy } from "../copy";
import { FollowUp } from "../components/FollowUp";
import { LogUpdate } from "../components/LogUpdate";
import { LoopStepper } from "../components/LoopStepper";
import { PlaceContext } from "../components/PlaceContext";
import { StageBadge } from "../components/StageBadge";
import { ErrorNote, Loading } from "../components/Status";
import { Timeline } from "../components/Timeline";

export default function ReferralDetail() {
  const { rid = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const showFollowUp = params.get("followup") === "1";
  const [, force] = useState(0);
  const q = useQuery({ queryKey: ["referral", rid], queryFn: () => api.referral(rid) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <div className="p-6"><ErrorNote error={q.error} /></div>;
  const d = q.data!;
  const c = d.card;
  const r = d.referral;
  const toggleFollowUp = (on: boolean) => {
    setParams(on ? { followup: "1" } : {});
    force((n) => n + 1);
  };

  return (
    <div className="space-y-6 p-6">
      <Link to="/" className="text-sm text-accent underline">{copy.detail.back}</Link>
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-mono text-xl font-semibold">{c.id}</h1>
          <StageBadge stage={c.stage} label={c.stage_label} />
          <span>{c.patient.synthetic_name} ({copy.synthetic}) · {c.patient.town} · {c.patient.payer}</span>
        </div>
        <LoopStepper steps={c.stepper} />
        {c.stuck.length > 0 && (
          <div className="rounded border border-amber-300 bg-amber-50/40 p-2 text-sm" data-testid="stuck-now">
            <span className="font-medium">{copy.detail.stuckNow}:</span>
            <ul>
              {c.stuck.map((f) => (
                <li key={f.rule + f.message}>
                  {f.message} <span className="text-xs text-slate-500">({copy.practiceSetting}: {f.threshold} {f.unit})</span>
                </li>
              ))}
            </ul>
            {!showFollowUp && (
              <button type="button" onClick={() => toggleFollowUp(true)} className="mt-1 rounded bg-accent px-2 py-1 text-white">
                {copy.dashboard.draftFollowUp}
              </button>
            )}
          </div>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          {showFollowUp && c.stuck.length > 0 && <FollowUp rid={rid} onClose={() => toggleFollowUp(false)} />}
          <LogUpdate rid={rid} actions={d.log_update_actions} />
          <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-slate-600">{copy.detail.reason}</dt><dd>{r.reason_text}</dd>
            <dt className="text-slate-600">{copy.detail.condition}</dt><dd>{r.reason_condition.display}</dd>
            <dt className="text-slate-600">{copy.newReferral.priority}</dt><dd>{r.priority}</dd>
            <dt className="text-slate-600">{copy.detail.performer}</dt>
            <dd>
              {r.performer.name} · {r.performer.town}
              {c.miles !== null && <> · <span className="font-mono">{c.miles}</span> {copy.milesUnit}</>}
              <span className="ml-1 text-xs text-slate-500">({r.performer.fictional ? copy.fictional : copy.directory})</span>
            </dd>
            {c.appointment && (<><dt className="text-slate-600">{copy.detail.appointment}</dt><dd className="font-mono">{c.appointment.start} ({c.appointment.status})</dd></>)}
            {c.open_barriers.length > 0 && (<><dt className="text-slate-600">{copy.detail.barriers}</dt><dd>{c.open_barriers.map((b) => b.label).join(", ")}</dd></>)}
          </dl>
          <section aria-labelledby="tl-h">
            <h2 id="tl-h" className="mb-2 font-semibold">{copy.detail.timeline}</h2>
            <Timeline items={d.timeline} />
          </section>
          <a href={api.fhirUrl(rid)} download className="inline-block rounded border border-accent px-3 py-1 text-sm text-accent">
            {copy.detail.downloadFhir}
          </a>
        </div>
        <PlaceContext items={d.place_context.items} />
      </div>
    </div>
  );
}
