import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { copy } from "../copy";
import { describe } from "../components/Timeline";
import { Loading } from "../components/Status";
import { longDate, shortDate } from "../format";

// One-page, human-readable referral summary styled for print (Export → Print summary).
export default function SummaryPage() {
  const { rid = "" } = useParams();
  const q = useQuery({ queryKey: ["referral", rid], queryFn: () => api.referral(rid) });
  const t = copy.summary;
  if (q.isLoading) return <div className="p-12"><Loading /></div>;
  if (!q.data) return <p className="p-6">{copy.print.notFound}</p>;
  const d = q.data;
  const c = d.card;
  const r = d.referral;
  const rows: [string, string][] = [
    [t.from, `${r.requester.practice}${r.requester.clinician ? `, ${r.requester.clinician}` : ""}`],
    [t.to, `${c.performer.name}, ${c.performer.town}`],
    [t.route, c.miles === null ? `${c.patient.town} to ${c.performer.town}` : `${c.patient.town} to ${c.performer.town}, ${c.miles} mi`],
    [t.coverage, c.patient.coverage_label],
    [t.status, c.status_sentence],
    [t.reason, r.reason_text],
  ];
  return (
    <div className="mx-auto max-w-[8.5in] bg-white p-12 text-[14px] leading-6 text-black print:p-0" data-testid="summary">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link to={`/referrals/${rid}`} className="text-hemlock underline">{copy.print.back}</Link>
        <button type="button" onClick={() => window.print()} className="h-10 rounded-control bg-hemlock px-4 font-semibold text-white">{t.print}</button>
      </div>
      <h1 className="text-[22px] font-bold">{t.title(c.patient.name)}</h1>
      <p className="mb-6 text-[13px]">{c.specialty} · {r.id}</p>
      <dl className="mb-6 grid grid-cols-[160px_1fr] gap-x-4 gap-y-2 border-y border-black/30 py-4">
        {rows.map(([k, v]) => <div key={k} className="contents"><dt className="font-semibold">{k}</dt><dd>{v}</dd></div>)}
      </dl>
      {r.plan && (
        <section className="mb-6">
          <h2 className="mb-2 text-[16px] font-bold">{t.plan}</h2>
          <p><strong>{r.plan.from}</strong>, {shortDate(r.plan.visit_date)}</p>
          <p>{r.plan.assessment}</p>
          <p>{r.plan.plan}</p>
        </section>
      )}
      <section>
        <h2 className="mb-2 text-[16px] font-bold">{t.timeline}</h2>
        <ol className="space-y-1">
          {d.timeline.map((it, i) => {
            const { title, subtitle } = describe(it);
            return <li key={i} className="grid grid-cols-[64px_1fr] gap-3"><span>{shortDate(it.at)}</span><span><strong>{title}</strong>{subtitle ? ` · ${subtitle}` : ""}</span></li>;
          })}
        </ol>
      </section>
      <p className="mt-12 border-t border-black/40 pt-2 text-[12px]">{t.generated(longDate(new Date().toISOString().slice(0, 10)))}</p>
    </div>
  );
}
