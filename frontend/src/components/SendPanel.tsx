import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { copy } from "../copy";
import { copyText, openMail, openPrintWindow, printUrl } from "./sendActions";
import { ErrorNote } from "./Status";
import { Button, Panel } from "./ui";

type Channel = "copy" | "email" | "print";

// Send the referral: Copy text / Open in email / Print (fax-ready). Each records a Communication;
// the first send moves Draft → Sent.
export function SendPanel({ rid, stage, officePath }: { rid: string; stage: string; officePath: string }) {
  const qc = useQueryClient();
  const msg = useQuery({ queryKey: ["message", rid], queryFn: () => api.referralMessage(rid) });
  const [done, setDone] = useState<Channel | "">("");
  const [linkCopied, setLinkCopied] = useState(false);
  const officeUrl = `${window.location.origin}${officePath}`;
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
    onSuccess: (channel) => {
      setDone(channel);
      qc.invalidateQueries();
    },
  });
  const go = (channel: Channel) => send.mutate({ channel, win: channel === "print" ? openPrintWindow() : null });

  return (
    <Panel title={stage === "draft" ? t.title : t.resend} id="send-h" className={stage === "draft" ? "border-accent" : ""}>
      {stage === "draft" && <p className="mb-2 text-sm text-slate-700">{t.draftNote}</p>}
      <p className="text-xs text-slate-500">{t.help} {copy.deliveryNote}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant={stage === "draft" ? "primary" : "secondary"} onClick={() => go("copy")} disabled={!msg.data || send.isPending}>
          {done === "copy" ? t.copied : t.copy}
        </Button>
        <Button onClick={() => go("email")} disabled={!msg.data || send.isPending}>{t.email}</Button>
        <Button onClick={() => go("print")} disabled={!msg.data || send.isPending}>{t.print}</Button>
      </div>
      {send.error && <div className="mt-2"><ErrorNote error={send.error} /></div>}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-slate-600">{t.preview}</summary>
        <pre data-testid="referral-message" className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 font-sans text-sm">{msg.data?.text}</pre>
      </details>
      <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm">
        <div className="font-medium">{t.officeLink}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <a href={officePath} data-testid="office-link" className="break-all font-mono text-xs text-accent underline" target="_blank" rel="noreferrer">{officeUrl}</a>
          <Button variant="quiet" onClick={async () => setLinkCopied(await copyText(officeUrl))}>{linkCopied ? t.copied : t.copyLink}</Button>
        </div>
        <p className="mt-1 text-xs text-slate-500">{t.officeLinkHelp}</p>
      </div>
    </Panel>
  );
}
