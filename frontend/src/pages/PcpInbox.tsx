import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { LIVE, api, type InboxItem } from "../api";
import { copy } from "../copy";
import { shortDate } from "../format";
import { ErrorNote, Loading } from "../components/Status";
import { ConfirmButton, Field, Muted, SampleTag, inputCls } from "../components/ui";
import { useToast } from "../components/Toast";
import { useMe } from "../components/useMe";

// Reading layout, 72 characters per line: the original question, the plan in template
// sections, then "Acknowledge and close".
function Item({ item }: { item: InboxItem }) {
  const me = useMe();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const toast = useToast();
  const close = useMutation({ mutationFn: () => api.close(item.card.id, note), onSuccess: () => { qc.invalidateQueries(); toast(copy.toast.closed); } });
  const p = item.plan;
  const t = copy.inbox;
  const sections: [string, string][] = [
    [t.from, p.from], [t.visitDate, shortDate(p.visit_date)], [t.assessment, p.assessment], [t.planSection, p.plan],
    ...(p.actions_for_pcp ? [[t.actions, p.actions_for_pcp] as [string, string]] : []),
    ...(p.questions_contact ? [[t.contact, p.questions_contact] as [string, string]] : []),
  ];
  return (
    <article data-testid={`inbox-${item.card.id}`} className="max-w-[72ch] space-y-6 rounded-panel border border-line bg-surface p-8">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="flex flex-wrap items-center gap-2 text-section font-bold">
          <Link to={`/referrals/${item.card.id}`} className="hover:text-hemlock hover:underline">{item.card.patient.name}</Link>
          <SampleTag show={item.card.sample} />
        </h2>
        <Muted className="w-full">{item.card.specialty}, received {shortDate(p.returned_on)}</Muted>
      </header>
      <section>
        <h3 className="text-caption text-muted">{t.question}</h3>
        <p data-testid="original-reason" className="mt-1">{item.reason_text}</p>
      </section>
      <section className="space-y-4 border-t border-line pt-4">
        <h3 className="text-caption text-muted">{t.plan}</h3>
        {sections.map(([k, v]) => (
          <div key={k}>
            <div className="font-semibold">{k}</div>
            <p data-testid={k === t.planSection ? "returned-plan" : undefined}>{v}</p>
          </div>
        ))}
      </section>
      {me?.role === "clinician" ? (
        <div className="space-y-3 border-t border-line pt-4">
          <Field label={t.note}><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <ConfirmButton label={t.acknowledge} question={t.closeQuestion} confirmLabel={t.closeConfirm} onConfirm={() => close.mutate()} disabled={close.isPending} />
          {close.error && <ErrorNote error={close.error} />}
        </div>
      ) : (
        <p className="border-t border-line pt-4 font-semibold text-amber" data-testid="waiting-review">
          {item.card.reviewer ? copy.dashboard.waitingReview(item.card.reviewer) : t.clinicianOnly}
        </p>
      )}
    </article>
  );
}

export default function PcpInbox() {
  const q = useQuery({ queryKey: ["inbox"], queryFn: api.inbox, ...LIVE });
  const me = useMe();
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const n = q.data!.items.length;
  return (
    <div className="space-y-8">
      <h1 className="text-page font-bold" data-testid="inbox-heading">{me?.role === "clinician" ? copy.inbox.toReview(n) : copy.inbox.title}</h1>
      {q.data!.items.length === 0 && <p className="text-muted">{copy.inbox.empty}</p>}
      {q.data!.items.map((it) => <Item key={it.card.id} item={it} />)}
    </div>
  );
}
