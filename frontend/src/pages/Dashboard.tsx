import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api, type Card, type Dashboard as DashboardT, type StuckFlag } from "../api";
import { copy } from "../copy";
import { FAILURE_RULES, plural, routeLine } from "../format";
import { RouteTrack, primaryFlag } from "../components/RouteTrack";
import { ErrorNote, Loading } from "../components/Status";
import { Button, Chip, Muted, SampleTag } from "../components/ui";

function EmptyState() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const sample = useMutation({ mutationFn: api.loadSample, onSuccess: () => qc.invalidateQueries() });
  return (
    <div className="max-w-xl rounded-panel border border-line bg-surface p-8" data-testid="empty-state">
      <h1 className="text-page font-bold">{copy.empty.title}</h1>
      <p className="mt-2 text-muted">{copy.empty.body}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="primary" onClick={() => nav("/new")}>{copy.empty.add}</Button>
        <Button onClick={() => sample.mutate()} disabled={sample.isPending}>{copy.empty.sample}</Button>
      </div>
      {sample.error && <div className="mt-3"><ErrorNote error={sample.error} /></div>}
    </div>
  );
}

function Headline({ d }: { d: DashboardT }) {
  const rules = d.needs_attention.flatMap((r) => r.flags.map((f) => f.rule));
  const never = rules.filter((r) => r === "accepted_no_appointment").length;
  const noPlan = rules.filter((r) => r === "seen_no_plan").length;
  const parts = copy.dashboard.headline(d.summary.open, d.summary.stuck, never, noPlan);
  return (
    <div>
      <h1 className="text-page font-normal" data-testid="headline">
        {parts.map((p, i) => (typeof p === "number" ? <strong key={i} className="font-bold">{p}</strong> : <span key={i}>{p}</span>))}
      </h1>
      <p className="mt-1 text-caption text-muted">
        {copy.dashboard.median(d.summary.median_days_sent_to_scheduled, d.summary.median_basis_n)}
      </p>
    </div>
  );
}

function sentenceFor(flag: StuckFlag): string {
  return flag.message.replace(" — ", ", ") + ".";
}

function AttentionRow({ card, flags, fresh }: { card: Card; flags: StuckFlag[]; fresh: boolean }) {
  const main = primaryFlag(flags) ?? flags[0];
  const failure = FAILURE_RULES.has(main.rule);
  return (
    <li data-testid={`row-${card.id}`} className={`grid gap-4 border-b border-line px-5 py-4 last:border-b-0 md:grid-cols-[15rem_1fr] ${fresh ? "highlight-in" : ""}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/referrals/${card.id}`} className="font-semibold text-ink hover:text-hemlock hover:underline">{card.patient.name}</Link>
          <SampleTag show={card.sample} />
        </div>
        <div className="text-caption text-muted">{routeLine(card.patient.town, card.performer.town, card.miles)}, {card.id}</div>
        <div className="text-caption text-muted">{card.specialty}</div>
      </div>
      <div className="min-w-0 space-y-2">
        <RouteTrack steps={card.stepper} flags={flags} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`font-semibold ${failure ? "text-rust" : "text-amber"}`} data-testid="rule-sentence">
              {flags.map(sentenceFor).join(" ")}
            </span>
            {card.open_barriers.map((b) => <Chip key={b.type}>{b.label} barrier</Chip>)}
          </div>
          <Link
            to={`/referrals/${card.id}?followup=1`}
            className="inline-flex min-h-[40px] items-center rounded-control border border-hemlock px-4 font-semibold text-hemlock hover:bg-hemlock-tint"
          >
            {copy.dashboard.draftFollowUp}
          </Link>
        </div>
      </div>
    </li>
  );
}

