import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { copy } from "../copy";
import { ErrorNote, Loading } from "./Status";

// Template draft with [F#] citations → edit → a person presses Send (R4.3, R4.4).
export function FollowUp({ rid, onClose }: { rid: string; onClose: () => void }) {
  const qc = useQueryClient();
  const draft = useQuery({ queryKey: ["draft", rid], queryFn: () => api.draft(rid) });
  const [text, setText] = useState("");
  useEffect(() => {
    if (draft.data) setText(draft.data.text);
  }, [draft.data]);
  const send = useMutation({
    mutationFn: () =>
      api.send(rid, {
        recipient: draft.data!.recipient,
        text,
        rule: draft.data!.rule,
        drafted_text: draft.data!.text,
      }),
    onSuccess: () => {
      qc.invalidateQueries();
      onClose();
    },
  });
  const t = copy.followUp;

  return (
    <section aria-labelledby="fu-h" className="space-y-3 rounded border border-accent p-3">
      <div className="flex items-center justify-between">
        <h2 id="fu-h" className="font-semibold">{t.title}</h2>
        <button type="button" onClick={onClose} className="text-sm text-slate-600 underline">{t.cancel}</button>
      </div>
      {draft.isLoading && <Loading />}
      {draft.error && <ErrorNote error={draft.error} />}
      {draft.data && (
        <>
          <p className="text-xs text-slate-600">{t.template}</p>
          <p className="text-sm">
            {t.to}: <span className="font-medium">{draft.data.recipient_label}</span> · {draft.data.rule_message}
          </p>
          <p className={"text-xs " + (draft.data.verified ? "text-emerald-800" : "text-rose-800")}>
            {draft.data.verified ? t.verified : `${t.notVerified} ${draft.data.problems.join("; ")}`}
          </p>
          <label className="block text-sm">
            {t.message}
            <textarea
              data-testid="followup-text"
              className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 font-mono text-sm"
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <details className="text-xs">
            <summary>{t.facts}</summary>
            <ul className="mt-1 space-y-0.5">
              {draft.data.facts.map((f) => (
                <li key={f.id}>
                  <span className="font-mono">[{f.id}]</span> {f.label}: {f.value}{" "}
                  <span className="text-slate-500">({f.source})</span>
                </li>
              ))}
            </ul>
          </details>
          <p className="text-xs text-slate-500">{t.sentBy} {copy.deliveryNote}</p>
          <button
            type="button"
            onClick={() => send.mutate()}
            disabled={!text.trim() || send.isPending}
            className="rounded bg-accent px-3 py-1 text-white disabled:opacity-50"
          >
            {t.send}
          </button>
          {send.error && <ErrorNote error={send.error} />}
        </>
      )}
    </section>
  );
}
