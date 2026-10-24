import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { LIVE, api, type Detail } from "../api";
import { copy } from "../copy";
import { FAILURE_RULES } from "../format";
import { ActionDrawers, SendReferral, type DrawerState } from "../components/ActionDrawers";
import { ExportMenu } from "../components/ExportMenu";
import { useRunNextAction } from "../components/NextAction";
import { CallPanel, useCalls } from "../components/OfficeCall";
import { RouteTrack, primaryFlag } from "../components/RouteTrack";
import { copyText } from "../components/sendActions";
import { ErrorNote, Loading } from "../components/Status";
import { Timeline } from "../components/Timeline";
import { Button, Chip, Field, Muted, Panel, SampleTag, StatusText, btn, inputCls } from "../components/ui";
import { useMe } from "../components/useMe";

/** Copy office link: never prints the raw URL (it's a capability link). */
function OfficeLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}${path}`;
  return (
    <div className="space-y-1 border-t border-line pt-4">
      <Button data-testid="office-link" data-href={path} onClick={async () => setCopied(await copyText(url))}>
        {copied ? copy.send.copied : copy.send.copyLink}
      </Button>
      <Muted className="block">{copy.send.officeLinkHelp}</Muted>
    </div>
  );
}

function BarrierForm({ rid, onDone }: { rid: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState("transportation");
  const [note, setNote] = useState("");
  const add = useMutation({ mutationFn: () => api.addBarrier(rid, type, note), onSuccess: () => { qc.invalidateQueries(); onDone(); } });
  return (
    <form aria-label={copy.detail.logBarrier} className="space-y-3" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
      <Field label={copy.detail.barrierType}>
        <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(copy.barrierTypes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label={copy.detail.barrierNote}><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="flex gap-2">
        <Button variant="primary" type="submit" disabled={add.isPending}>{copy.detail.addBarrier}</Button>
        <Button variant="quiet" onClick={onDone}>{copy.detail.cancel}</Button>
      </div>
      {add.error && <ErrorNote error={add.error} />}
    </form>
  );
}

/** Barriers (small panel) with the PT-1 checkbox or a transport plan when transportation is open. */
function Barriers({ d, adding, setAdding, coordinator }: { d: Detail; adding: boolean; setAdding: (b: boolean) => void; coordinator: boolean }) {
  const qc = useQueryClient();
  const tr = d.transport;
  const [plan, setPlan] = useState(tr.transport_plan);
  const set = useMutation({ mutationFn: (body: { pt1_status?: string; transport_plan?: string }) => api.setTransport(d.card.id, body), onSuccess: () => qc.invalidateQueries() });
  const t = copy.detail;
  const open = d.card.open_barriers;
  if (!open.length && !adding) return null;
  return (
    <section id="barriers" aria-labelledby="barriers-h" className="scroll-mt-6 rounded-panel border border-line bg-surface p-6 max-[859px]:p-4">
      <h2 id="barriers-h" className="font-semibold">
        {t.barriers}: <span className="font-normal">{open.length ? open.map((b) => b.label).join(", ") : t.none}</span>
      </h2>
      {coordinator && tr.show_pt1 && (
        <div className="mt-4 space-y-2">
          <label className="flex min-h-[40px] items-start gap-3">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-hemlock" checked={tr.pt1_status !== "not_started"}
              onChange={(e) => set.mutate({ pt1_status: e.target.checked ? "requested" : "not_started" })} />
            <span>
              <span className="block font-semibold">{t.pt1}</span>
              <span className="block text-caption text-muted">{t.pt1Sub}</span>
            </span>
          </label>
          <a className="block text-caption text-hemlock underline" href={tr.pt1_url} target="_blank" rel="noreferrer">{t.pt1Link}</a>
        </div>
      )}
      {coordinator && tr.show_plan_note && (
        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); set.mutate({ transport_plan: plan }); }}>
          <Field label={t.transportPlan}><textarea className={inputCls} rows={2} value={plan} onChange={(e) => setPlan(e.target.value)} /></Field>
          <Button type="submit">{t.save}</Button>
        </form>
      )}
      {set.error && <div className="mt-2"><ErrorNote error={set.error} /></div>}
      {adding && <div className="mt-4 border-t border-line pt-4"><BarrierForm rid={d.card.id} onDone={() => setAdding(false)} /></div>}
    </section>
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
  const loc = useLocation();
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: ["referral", rid], queryFn: () => api.referral(rid), ...LIVE });
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [addingBarrier, setAddingBarrier] = useState(false);
  const next = useRunNextAction(setDrawer);
  const calls = useCalls(rid);
  // Clinicians read; coordinators do the logistics (the server enforces the same split).
  const coordinator = useMe()?.role !== "clinician";
  useEffect(() => {
    if (loc.hash === "#barriers") document.getElementById("barriers")?.scrollIntoView({ block: "start" });
  }, [loc.hash, q.data]);
  if (q.isLoading) return <Loading rows={3} />;
  if (q.error) return <ErrorNote error={q.error} />;
  const d = q.data!;
  const c = d.card;
  const t = copy.detail;
  const flag = c.stuck.length ? primaryFlag(c.stuck) : undefined;
  const tone = flag ? (FAILURE_RULES.has(flag.rule) ? "rust" : "amber") : "muted";
  const route = c.miles === null ? `${c.patient.town} to ${c.performer.town}` : c.miles === 0 ? `${c.patient.town}, same town` : `${c.patient.town} to ${c.performer.town}, ${c.miles} mi`;
  const followUpAvailable = c.stuck.some((f) => f.rule !== "pt1_not_requested" && f.rule !== "office_not_received");
  const ringing = calls.data?.calls[0]?.status === "calling";
  if (params.get("followup") === "1" && !drawer && followUpAvailable) {
    setTimeout(() => { setDrawer({ kind: "follow_up", rid }); setParams({}); }, 0);
  }
  // "Send referral again" is a panel only when the office hasn't got it; otherwise a quiet link.
  const resendPanel = c.stage !== "draft" && d.can_send && c.stuck.some((f) => f.rule === "office_not_received" || f.rule === "sent_no_receipt");
  const sentence = !flag && coordinator && c.reviewer ? `${copy.dashboard.waitingReview(c.reviewer)}.` : c.status_sentence;

  // One primary action (same as the dashboard row); Log update when nothing is stuck.
  const primary = c.next_action
    ? { label: c.next_action.label, run: () => next.run(c), key: c.next_action.key as string }
    : d.update_actions.length ? { label: t.logUpdate, run: () => setDrawer({ kind: "update", rid }), key: "update" } : null;
  const links: { label: string; run: () => void }[] = [];
  if (primary?.key !== "update" && d.update_actions.length) links.push({ label: t.logUpdate, run: () => setDrawer({ kind: "update", rid }) });
  if (primary?.key !== "message_patient" && d.can_message_patient) links.push({ label: t.messagePatient, run: () => setDrawer({ kind: "patient", rid }) });
  if (!["follow_up", "send_records", "request_authorization"].includes(primary?.key ?? "") && followUpAvailable) links.push({ label: t.followUp, run: () => setDrawer({ kind: "follow_up", rid }) });
  if (d.can_send && c.stage !== "draft") links.push({ label: t.logBarrier, run: () => { setAddingBarrier(true); setTimeout(() => document.getElementById("barriers")?.scrollIntoView({ block: "start" }), 0); } });
  if (primary?.key !== "resend" && !resendPanel && d.can_send && c.stage !== "draft") links.push({ label: copy.dashboard.actions.resend, run: () => setDrawer({ kind: "resend", rid }) });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link to="/" className="inline-flex h-10 items-center gap-1 text-hemlock hover:underline">
          <ChevronLeft size={18} strokeWidth={1.8} aria-hidden="true" />{t.back}
        </Link>
        <ExportMenu rid={rid} />
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <div>
            <h1 className="flex flex-wrap items-center gap-2 text-page font-bold">{c.patient.name}<SampleTag show={c.sample} /></h1>
            <p className="text-muted">
              {t.at(c.specialty, c.performer.name)}
              {c.performer.fictional && <> {copy.fictional}</>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Chip>{route}</Chip>
            <Chip>{c.patient.coverage_label}</Chip>
            {c.authorization !== "not_set" && <Chip>{t.authorization}: {c.authorization_label.toLowerCase()}</Chip>}
          </div>
        </div>
        {/* The header's primary is the same action as Next step; hidden during a call. */}
        {coordinator && primary && !ringing && primary.key !== "update" && (
          <div className="space-y-1">
            <button type="button" className={btn("primary")} onClick={primary.run} disabled={next.pending} data-testid="header-primary">{primary.label}</button>
            {next.error && <ErrorNote error={next.error} />}
          </div>
        )}
      </header>

      {coordinator && (
        <CallPanel d={d} onEdit={(prefill) => setDrawer({ kind: "update", rid, prefill })}
          onPatientMessage={() => setDrawer({ kind: "patient", rid })} />
      )}

      <Panel>
        <RouteTrack steps={c.stepper} flags={c.stuck} labels />
        <StatusText tone={tone} className="mt-4" testid="status-line">{sentence}</StatusText>
      </Panel>

      {coordinator && c.stage === "draft" && (
        <Panel title={copy.send.draftTitle} id="send-h" className="border-hemlock">
          <p className="mb-3">{copy.send.draftNote}</p>
          <SendReferral rid={rid} primary="copy" resend={false} />
        </Panel>
      )}

      <div className="grid items-start gap-6 min-[860px]:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Panel title={t.timeline} id="tl-h"><Timeline items={d.timeline} /></Panel>
          {coordinator && resendPanel && (
            <Panel title={copy.send.sendAgain} id="send-h" className={c.stuck.some((f) => f.rule === "office_not_received") ? "border-hemlock" : ""}>
              <SendReferral rid={rid} />
            </Panel>
          )}
        </div>
        <div className="space-y-6">
          {coordinator ? (
            <Panel title={t.nextStep} id="next-h" testid="next-step">
              {/* During a call the live card at the top is the next step; no disabled button here. */}
              {primary && !(ringing && primary.key === "call_office") && (
                <button type="button" className={btn("primary", "w-full")} onClick={primary.run} disabled={next.pending} data-testid="next-primary">
                  {primary.label}
                </button>
              )}
              {links.length > 0 && (
                <ul className={`${primary && !(ringing && primary.key === "call_office") ? "mt-3" : ""} flex flex-wrap items-center gap-x-4 text-body`} aria-label={t.otherActions}>
                  {links.map((l) => (
                    <li key={l.label}><Button variant="quiet" onClick={l.run}>{l.label}</Button></li>
                  ))}
                </ul>
              )}
              {c.stage !== "draft" && <div className="mt-4"><OfficeLink path={d.office_path} /></div>}
            </Panel>
          ) : c.stage === "plan_returned" && (
            <Panel title={t.nextStep} id="next-h">
              <Link to="/inbox" className={btn("primary", "w-full")}>{t.reviewPlan}</Link>
            </Panel>
          )}
          <Barriers d={d} adding={addingBarrier} setAdding={setAddingBarrier} coordinator={coordinator} />
          <Panel title={t.hintTitle} id="hint-h"><p data-testid="referral-hint">{d.hint}</p></Panel>
          <County d={d} />
        </div>
      </div>
      <ActionDrawers state={drawer} setState={setDrawer} />
    </div>
  );
}
