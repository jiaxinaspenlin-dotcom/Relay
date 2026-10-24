import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stethoscope } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { LIVE, api, type Card, type StuckFlag } from "../api";
import { copy } from "../copy";
import { FAILURE_RULES } from "../format";
import { ActionDrawers, useCallKind, type DrawerKind, type DrawerState } from "../components/ActionDrawers";
import { RouteTrack, primaryFlag } from "../components/RouteTrack";
import { ErrorNote, Loading } from "../components/Status";
import { Button, SampleTag, btn } from "../components/ui";

function EmptyState() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const sample = useMutation({ mutationFn: api.loadSample, onSuccess: () => qc.invalidateQueries() });
  return (
    <div className="max-w-xl pt-6" data-testid="empty-state">
      <h1 className="text-page font-bold">{copy.empty.title}</h1>
      <p className="mt-2 text-muted">{copy.empty.body}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button variant="primary" onClick={() => nav("/new")}>{copy.empty.add}</Button>
        <Button onClick={() => sample.mutate()} disabled={sample.isPending}>{copy.empty.sample}</Button>
      </div>
      {sample.error && <div className="mt-3"><ErrorNote error={sample.error} /></div>}
    </div>
  );
}

const ACTION_DRAWER: Record<string, DrawerKind | null> = {
  follow_up: "follow_up", send_records: "follow_up", message_patient: "patient", open: null,
};

function Row({ card, flags, fresh, onAction }: { card: Card; flags: StuckFlag[]; fresh: boolean; onAction: (kind: DrawerKind) => void }) {
  const nav = useNavigate();
  const callKind = useCallKind();
  const main = flags.length ? primaryFlag(flags)! : undefined;
  const failure = main ? FAILURE_RULES.has(main.rule) : false;
  const action = main?.action === "call_office" && !card.can_call ? "follow_up" : main?.action;
  const kind = action === "call_office" ? callKind : action ? ACTION_DRAWER[action] : null;
  const miles = card.miles === null ? "" : card.miles === 0 ? ", same town" : `, ${card.miles} mi`;
  return (
    <li
      data-testid={`row-${card.id}`}
      className={`group relative grid grid-cols-1 items-center gap-4 border-b border-line px-6 py-5 last:border-b-0 hover:bg-paper/70 min-[860px]:grid-cols-[1fr_1.5fr_160px] ${fresh ? "highlight-in" : ""}`}
    >
      {/* The whole row opens referral detail; the action button sits above this link. */}
      <Link to={`/referrals/${card.id}`} aria-label={copy.dashboard.rowLabel(card.patient.name)} className="absolute inset-0 rounded-none focus-visible:outline-offset-[-2px]" />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold">{card.patient.name}</span>
          <SampleTag show={card.sample} />
        </div>
        <div className="text-caption text-muted">{card.specialty}{miles}</div>
      </div>
      <div className="min-w-0">
        <RouteTrack steps={card.stepper} flags={flags} />
        <div className={`mt-2 text-caption font-bold ${main ? (failure ? "text-rust" : "text-amber") : "text-muted font-normal"}`} data-testid="row-status">
          {main ? main.status : card.status_label}
        </div>
      </div>
      <div className="relative z-10 flex justify-start min-[860px]:justify-end">
        {action && (
          <button
            type="button"
            className={btn("outline", "w-full min-[860px]:w-auto")}
            onClick={() => (kind ? onAction(kind) : nav(`/referrals/${card.id}`))}
          >
            {copy.dashboard.actions[action]}
          </button>
        )}
      </div>
    </li>
  );
}

function Section({ title, rows, fresh, onAction, testid }: {
  title: string; testid: string; rows: { card: Card; flags: StuckFlag[] }[]; fresh: Set<string>;
  onAction: (rid: string, kind: DrawerKind) => void;
}) {
  if (!rows.length) return null;
  const id = `${testid}-h`;
  return (
    <section aria-labelledby={id} data-testid={testid}>
      <h2 id={id} className="mb-3 text-body text-muted">{title}</h2>
      <ul className="overflow-hidden rounded-panel border border-line bg-surface">
        {rows.map((r) => (
          <Row key={r.card.id} card={r.card} flags={r.flags} fresh={fresh.has(r.card.id)} onAction={(k) => onAction(r.card.id, k)} />
        ))}
      </ul>
    </section>
  );
}

export default function Dashboard() {
  const q = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard, ...LIVE });
  const [drawer, setDrawer] = useState<DrawerState>(null);
  // The one motion moment: a referral that newly crosses its limit slides in with a highlight.
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!q.data) return;
    const ids = new Set(q.data.needs_attention.map((r) => r.referral_id));
    if (seen.current) setFresh(new Set([...ids].filter((i) => !seen.current!.has(i))));
    seen.current = ids;
  }, [q.data]);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const d = q.data!;
  if (d.total === 0) return <EmptyState />;
  const lost = d.needs_attention.filter((r) => r.flags.some((f) => FAILURE_RULES.has(f.rule)));
  const waiting = d.needs_attention.filter((r) => !r.flags.some((f) => FAILURE_RULES.has(f.rule)));
  const stuckIds = new Set(d.needs_attention.map((r) => r.referral_id));
  const onTrack = d.pipeline.flatMap((c) => c.cards).filter((c) => !stuckIds.has(c.id));
  const t = copy.dashboard;
  const open = (rid: string, kind: DrawerKind) => setDrawer({ kind, rid });

  return (
    <>
      {/* Background stethoscope: dashboard only, behind everything, hidden on small screens. */}
      <div aria-hidden="true" className="pointer-events-none absolute -right-[260px] top-0 z-0 hidden overflow-visible min-[860px]:block">
        <Stethoscope size={800} strokeWidth={0.5} color="#1F5F5B" style={{ opacity: 0.08, transform: "rotate(-24deg)" }} />
      </div>
      <div className="relative z-10 space-y-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-page font-bold" data-testid="headline">{t.headline(d.summary.stuck)}</h1>
            <p className="mt-1 text-muted">{t.open(d.summary.open)}</p>
          </div>
          <Link to="/new" className={btn("primary")}>{t.newReferral}</Link>
        </div>
        {d.needs_attention.length === 0 && <p className="text-muted">{t.none}</p>}
        <Section title={t.lost} testid="lost" rows={lost.map((r) => ({ card: r.card, flags: r.flags }))} fresh={fresh} onAction={open} />
        <Section title={t.waiting} testid="waiting" rows={waiting.map((r) => ({ card: r.card, flags: r.flags }))} fresh={fresh} onAction={open} />
        <Section title={t.onTrack} testid="on-track" rows={onTrack.map((c) => ({ card: c, flags: [] }))} fresh={fresh} onAction={open} />
      </div>
      <ActionDrawers state={drawer} setState={setDrawer} />
    </>
  );
}
