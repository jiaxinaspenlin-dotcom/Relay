import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { copy } from "../copy";
import { copyText, openMail, openPrintWindow, printUrl } from "./sendActions";
import { ErrorNote, Loading } from "./Status";
import { Button, Field, Panel, inputCls } from "./ui";

type Channel = "copy" | "email" | "print";

// Template draft with [F#] citations → edit → a person sends it by copy, email, or fax.
export function FollowUp({ rid, onClose }: { rid: string; onClose: () => void }) {
  const qc = useQueryClient();
  const draft = useQuery({ queryKey: ["draft", rid], queryFn: () => api.draft(rid) });
  const [text, setText] = useState("");
  useEffect(() => {
    if (draft.data) setText(draft.data.text);
  }, [draft.data]);
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
    onSuccess: () => {
      qc.invalidateQueries();
      onClose();
    },
  });
  const go = (channel: Channel) => send.mutate({ channel, win: channel === "print" ? openPrintWindow() : null });

  return (
    <Panel title={t.title} id="fu-h" className="border-accent" actions={<Button variant="quiet" onClick={onClose}>{t.close}</Button>}>
      {draft.isLoading && <Loading />}
      {draft.error && <ErrorNote error={draft.error} />}
      {draft.data && (
        <div className="space-y-3">
          <p className="text-sm">
            {t.to}: <span className="font-medium">{draft.data.recipient_label}</span> ·{" "}
            <span className="text-amber-800">{draft.data.rule_message}</span>
          </p>
          <p className="text-xs text-slate-500">{t.template}</p>
          <p className={`text-xs ${draft.data.verified ? "text-emerald-700" : "text-rose-700"}`}>
            {draft.data.verified ? t.verified : `${t.notVerified} ${draft.data.problems.join("; ")}`}
          </p>
          <Field label={t.message}>
            <textarea data-testid="followup-text" className={`${inputCls} font-mono`} rows={9} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <details className="text-xs text-slate-600">
            <summary className="cursor-pointer">{t.facts}</summary>
            <ul className="mt-1 space-y-0.5">
              {draft.data.facts.map((f) => (
                <li key={f.id}><span className="font-mono">[{f.id}]</span> {f.label}: {f.value} <span className="text-slate-400">({f.source})</span></li>
              ))}
            </ul>
          </details>
          <p className="text-xs text-slate-500">{t.sentBy} {copy.deliveryNote}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => go("copy")} disabled={!text.trim() || send.isPending}>{copy.send.copy}</Button>
            <Button onClick={() => go("email")} disabled={!text.trim() || send.isPending}>{copy.send.email}</Button>
            <Button onClick={() => go("print")} disabled={!text.trim() || send.isPending}>{copy.send.print}</Button>
          </div>
          {send.error && <ErrorNote error={send.error} />}
        </div>
      )}
    </Panel>
  );
}
