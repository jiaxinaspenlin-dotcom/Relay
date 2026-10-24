import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type Card } from "../api";
import { copy } from "../copy";
import { LoopStepper } from "../components/LoopStepper";
import { StageBadge } from "../components/StageBadge";
import { ErrorNote, Loading } from "../components/Status";

function MiniCard({ card }: { card: Card }) {
  return (
    <Link
      to={`/referrals/${card.id}`}
      data-testid={`card-${card.id}`}
      className="block rounded border border-slate-200 p-2 text-sm hover:border-accent"
    >
      <div className="flex justify-between font-mono text-xs text-slate-500">
        <span>{card.id}</span>
        {card.miles !== null && <span>{card.miles} {copy.milesUnit}</span>}
      </div>
      <div className="font-medium">{card.patient.synthetic_name}</div>
      <div className="text-slate-600">
        {card.specialty} · {card.patient.town} → {card.performer.town}
      </div>
    </Link>
  );
}

export default function Dashboard() {
  const q = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard });
  if (q.isLoading) return <Loading />;
  if (q.error) return <div className="p-6"><ErrorNote error={q.error} /></div>;
  const d = q.data!;
  const s = d.summary;

  return (
    <div className="space-y-8 p-6">
      <h1 className="text-xl font-semibold">{copy.dashboard.title}</h1>

      <section aria-labelledby="counts-h">
        <h2 id="counts-h" className="mb-2 text-sm font-semibold text-slate-600">{copy.dashboard.counts}</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="counts">
          {[
            [copy.dashboard.open, s.open],
            [copy.dashboard.stuck, s.stuck],
            [copy.dashboard.closedThisMonth, s.closed_this_month],
            [copy.dashboard.medianSentToScheduled, s.median_days_sent_to_scheduled ?? "—"],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded border border-slate-200 p-3">
              <dt className="text-xs text-slate-600">{label}</dt>
              <dd className="font-mono text-2xl">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="na-h">
        <h2 id="na-h" className="mb-2 text-lg font-semibold">{copy.dashboard.needsAttention}</h2>
        {d.needs_attention.length === 0 && <p className="text-slate-600">{copy.dashboard.noneStuck}</p>}
        <ul className="space-y-2" data-testid="needs-attention">
          {d.needs_attention.map((row) => (
            <li key={row.referral_id} className="rounded border border-amber-300 bg-amber-50/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">{row.referral_id}</span>
                  <StageBadge stage={row.card.stage} label={row.card.stage_label} />
                  <span className="text-sm">
                    {row.card.patient.synthetic_name} · {row.card.specialty} · {row.card.performer.name}
                  </span>
                </div>
                <Link
                  to={`/referrals/${row.referral_id}?followup=1`}
                  className="rounded bg-accent px-2 py-1 text-sm text-white"
                >
                  {copy.dashboard.draftFollowUp}
                </Link>
              </div>
              <ul className="mt-1 text-sm">
                {row.flags.map((f) => (
                  <li key={f.rule + f.message} className="flex flex-wrap gap-2">
                    <span className="font-medium">{f.message}</span>
                    <span className="text-xs text-slate-500">
                      ({copy.practiceSetting}: {f.threshold} {f.unit})
                    </span>
                  </li>
                ))}
              </ul>
              {row.card.open_barriers.length > 0 && (
                <div className="mt-1 flex gap-1">
                  {row.card.open_barriers.map((b) => (
                    <span key={b.type} className="rounded bg-amber-100 px-1.5 text-xs">{b.label}</span>
                  ))}
                </div>
              )}
              <div className="mt-2"><LoopStepper steps={row.card.stepper} compact /></div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="pipe-h">
        <h2 id="pipe-h" className="mb-2 text-lg font-semibold">{copy.dashboard.pipeline}</h2>
        <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-8" data-testid="pipeline">
          {d.pipeline.map((col) => (
            <div key={col.stage} data-testid={`col-${col.stage}`} className="space-y-2">
              <h3 className="flex items-center justify-between">
                <StageBadge stage={col.stage} label={col.label} />
                <span className="font-mono text-xs">{col.cards.length}</span>
              </h3>
              {col.cards.length === 0 && <p className="text-xs text-slate-400">{copy.dashboard.empty}</p>}
              {col.cards.map((c) => <MiniCard key={c.id} card={c} />)}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
