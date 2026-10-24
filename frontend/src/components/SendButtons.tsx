import { copy } from "../copy";
import { copyText, openMail, openPrintWindow, printUrl } from "./sendActions";
import { Button } from "./ui";

export type Channel = "copy" | "email" | "print";
export type SendResult = string | { commId: string; rid?: string; subject?: string; text?: string };

/**
 * Copy text / Open in email / Print. `send` records the Communication and returns its id (or the
 * created referral's id and text, when the text only exists after sending). The print window is
 * opened first so popup blockers allow it.
 */
export function SendButtons({ rid, subject, text, send, disabled, primary = "copy" }: {
  rid: string; subject: string; text: string; disabled?: boolean; primary?: Channel | null;
  send: (channel: Channel) => Promise<SendResult>;
}) {
  const go = async (channel: Channel) => {
    const win = channel === "print" ? openPrintWindow() : null;
    if (channel === "copy" && text) await copyText(text);
    let r: SendResult;
    try {
      r = await send(channel);
    } catch (e) {
      win?.close();
      throw e;
    }
    const res = typeof r === "string" ? { commId: r } : r;
    const body = res.text ?? text;
    if (channel === "copy" && !text && body) await copyText(body);
    if (channel === "email") openMail(res.subject ?? subject, body);
    if (channel === "print") {
      const url = printUrl(res.rid ?? rid, res.commId);
      if (win) win.location.href = url;
      else window.location.href = url;
    }
  };
  const click = (c: Channel) => () => { go(c).catch(() => undefined); };
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant={primary === "copy" ? "primary" : "outline"} onClick={click("copy")} disabled={disabled}>{copy.send.copy}</Button>
      <Button onClick={click("email")} disabled={disabled}>{copy.send.email}</Button>
      <Button onClick={click("print")} disabled={disabled}>{copy.send.print}</Button>
    </div>
  );
}
