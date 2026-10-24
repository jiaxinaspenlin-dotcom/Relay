import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { copy } from "../copy";
import { FAILURE_RULES, routeLine, shortDate, time12 } from "../format";
import { FollowUp } from "../components/FollowUp";
import { LogUpdate } from "../components/LogUpdate";
import { PlaceContext } from "../components/PlaceContext";
import { RouteTrack } from "../components/RouteTrack";
import { SendPanel } from "../components/SendPanel";
import { ErrorNote, Loading } from "../components/Status";
import { Timeline } from "../components/Timeline";
import { Button, Chip, Muted, Panel, SampleTag } from "../components/ui";

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
  const failure = c.stuck.some((f) => FAILURE_RULES.has(f.rule));
  const t = copy.detail;
  const appt = c.appointment;

  return (
    <div className="space-y-5">
      <Link to="/" className="inline-flex min-h-[40px] items-center text-hemlock hover:underline">{t.back}</Link>

      <header className="space-y-4 rounded-panel border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-page font-bold">{c.patient.name}</h1>
              <SampleTag show={c.sample} />
            </div>
            <p className="text-muted">
              {c.specialty} referral {c.id}. {routeLine(c.patient.town, c.performer.town, c.miles)}. {c.stage_label}.
            </p>
          </div>
          {stuck && !showFollowUp && <Button onClick={() => setParams({ followup: "1" })}>{copy.dashboard.draftFollowUp}</Button>}
        </div>
        <RouteTrack steps={c.stepper} flags={c.stuck} size="lg" />
        {stuck && (
          <p data-testid="stuck-now" className={`font-semibold ${failure ? "text-rust" : "text-amber"}`}>
            {c.stuck.map((f) => f.message.replace(" — ", ", ") + ".").join(" ")}
          </p>
        )}
      </header>

      {showFollowUp && <FollowUp rid={rid} onClose={() => setParams({})} />}
      {d.can_send && c.stage === "draft" && <SendPanel rid={rid} stage={c.stage} officePath={d.office_path} />}

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-5">
          <Panel title={t.timeline} id="tl-h" actions={
            <a href={api.fhirUrl(rid)} download className="inline-flex min-h-[40px] items-center text-hemlock hover:underline">{t.downloadFhir}</a>
          }>
            <Timeline items={d.timeline} />
          </Panel>
          <Panel title={t.referral} id="ref-h">
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2">
              <dt className="text-muted">{t.performer}</dt>
              <dd>
                {r.performer.name} {r.performer.fictional && <span className="text-muted">{copy.fictional}</span>}
                <div className="text-caption text-muted">{r.performer.address ? `${r.performer.address}, ` : ""}{r.performer.town}</div>
              </dd>
              <dt className="text-muted">{t.condition}</dt><dd>{r.reason_condition.display}</dd>
              <dt className="text-muted">{t.reason}</dt><dd>{r.reason_text}</dd>
              <dt className="text-muted">{t.priority}</dt><dd className="capitalize">{r.priority}</dd>
              {appt && (<><dt className="text-muted">{t.appointment}</dt><dd>{shortDate(appt.start)}{appt.time ? `, ${time12(appt.time)}` : ""} ({appt.status})</dd></>)}
            </dl>
          </Panel>
          {d.can_send && c.stage !== "draft" && <SendPanel rid={rid} stage={c.stage} officePath={d.office_path} />}
        </div>
        <div className="space-y-5">
          <LogUpdate rid={rid} actions={d.log_update_actions} />
          <Panel title={t.barriers} id="bar-h">
            {c.open_barriers.length === 0
              ? <Muted>{t.noBarriers}</Muted>
              : <div className="flex flex-wrap gap-2">{c.open_barriers.map((b) => <Chip key={b.type}>{b.label}, open since {shortDate(b.opened)}</Chip>)}</div>}
          </Panel>
          <PlaceContext items={d.place_context.items} town={d.place_context.town} />
        </div>
      </div>
    </div>
  );
}
