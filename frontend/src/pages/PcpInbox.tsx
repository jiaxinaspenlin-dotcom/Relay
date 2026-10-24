import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type InboxItem } from "../api";
import { copy } from "../copy";
import { LoopStepper } from "../components/LoopStepper";
import { ErrorNote, Loading } from "../components/Status";
import { Timeline } from "../components/Timeline";

function Item({ item }: { item: InboxItem }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [closedId, setClosedId] = useState("");
  const close = useMutation({
    mutationFn: () => api.close(item.card.id, note),
    onSuccess: () => {
      setClosedId(item.card.id);
      qc.invalidateQueries();
    },
  });
  const p = item.plan;
  const t = copy.inbox;
  return (
    <article data-testid={`inbox-${item.card.id}`} className="space-y-3 rounded border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to={`/referrals/${item.card.id}`} className="font-mono font-semibold text-accent underline">{item.card.id}</Link>
        <span>{item.card.patient.synthetic_name} ({copy.synthetic}) · {item.card.specialty}</span>
      </div>
      <LoopStepper steps={item.card.stepper} />
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded bg-slate-50 p-3 text-sm">
          <h3 className="font-semibold">{t.originalReason}</h3>
          <p data-testid="original-reason">{item.reason_text}</p>
          <p className="text-slate-600">{item.reason_condition.display} · {item.priority}</p>
        </section>
        <section className="rounded border border-emerald-200 p-3 text-sm">
          <h3 className="font-semibold">{t.returnedPlan}</h3>
          <dl className="grid grid-cols-[8rem_1fr] gap-x-2">
            <dt className="text-slate-600">{t.from}</dt><dd>{p.from}</dd>
            <dt className="text-slate-600">{t.visitDate}</dt><dd className="font-mono">{p.visit_date}</dd>
            <dt className="text-slate-600">{t.received}</dt><dd className="font-mono">{p.returned_on}</dd>
            <dt className="text-slate-600">{t.assessment}</dt><dd>{p.assessment}</dd>
            <dt className="text-slate-600">{t.plan}</dt><dd data-testid="returned-plan">{p.plan}</dd>
            {p.actions_for_pcp && (<><dt className="text-slate-600">{t.actions}</dt><dd>{p.actions_for_pcp}</dd></>)}
            {p.questions_contact && (<><dt className="text-slate-600">{t.contact}</dt><dd>{p.questions_contact}</dd></>)}
          </dl>
          <p className="mt-1 text-xs text-slate-500">{p.omitted_fields_note}</p>
        </section>
      </div>
      <details className="text-sm">
        <summary>{copy.detail.timeline}</summary>
        <div className="mt-2"><Timeline items={item.timeline} /></div>
      </details>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          {t.closeNote}
          <input className="ml-2 rounded border border-slate-300 px-2 py-1" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button
          type="button"
          onClick={() => close.mutate()}
          disabled={close.isPending || !!closedId}
          className="rounded bg-accent px-3 py-1 text-white disabled:opacity-50"
        >
          {t.acknowledge}
        </button>
      </div>
      {close.error && <ErrorNote error={close.error} />}
    </article>
  );
}

export default function PcpInbox() {
  const q = useQuery({ queryKey: ["inbox"], queryFn: api.inbox });
  if (q.isLoading) return <Loading />;
  if (q.error) return <div className="p-6"><ErrorNote error={q.error} /></div>;
  return (
    <div className="space-y-4 p-6">
      <h1 className="text-xl font-semibold">{copy.inbox.title}</h1>
      {q.data!.items.length === 0 && <p className="text-slate-600">{copy.inbox.empty}</p>}
      {q.data!.items.map((it) => <Item key={it.card.id} item={it} />)}
    </div>
  );
}
