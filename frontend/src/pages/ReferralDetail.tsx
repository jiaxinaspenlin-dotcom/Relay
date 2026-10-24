import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { LIVE, api, type Detail } from "../api";
import { copy } from "../copy";
import { FAILURE_RULES } from "../format";
import { ActionDrawers, useCallKind, type DrawerState } from "../components/ActionDrawers";
import { RouteTrack, primaryFlag } from "../components/RouteTrack";
import { SendButtons } from "../components/SendButtons";
import { copyText } from "../components/sendActions";
import { ErrorNote, Loading } from "../components/Status";
import { Timeline } from "../components/Timeline";
import { Button, Chip, Field, Muted, Panel, SampleTag, btn, inputCls } from "../components/ui";
import { useMe } from "../components/useMe";
import { CallPanel, useCallMode, useCallOffice } from "../components/OfficeCall";

function SendPanel({ d }: { d: Detail }) {
  const qc = useQueryClient();
  const rid = d.card.id;
  const msg = useQuery({ queryKey: ["message", rid], queryFn: () => api.referralMessage(rid) });
  const send = useMutation({
    mutationFn: async (c: "copy" | "email" | "print") => (await api.sendReferral(rid, c)).communication_id,
    onSuccess: () => qc.invalidateQueries(),
  });
  const draft = d.card.stage === "draft";
  // After an AI call where the office said it never got the referral, this is the next step.
  const resend = d.card.stuck.some((f) => f.rule === "office_not_received");
  return (
    <Panel title={draft ? copy.send.draftTitle : resend ? copy.dashboard.actions.resend : copy.send.sendAgain} id="send-h"
      className={draft || resend ? "border-hemlock" : ""}>
      {draft && <p className="mb-3">{copy.send.draftNote}</p>}
      <SendButtons rid={rid} subject={msg.data?.subject ?? ""} text={msg.data?.text ?? ""} primary={draft ? "copy" : null}
        disabled={!msg.data || send.isPending} send={(c) => send.mutateAsync(c)} />
      <Muted className="mt-3 block">{copy.delivery}</Muted>
    </Panel>
  );
}

function OfficeLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}${path}`;
  return (
    <div className="border-t border-line pt-4">
      <div className="font-semibold">{copy.send.officeLink}</div>
      <a href={path} target="_blank" rel="noreferrer" data-testid="office-link" className="mt-1 block break-all text-caption text-hemlock underline">{url}</a>
      <div className="mt-1 flex items-center gap-2">
        <Button variant="quiet" onClick={async () => setCopied(await copyText(url))}>{copied ? copy.send.copied : copy.send.copyLink}</Button>
      </div>
      <Muted>{copy.send.officeLinkHelp}</Muted>
    </div>
  );
}

function BarrierForm({ rid, onDone }: { rid: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState("transportation");
  const [note, setNote] = useState("");
  const add = useMutation({ mutationFn: () => api.addBarrier(rid, type, note), onSuccess: () => { qc.invalidateQueries(); onDone(); } });
  return (
    <form aria-label={copy.detail.logBarrier} className="space-y-3 rounded-control border border-line p-4" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
      <Field label={copy.detail.barrierType}>
        <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(copy.barrierTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label={copy.detail.barrierNote}><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <Button variant="primary" type="submit" disabled={add.isPending}>{copy.detail.addBarrier}</Button>
      {add.error && <ErrorNote error={add.error} />}
    </form>
  );
}

function Transport({ d }: { d: Detail }) {
  const qc = useQueryClient();
  const tr = d.transport;
  const [plan, setPlan] = useState(tr.transport_plan);
  const set = useMutation({ mutationFn: (body: { pt1_status?: string; transport_plan?: string }) => api.setTransport(d.card.id, body), onSuccess: () => qc.invalidateQueries() });
  const t = copy.detail;
  if (!tr.show_pt1 && !tr.show_plan_note) return null;
  return (
    <Panel title={t.transportation} id="tr-h">
      {tr.show_pt1 ? (
        <div className="space-y-3">
          <label className="flex min-h-[40px] items-start gap-3">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-hemlock" checked={tr.pt1_status !== "not_started"}
              onChange={(e) => set.mutate({ pt1_status: e.target.checked ? "requested" : "not_started" })} />
            <span>
              <span className="block font-semibold">{t.pt1}</span>
              <span className="block text-caption text-muted">{t.pt1Sub}</span>
            </span>
          </label>
          <a className="block text-caption text-hemlock underline" href={tr.pt1_url} target="_blank" rel="noreferrer">{t.pt1Link}</a>
          <Field label="Status">
            <select className={inputCls} value={tr.pt1_status} onChange={(e) => set.mutate({ pt1_status: e.target.value })}>
              {Object.entries(t.pt1Status).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        </div>
      ) : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); set.mutate({ transport_plan: plan }); }}>
          <Field label={t.transportPlan}><textarea className={inputCls} rows={2} value={plan} onChange={(e) => setPlan(e.target.value)} /></Field>
          <Button type="submit">{t.save}</Button>
        </form>
      )}
      {set.error && <ErrorNote error={set.error} />}
    </Panel>
  );
}

function County({ d }: { d: Detail }) {
  const t = copy.detail;
  const hrsa = d.place_context.items.find((i) => i.kind === "hrsa");
  const places = d.place_context.items.find((i) => i.kind === "places");
  const checkup = places?.values?.find((v) => v.measure.startsWith("Visits to doctor for routine checkup"));
  const shortage = hrsa?.designations?.some((x) => x.includes_town) ? t.yesIncludes : hrsa?.designations?.length ? t.yesCounty : t.no;
  return (
    <Panel title={t.county(d.place_context.county)} id="county-h">
      <dl className="space-y-2">
        <div className="flex justify-between gap-3"><dt className="text-muted">{t.shortage}</dt><dd className="text-right">{shortage}</dd></div>
        {checkup && <div className="flex justify-between gap-3"><dt className="text-muted">{t.checkup}</dt><dd>{checkup.value}%</dd></div>}
      </dl>
      <Muted className="mt-3 block">{t.countySource}</Muted>
    </Panel>
  );
}

export default function ReferralDetail() {
  const { rid = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ["referral", rid], queryFn: () => api.referral(rid), ...LIVE });
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [barrier, setBarrier] = useState(false);
  const callKind = useCallKind();
  const mode = useCallMode();
  const callOffice = useCallOffice();
  const calls = useQuery({ queryKey: ["calls", rid], queryFn: () => api.calls(rid), ...LIVE });
  // Clinicians read; coordinators do the logistics (the server enforces the same split).
  const coordinator = useMe()?.role !== "clinician";
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const d = q.data!;
  const c = d.card;
  const t = copy.detail;
  const flag = c.stuck.length ? primaryFlag(c.stuck) : undefined;
  const failure = flag ? FAILURE_RULES.has(flag.rule) : false;
  const unit = (f: typeof flag) => (f!.unit === "business days" ? (f!.threshold === 1 ? "business day" : "business days") : f!.threshold === 1 ? "day" : "days");
  const route = c.miles === null ? `${c.patient.town} to ${c.performer.town}` : c.miles === 0 ? `${c.patient.town}, same town` : `${c.patient.town} to ${c.performer.town}, ${c.miles} mi`;
  const followUpAvailable = c.stuck.some((f) => f.rule !== "pt1_not_requested" && f.rule !== "office_not_received");
  const latestCall = calls.data?.calls[0];
  const ringing = latestCall?.status === "calling";
  if (params.get("followup") === "1" && !drawer && followUpAvailable) {
    setTimeout(() => { setDrawer({ kind: "follow_up", rid }); setParams({}); }, 0);
  }

  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex min-h-[40px] items-center gap-1 text-hemlock hover:underline">
        <ChevronLeft size={18} strokeWidth={1.8} aria-hidden="true" />{t.back}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <div>
            <h1 className="flex flex-wrap items-center gap-2 text-page font-bold">{c.patient.name}<SampleTag show={c.sample} /></h1>
            <p className="text-muted">
              {t.at(c.specialty, c.performer.name)}
              {c.performer.fictional && <> {copy.fictional}</>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip>{route}</Chip>
            <Chip>{c.patient.coverage_label}</Chip>
            {c.authorization !== "not_set" && <Chip>{t.authorization}: {c.authorization_label.toLowerCase()}</Chip>}
          </div>
        </div>
        {coordinator && ringing && (
          <p role="status" data-testid="header-call-status" className="flex min-h-[40px] items-center gap-2 font-semibold text-hemlock">
            <span aria-hidden="true" className="h-2.5 w-2.5 animate-pulse rounded-full bg-hemlock" />
            {copy.phoneCall.calling(latestCall!.practice)}
          </p>
        )}
        {coordinator && c.can_call && !ringing && (
          <div className="space-y-1">
            <button type="button" className={btn("primary")} disabled={callOffice.isPending}
              onClick={() => (mode === "phone" ? callOffice.mutate(rid) : setDrawer({ kind: callKind, rid }))}>
              {mode === "phone" ? copy.phoneCall.callOffice : callKind === "call" ? t.callAi : t.logUpdate}
            </button>
            {callOffice.error && <ErrorNote error={callOffice.error} />}
          </div>
        )}
      </header>

      <Panel>
        <RouteTrack steps={c.stepper} flags={c.stuck} labels />
        <p className={`mt-4 ${flag ? (failure ? "text-rust" : "text-amber") : "text-muted"} font-semibold`} data-testid="status-line">
          {flag ? `${flag.message}. ${t.limit(flag.threshold, unit(flag))}` : coordinator && c.reviewer ? copy.dashboard.waitingReview(c.reviewer) : c.status_label}
        </p>
        {c.stuck.length > 1 && (
          <ul className="mt-1 text-caption text-muted">
            {c.stuck.filter((f) => f !== flag).map((f) => <li key={f.rule}>{f.message}.</li>)}
          </ul>
        )}
      </Panel>

      {coordinator && (
        <CallPanel d={d} onEdit={(prefill) => setDrawer({ kind: "update", rid, prefill })}
          onPatientMessage={() => setDrawer({ kind: "patient", rid })} />
      )}

      {coordinator && c.stage === "draft" && <SendPanel d={d} />}

      <div className="grid items-start gap-6 min-[860px]:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Panel title={t.timeline} id="tl-h" actions={<a href={api.fhirUrl(rid)} download className="inline-flex min-h-[40px] items-center text-hemlock hover:underline">{t.downloadFhir}</a>}>
            <Timeline items={d.timeline} />
          </Panel>
          {coordinator && d.can_send && c.stage !== "draft" && <SendPanel d={d} />}
        </div>
        <div className="space-y-6">
          {coordinator ? (
          <Panel title={t.nextStep} id="next-h">
            <div className="space-y-2">
              {d.update_actions.length > 0 && <Button className="w-full" onClick={() => setDrawer({ kind: "update", rid })}>{t.logUpdate}</Button>}
              {d.can_message_patient && <Button className="w-full" onClick={() => setDrawer({ kind: "patient", rid })}>{t.messagePatient}</Button>}
              {followUpAvailable && <Button className="w-full" onClick={() => setDrawer({ kind: "follow_up", rid })}>{t.followUp}</Button>}
              {d.can_send && <Button className="w-full" onClick={() => setBarrier(!barrier)} aria-expanded={barrier}>{t.logBarrier}</Button>}
              {barrier && <BarrierForm rid={rid} onDone={() => setBarrier(false)} />}
              {c.open_barriers.length > 0 && (
                <p className="pt-1 text-caption text-muted">{t.barriers}: {c.open_barriers.map((b) => b.label.toLowerCase()).join(", ")}</p>
              )}
            </div>
            {c.stage !== "draft" && <div className="mt-4"><OfficeLink path={d.office_path} /></div>}
          </Panel>
          ) : c.stage === "plan_returned" && (
            <Panel title={t.nextStep} id="next-h">
              <Link to="/inbox" className={btn("primary", "w-full")}>{t.reviewPlan}</Link>
            </Panel>
          )}
          {coordinator && <Transport d={d} />}
          <Panel title={t.hintTitle} id="hint-h"><p data-testid="referral-hint">{d.hint}</p></Panel>
          <County d={d} />
        </div>
      </div>
      <ActionDrawers state={drawer} setState={setDrawer} />
    </div>
  );
}
