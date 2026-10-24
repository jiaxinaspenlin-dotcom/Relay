import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { copy } from "../copy";
import { FollowUp } from "../components/FollowUp";
import { LogUpdate } from "../components/LogUpdate";
import { LoopStepper } from "../components/LoopStepper";
import { PlaceContext } from "../components/PlaceContext";
import { SendPanel } from "../components/SendPanel";
import { ErrorNote, Loading } from "../components/Status";
import { Timeline } from "../components/Timeline";
import { Button, Num, Panel, SampleTag, StageBadge } from "../components/ui";

export default function ReferralDetail() {
  const { rid = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ["referral", rid], queryFn: () => api.referral(rid) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const d = q.data!;
  const c = d.card;
  const r = d.referral;
  const stuck = c.stuck.length > 0;
  const showFollowUp = params.get("followup") === "1" && stuck;
  const t = copy.detail;
  const appt = c.appointment;

  return (
    <div className="space-y-5">
      <Link to="/" className="text-sm text-accent hover:underline">← {t.back}</Link>

      <header className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold"><Num>{c.id}</Num> · {c.patient.name}</h1>
            <StageBadge stage={c.stage} label={c.stage_label} />
            <SampleTag show={c.sample} />
          </div>
          <div className="text-sm text-slate-600">
            {c.patient.town} · {c.patient.coverage_label}{c.patient.dob && <> · DOB <Num>{c.patient.dob}</Num></>}
          </div>
        </div>
        <LoopStepper steps={c.stepper} stuck={stuck} />
        {stuck && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm" data-testid="stuck-now">
            <ul>
              {c.stuck.map((f) => (
                <li key={f.rule + f.message}>
                  <span className="font-medium text-amber-900">{f.message}</span>{" "}
                  <span className="text-xs text-slate-500">({copy.practiceSetting}: {f.threshold} {f.unit})</span>
                </li>
              ))}
            </ul>
            {!showFollowUp && <Button variant="primary" onClick={() => setParams({ followup: "1" })}>{copy.dashboard.draftFollowUp}</Button>}
          </div>
        )}
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          {showFollowUp && <FollowUp rid={rid} onClose={() => setParams({})} />}
          {d.can_send && <SendPanel rid={rid} stage={c.stage} officePath={d.office_path} />}

          <Panel title={t.referral} id="ref-facts-h">
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-slate-500">{t.performer}</dt>
              <dd>
                {r.performer.name}{r.performer.address ? `, ${r.performer.address}` : ""}, {r.performer.town}
                {c.miles !== null && <> · {c.miles === 0 ? `in ${c.patient.town}` : <><Num>{c.miles}</Num> {copy.milesUnit} straight-line</>}</>}
                <span className="ml-1 text-xs text-slate-500">({r.performer.fictional ? copy.fictional : copy.directory})</span>
              </dd>
              <dt className="text-slate-500">{t.condition}</dt><dd>{r.reason_condition.display}</dd>
              <dt className="text-slate-500">{t.reason}</dt><dd>{r.reason_text}</dd>
              <dt className="text-slate-500">{t.priority}</dt><dd className="capitalize">{r.priority}</dd>
              {appt && (<><dt className="text-slate-500">{t.appointment}</dt><dd><Num>{appt.start}{appt.time ? ` ${appt.time}` : ""}</Num> ({appt.status})</dd></>)}
              {c.open_barriers.length > 0 && (<><dt className="text-slate-500">{t.barriers}</dt><dd>{c.open_barriers.map((b) => b.label).join(", ")}</dd></>)}
            </dl>
          </Panel>

          <LogUpdate rid={rid} actions={d.log_update_actions} />

          <Panel title={t.timeline} id="tl-h" actions={
            <a href={api.fhirUrl(rid)} download className="text-sm font-medium text-accent hover:underline">{t.downloadFhir}</a>
          }>
            <Timeline items={d.timeline} />
          </Panel>
        </div>
        <PlaceContext items={d.place_context.items} town={d.place_context.town} />
      </div>
    </div>
  );
}