function StageBar({ d }: { d: DashboardT }) {
  const cols = d.pipeline.filter((c) => c.cards.length > 0);
  const total = cols.reduce((n, c) => n + c.cards.length, 0) || 1;
  const shade = ["#1F5F5B", "#3D7A75", "#5B9590", "#79AFAA", "#97C9C4", "#B5DDD8", "#CFE7E3", "#E3EFEC", "#EEF4F2"];
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full border border-line" aria-hidden="true">
        {cols.map((c, i) => <span key={c.stage} style={{ width: `${(c.cards.length / total) * 100}%`, background: shade[i % shade.length] }} />)}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-caption" data-testid="stage-bar">
        {cols.map((c, i) => (
          <li key={c.stage} data-testid={`stage-${c.stage}`} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm border border-line" style={{ background: shade[i % shade.length] }} />
            {c.label} <strong className="font-semibold">{c.cards.length}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OpenTable({ d }: { d: DashboardT }) {
  const nav = useNavigate();
  const [desc, setDesc] = useState(true);
  const rows = useMemo(() => {
    const all = d.pipeline.flatMap((c) => c.cards);
    return [...all].sort((a, b) => (desc ? b.days_in_stage - a.days_in_stage : a.days_in_stage - b.days_in_stage));
  }, [d, desc]);
  const c = copy.dashboard.cols;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left" data-testid="open-table">
        <thead className="text-caption text-muted">
          <tr className="border-b border-line">
            <th className="py-2 pr-3 font-semibold">{c.patient}</th>
            <th className="py-2 pr-3 font-semibold">{c.specialty}</th>
            <th className="py-2 pr-3 font-semibold">{c.route}</th>
            <th className="py-2 pr-3 font-semibold">{c.stage}</th>
            <th className="py-2 text-right font-semibold" aria-sort={desc ? "descending" : "ascending"}>
              <button type="button" className="min-h-[40px] font-semibold text-hemlock hover:underline" onClick={() => setDesc(!desc)} aria-label={copy.dashboard.sortBy}>
                {c.days} {desc ? "▾" : "▴"}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              data-testid={`open-${r.id}`}
              data-stage={r.stage}
              tabIndex={0}
              onClick={() => nav(`/referrals/${r.id}`)}
              onKeyDown={(e) => e.key === "Enter" && nav(`/referrals/${r.id}`)}
              className="cursor-pointer border-b border-line last:border-b-0 hover:bg-hemlock-tint/50 focus:bg-hemlock-tint/50"
            >
              <td className="py-2 pr-3"><span className="font-semibold">{r.patient.name}</span> <SampleTag show={r.sample} /></td>
              <td className="py-2 pr-3">{r.specialty}</td>
              <td className="py-2 pr-3 text-muted">{routeLine(r.patient.town, r.performer.town, r.miles)}</td>
              <td className={`py-2 pr-3 ${r.stuck.length ? "text-amber" : ""}`}>{r.stage_label}</td>
              <td className="py-2 text-right">{r.days_in_stage}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Dashboard() {
  const q = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard });
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  // Highlight referrals that newly crossed a limit since the last render (the one motion moment).
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
  const failures = d.needs_attention.filter((r) => r.flags.some((f) => FAILURE_RULES.has(f.rule)));
  const others = d.needs_attention.filter((r) => !r.flags.some((f) => FAILURE_RULES.has(f.rule)));
  const t = copy.dashboard;
  const demo = settings.data?.clock.demo_mode;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Headline d={d} />
        <Link to="/new" className="inline-flex min-h-[40px] items-center rounded-control bg-hemlock px-4 font-semibold text-white hover:bg-[#184d4a]">
          {copy.nav.newReferral}
        </Link>
      </div>

      <div data-testid="needs-attention" className="space-y-6">
        {d.needs_attention.length === 0 && (
          <p className="rounded-panel border border-line bg-surface p-5 text-muted">
            {t.noneStuck} {demo ? t.nextCheckDemo : t.nextCheckReal}
          </p>
        )}
        {([[t.failures, failures, "failures-h"], [t.waiting, others, "waiting-h"]] as const).map(([title, rows, id]) =>
          rows.length > 0 && (
            <section key={id} aria-labelledby={id}>
              <h2 id={id} className="mb-2 text-section font-semibold">{title}</h2>
              <ul className="rounded-panel border border-line bg-surface">
                {rows.map((r) => <AttentionRow key={r.referral_id} card={r.card} flags={r.flags} fresh={fresh.has(r.referral_id)} />)}
              </ul>
            </section>
          ),
        )}
      </div>

      <section aria-labelledby="all-h" className="space-y-4 rounded-panel border border-line bg-surface p-5">
        <h2 id="all-h" className="text-section font-semibold">{t.allOpen}</h2>
        <StageBar d={d} />
        <OpenTable d={d} />
        <Muted>{plural(d.summary.open, "open referral")}.</Muted>
      </section>
    </div>
  );
}
