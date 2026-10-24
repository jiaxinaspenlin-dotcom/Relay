import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type InboxItem } from "../api";
import { copy } from "../copy";
import { shortDate } from "../format";
import { ErrorNote, Loading } from "../components/Status";
import { Timeline } from "../components/Timeline";
import { Button, Field, Muted, SampleTag, inputCls } from "../components/ui";

// Reading layout, max 72ch: original reason, then the plan in template sections, then close.
function Item({ item }: { item: InboxItem }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const close = useMutation({ mutationFn: () => api.close(item.card.id, note), onSuccess: () => qc.invalidateQueries() });
  const p = item.plan;
  const t = copy.inbox;
  const sections: [string, string][] = [
    [t.from, p.from],
    [t.visitDate, shortDate(p.visit_date)],
    [t.assessment, p.assessment],
    [t.plan, p.plan],
    ...(p.actions_for_pcp ? [[t.actions, p.actions_for_pcp] as [string, string]] : []),
    ...(p.questions_contact ? [[t.contact, p.questions_contact] as [string, string]] : []),
  ];
  return (
    <article data-testid={`inbox-${item.card.id}`} className="max-w-[72ch] space-y-5 rounded-panel border border-line bg-surface p-6">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-section font-semibold">
            <Link to={`/referrals/${item.card.id}`} className="hover:text-hemlock hover:underline">{item.card.patient.name}</Link>
          </h2>
          <SampleTag show={item.card.sample} />
        </div>
        <Muted>{item.card.specialty} referral {item.card.id}. {t.received} {shortDate(p.returned_on)}.</Muted>
      </header>
      <section>
        <h3 className="font-semibold">{t.originalReason}</h3>
        <p data-testid="original-reason" className="mt-1">{item.reason_text}</p>
        <Muted>{item.reason_condition.display}. Priority: {item.priority}.</Muted>
      </section>
      <section className="border-t border-line pt-4">
        <h3 className="font-semibold">{t.returnedPlan}</h3>
        <dl className="mt-2 space-y-3">
          {sections.map(([k, v]) => (
            <div key={k}>
              <dt className="text-caption text-muted">{k}</dt>
              <dd data-testid={k === t.plan ? "returned-plan" : undefined}>{v}</dd>
            </div>
          ))}
        </dl>
        <Muted className="mt-2 block">{p.omitted_fields_note}</Muted>
      </section>
      <details>
        <summary className="cursor-pointer text-hemlock">{copy.detail.timeline}</summary>
        <div className="mt-3"><Timeline items={item.timeline} /></div>
      </details>
      <div className="space-y-3 border-t border-line pt-4">
        <Field label={t.closeNote}><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Button variant="primary" onClick={() => close.mutate()} disabled={close.isPending}>{t.acknowledge}</Button>
        {close.error && <ErrorNote error={close.error} />}
      </div>
    </article>
  );
}

export default function PcpInbox() {
  const q = useQuery({ queryKey: ["inbox"], queryFn: api.inbox });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-page font-bold">{copy.inbox.title}</h1>
        <Muted>{copy.inbox.intro}</Muted>
      </div>
      {q.data!.items.length === 0 && <p className="max-w-[72ch] rounded-panel border border-line bg-surface p-6 text-muted">{copy.inbox.empty}</p>}
      {q.data!.items.map((it) => <Item key={it.card.id} item={it} />)}
    </div>
  );
}
