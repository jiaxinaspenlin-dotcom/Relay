import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { copy } from "../copy";
import { copyText, openMail, openPrintWindow, printUrl } from "./sendActions";
import { ErrorNote } from "./Status";
import { Button, Muted } from "./ui";

type Channel = "copy" | "email" | "print";

// Send the referral by Copy text, email, or a fax-ready print page. Each records a Communication;
// the first send moves Draft to Sent.
export function SendPanel({ rid, stage, officePath }: { rid: string; stage: string; officePath: string }) {
  const qc = useQueryClient();
  const msg = useQuery({ queryKey: ["message", rid], queryFn: () => api.referralMessage(rid) });
  const [done, setDone] = useState<Channel | "">("");
  const [linkCopied, setLinkCopied] = useState(false);
  const officeUrl = `${window.location.origin}${officePath}`;
  const draft = stage === "draft";
  const t = copy.send;

  const send = useMutation({
    mutationFn: async ({ channel, win }: { channel: Channel; win: Window | null }) => {
      if (channel === "copy" && msg.data) await copyText(msg.data.text);
      const r = await api.sendReferral(rid, channel);
      if (channel === "email") openMail(r.message.subject, r.message.text);
      if (channel === "print") {
        const url = printUrl(rid, r.communication_id);
        if (win) win.location.href = url;
        else window.location.href = url;
      }
      return channel;
    },
    onSuccess: (channel) => { setDone(channel); qc.invalidateQueries(); },
  });
  const go = (channel: Channel) => send.mutate({ channel, win: channel === "print" ? openPrintWindow() : null });

  return (
    <section aria-labelledby="send-h" className={`rounded-panel border bg-surface p-5 ${draft ? "border-hemlock" : "border-line"}`}>
      <h2 id="send-h" className="text-section font-semibold">{draft ? t.title : t.resend}</h2>
      {draft && <p className="mt-1">{t.draftNote}</p>}
      <Muted>{t.help} {copy.deliveryNote}</Muted>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant={draft ? "primary" : "outline"} onClick={() => go("copy")} disabled={!msg.data || send.isPending}>
          {done === "copy" ? t.copied : t.copy}
        </Button>
        <Button onClick={() => go("email")} disabled={!msg.data || send.isPending}>{t.email}</Button>
        <Button onClick={() => go("print")} disabled={!msg.data || send.isPending}>{t.print}</Button>
      </div>
      {send.error && <div className="mt-2"><ErrorNote error={send.error} /></div>}
      <details className="mt-3">
        <summary className="cursor-pointer text-hemlock">{t.preview}</summary>
        <pre data-testid="referral-message" className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-control bg-paper p-3 font-sans text-caption">{msg.data?.text}</pre>
      </details>
      <div className="mt-4 border-t border-line pt-3">
        <div className="font-semibold">{t.officeLink}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <a href={officePath} data-testid="office-link" className="break-all text-caption text-hemlock underline" target="_blank" rel="noreferrer">{officeUrl}</a>
          <Button variant="quiet" onClick={async () => setLinkCopied(await copyText(officeUrl))}>{linkCopied ? t.copied : t.copyLink}</Button>
        </div>
        <Muted>{t.officeLinkHelp}</Muted>
      </div>
    </section>
  );
}
