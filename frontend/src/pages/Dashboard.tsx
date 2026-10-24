import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api, type Card } from "../api";
import { copy } from "../copy";
import { LoopStepper } from "../components/LoopStepper";
import { ErrorNote, Loading } from "../components/Status";
import { Button, Num, Panel, SampleTag, StageBadge } from "../components/ui";

function EmptyState() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const sample = useMutation({ mutationFn: api.loadSample, onSuccess: () => qc.invalidateQueries() });
  return (
    <div className="mx-auto mt-16 max-w-lg rounded-lg border border-slate-200 bg-white p-8 text-center" data-testid="empty-state">
      <h1 className="text-xl font-semibold">{copy.empty.title}</h1>
      <p className="mt-2 text-sm text-slate-600">{copy.empty.body}</p>
      <div className="mt-6 flex justify-center gap-3">
        <Button variant="primary" onClick={() => nav("/new")}>{copy.empty.add}</Button>
        <Button onClick={() => sample.mutate()} disabled={sample.isPending}>{copy.empty.sample}</Button>
      </div>
      {sample.error && <div className="mt-3"><ErrorNote error={sample.error} /></div>}
    </div>
  );
}

function PipelineCard({ card }: { card: Card }) {
  return (
    <Link
      to={`/referrals/${card.id}`}
      data-testid={`card-${card.id}`}
      className={`block rounded-md border bg-white p-2 text-sm hover:border-accent ${card.stuck.length ? "border-amber-300" : "border-slate-200"}`}
    >
      <div className="flex items-center justify-between gap-1 text-xs text-slate-500">
        <Num>{card.id}</Num>
        <SampleTag show={card.sample} />
      </div>
      <div className="truncate font-medium">{card.patient.name}</div>
      <div className="truncate text-xs text-slate-600">{card.specialty} · {card.performer.town}</div>
    </Link>
  );
}

export default function Dashboard() {
  const q = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const d = q.data!;
  if (d.total === 0) return <EmptyState />;
  const s = d.summary;
  const t = copy.dashboard;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <Link to="/new" className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white">{copy.empty.add}</Link>
      </div>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="counts">
        {([
          [t.open, s.open],
          [t.stuck, s.stuck],
          [t.closedThisMonth, s.closed_this_month],
          [t.medianSentToScheduled, s.median_days_sent_to_scheduled ?? "—"],
        ] as const).map(([label, value]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className={`font-mono text-2xl tabular-nums ${label === t.stuck && s.stuck ? "text-amber-700" : ""}`}>{value}</dd>
          </div>
        ))}
      </dl>

      <Panel title={t.needsAttention} id="na-h">
        {d.needs_attention.length === 0 && <p className="text-sm text-slate-600">{t.noneStuck}</p>}
        <ul className="divide-y divide-slate-100" data-testid="needs-attention">
          {d.needs_attention.map((row) => (
            <li key={row.referral_id} className="grid gap-3 py-3 md:grid-cols-[1fr_22rem] md:items-center">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/referrals/${row.referral_id}`} className="font-mono text-sm text-accent hover:underline">{row.referral_id}</Link>
                  <span className="font-medium">{row.card.patient.name}</span>
                  <StageBadge stage={row.card.stage} label={row.card.stage_label} />
                  <SampleTag show={row.card.sample} />
                </div>
                <div className="text-xs text-slate-600">{row.card.specialty} · {row.card.performer.name}</div>
                <ul className="text-sm">
                  {row.flags.map((f) => (
                    <li key={f.rule + f.message}>
                      <span className="font-medium text-amber-800">{f.message}</span>{" "}
                      <span className="text-xs text-slate-500">({copy.practiceSetting}: {f.threshold} {f.unit})</span>
                    </li>
                  ))}
                </ul>
                {row.card.open_barriers.length > 0 && (
                  <div className="flex gap-1">
                    {row.card.open_barriers.map((b) => (
                      <span key={b.type} className="rounded bg-amber-100 px-1.5 text-xs text-amber-900">{b.label}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <LoopStepper steps={row.card.stepper} stuck compact />
                <div className="text-right">
                  <Link to={`/referrals/${row.referral_id}?followup=1`} className="text-sm font-medium text-accent hover:underline">
                    {t.draftFollowUp} →
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={t.pipeline} id="pipe-h">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-9" data-testid="pipeline">
          {d.pipeline.map((col) => (
            <div key={col.stage} data-testid={`col-${col.stage}`} className="min-w-0 space-y-2">
              <h3 className="flex items-center justify-between gap-1">
                <StageBadge stage={col.stage} label={col.label} />
                <Num><span className="text-xs text-slate-500">{col.cards.length}</span></Num>
              </h3>
              {col.cards.length === 0 && <p className="text-xs text-slate-400">{t.emptyCol}</p>}
              {col.cards.map((c) => <PipelineCard key={c.id} card={c} />)}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
