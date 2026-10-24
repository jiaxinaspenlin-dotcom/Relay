import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type InboxItem } from "../api";
import { copy } from "../copy";
import { LoopStepper } from "../components/LoopStepper";
import { ErrorNote, Loading } from "../components/Status";
import { Timeline } from "../components/Timeline";
import { Button, Num, SampleTag, inputCls } from "../components/ui";

function Item({ item }: { item: InboxItem }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const close = useMutation({ mutationFn: () => api.close(item.card.id, note), onSuccess: () => qc.invalidateQueries() });
  const p = item.plan;
  const t = copy.inbox;
  return (
    <article data-testid={`inbox-${item.card.id}`} className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link to={`/referrals/${item.card.id}`} className="font-mono text-accent hover:underline">{item.card.id}</Link>
          <span className="font-medium">{item.card.patient.name}</span>
          <span className="text-sm text-slate-600">· {item.card.specialty}</span>
          <SampleTag show={item.card.sample} />
        </div>
        <span className="text-xs text-slate-500">{t.received} <Num>{p.returned_on}</Num></span>
      </div>
      <LoopStepper steps={item.card.stepper} compact />
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-md bg-slate-50 p-3 text-sm">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t.originalReason}</h3>
          <p data-testid="original-reason">{item.reason_text}</p>
          <p className="mt-1 text-slate-600">{item.reason_condition.display} · <span className="capitalize">{item.priority}</span></p>
        </section>
        <section className="rounded-md border border-emerald-200 bg-emerald-50/40 p-3 text-sm">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-800">{t.returnedPlan}</h3>
          <dl className="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1">
            <dt className="text-slate-500">{t.from}</dt><dd>{p.from}</dd>
            <dt className="text-slate-500">{t.visitDate}</dt><dd><Num>{p.visit_date}</Num></dd>
            <dt className="text-slate-500">{t.assessment}</dt><dd>{p.assessment}</dd>
            <dt className="text-slate-500">{t.plan}</dt><dd data-testid="returned-plan">{p.plan}</dd>
            {p.actions_for_pcp && (<><dt className="text-slate-500">{t.actions}</dt><dd>{p.actions_for_pcp}</dd></>)}
            {p.questions_contact && (<><dt className="text-slate-500">{t.contact}</dt><dd>{p.questions_contact}</dd></>)}
          </dl>
          <p className="mt-2 text-xs text-slate-500">{p.omitted_fields_note}</p>
        </section>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-slate-600">{copy.detail.timeline}</summary>
        <div className="mt-2"><Timeline items={item.timeline} /></div>
      </details>
      <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
        <label className="flex-1 text-sm text-slate-700">
          {t.closeNote}
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <Button variant="primary" onClick={() => close.mutate()} disabled={close.isPending}>{t.acknowledge}</Button>
      </div>
      {close.error && <ErrorNote error={close.error} />}
    </article>
  );
}

export default function PcpInbox() {
  const q = useQuery({ queryKey: ["inbox"], queryFn: api.inbox });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{copy.inbox.title}</h1>
      {q.data!.items.length === 0 && <p className="rounded-lg border border-slate-200 bg-white p-6 text-slate-600">{copy.inbox.empty}</p>}
      {q.data!.items.map((it) => <Item key={it.card.id} item={it} />)}
    </div>
  );
}
