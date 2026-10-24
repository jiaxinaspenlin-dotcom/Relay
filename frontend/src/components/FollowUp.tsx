import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { copy } from "../copy";
import { copyText, openMail, openPrintWindow, printUrl } from "./sendActions";
import { ErrorNote, Loading } from "./Status";
import { Button, Field, Muted, inputCls } from "./ui";

type Channel = "copy" | "email" | "print";

// Follow-up drawer: template draft with [F#] citations, edit, then a person sends it.
export function FollowUp({ rid, onClose }: { rid: string; onClose: () => void }) {
  const qc = useQueryClient();
  const draft = useQuery({ queryKey: ["draft", rid], queryFn: () => api.draft(rid) });
  const [text, setText] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (draft.data) setText(draft.data.text); }, [draft.data]);
  // Focus the drawer once on open; Escape closes. onClose is read through a ref so a new parent
  // callback each render doesn't re-run this and steal focus from the textarea.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const t = copy.followUp;

  const send = useMutation({
    mutationFn: async ({ channel, win }: { channel: Channel; win: Window | null }) => {
      const d = draft.data!;
      if (channel === "copy") await copyText(text);
      const r = await api.sendFollowUp(rid, { recipient: d.recipient, text, rule: d.rule, drafted_text: d.text, channel });
      if (channel === "email") openMail(d.subject, text);
      if (channel === "print") {
        const url = printUrl(rid, r.communication_id);
        if (win) win.location.href = url;
        else window.location.href = url;
      }
    },
    onSuccess: () => { qc.invalidateQueries(); onClose(); },
  });
  const go = (channel: Channel) => send.mutate({ channel, win: channel === "print" ? openPrintWindow() : null });

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/20" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fu-h"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-xl overflow-y-auto border-l border-line bg-surface p-6 shadow-pop focus:outline-none"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="fu-h" className="text-section font-semibold">{t.title}</h2>
          <Button variant="quiet" onClick={onClose}>{t.close}</Button>
        </div>
        {draft.isLoading && <Loading />}
        {draft.error && <ErrorNote error={draft.error} />}
        {draft.data && (
          <div className="space-y-4">
            <p>{t.to} {draft.data.recipient_label.toLowerCase()}. <span className="text-amber">{draft.data.rule_message.replace(" — ", ", ")}.</span></p>
            <Muted>{t.template}</Muted>
            <p className={`text-caption ${draft.data.verified ? "text-hemlock" : "text-rust"}`}>
              {draft.data.verified ? t.verified : `${t.notVerified} ${draft.data.problems.join("; ")}`}
            </p>
            <Field label={t.message}>
              <textarea data-testid="followup-text" className={inputCls} rows={11} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            <details>
              <summary className="cursor-pointer text-hemlock">{t.facts}</summary>
              <dl className="mt-2 space-y-1 text-caption">
                {draft.data.facts.map((f) => (
                  <div key={f.id} className="grid grid-cols-[3rem_1fr] gap-2">
                    <dt className="text-muted">[{f.id}]</dt>
                    <dd>{f.label}: {f.value} <span className="text-muted">({f.source})</span></dd>
                  </div>
                ))}
              </dl>
            </details>
            <Muted>{t.sentBy} {copy.deliveryNote}</Muted>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => go("copy")} disabled={!text.trim() || send.isPending}>{copy.send.copy}</Button>
              <Button onClick={() => go("email")} disabled={!text.trim() || send.isPending}>{copy.send.email}</Button>
              <Button onClick={() => go("print")} disabled={!text.trim() || send.isPending}>{copy.send.print}</Button>
            </div>
            {send.error && <ErrorNote error={send.error} />}
          </div>
        )}
      </div>
    </div>
  );
}
