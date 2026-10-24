import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { copy } from "../copy";
import { longDate } from "../format";
import { Loading } from "../components/Status";

// Fax-ready page for one recorded Communication: cover block, then the message. Opens print.
export default function PrintPage() {
  const { rid = "", commId = "" } = useParams();
  const [params] = useSearchParams();
  const q = useQuery({ queryKey: ["referral", rid], queryFn: () => api.referral(rid) });
  const comm = q.data?.referral.communications.find((c) => c.id === commId);
  useEffect(() => {
    if (comm && params.get("noprint") !== "1") {
      const id = setTimeout(() => window.print(), 300);
      return () => clearTimeout(id);
    }
  }, [comm, params]);
  const t = copy.print;
  if (q.isLoading) return <Loading />;
  if (!q.data || !comm) return <p className="p-6">{t.notFound}</p>;
  const r = q.data.referral;
  const re = `${comm.kind === "referral" ? "Referral" : "Follow-up"}: ${q.data.card.specialty}, ${q.data.card.patient.name}`;

  return (
    <div className="mx-auto max-w-[8.5in] bg-white p-10 text-[14px] text-black print:p-0">
      <div className="mb-6 flex justify-between print:hidden">
        <Link to={`/referrals/${rid}`} className="text-hemlock underline">{t.back}</Link>
        <button type="button" onClick={() => window.print()} className="min-h-[40px] rounded-control bg-hemlock px-4 font-semibold text-white">{t.printNow}</button>
      </div>
      <h1 className="border-b-4 border-black pb-1 text-4xl font-bold">{t.fax}</h1>
      <table className="mt-4 w-full border-collapse" data-testid="fax-cover">
        <tbody>
          {([
            [t.to, `${r.performer.name}${r.performer.address ? `, ${r.performer.address}` : ""}, ${r.performer.town}`],
            [t.from, `${r.requester.clinician}, ${r.requester.practice}. Contact: ${r.requester.coordinator}`],
            [t.date, longDate(comm.sent)],
            [t.re, re],
            [t.pages, t.pagesValue],
          ] as const).map(([k, v]) => (
            <tr key={k} className="border-b border-black/30">
              <th className="w-24 py-2 pr-3 text-left align-top font-semibold">{k}</th>
              <td className="py-2">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <pre className="mt-6 whitespace-pre-wrap font-sans leading-relaxed">{comm.text}</pre>
      <p className="mt-10 border-t border-black/40 pt-2 text-[12px]">{t.confidential}</p>
    </div>
  );
}
