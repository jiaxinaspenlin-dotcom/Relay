import { useNavigate } from "react-router-dom";
import type { Card } from "../api";
import { primaryFlag } from "./RouteTrack";
import type { DrawerState } from "./ActionDrawers";
import { useCallKind } from "./ActionDrawers";
import { useCallMode, useCallOffice } from "./OfficeCall";

/** One next action per referral (card.next_action, computed on the server). The dashboard row
 * button and the referral detail's primary button both run it through this hook, so the label
 * and the behavior always match. */
export function useRunNextAction(setDrawer: (s: DrawerState) => void) {
  const nav = useNavigate();
  const mode = useCallMode();
  const callKind = useCallKind();
  const callOffice = useCallOffice();
  const run = (card: Card) => {
    const a = card.next_action;
    if (!a) return;
    const rid = card.id;
    const rule = primaryFlag(card.stuck)?.rule;
    switch (a.key) {
      case "call_office":
        if (mode === "phone") callOffice.mutate(rid);
        else setDrawer({ kind: callKind, rid });
        return;
      case "send_records":
      case "request_authorization":
      case "follow_up":
        setDrawer({ kind: "follow_up", rid, rule });
        return;
      case "message_patient":
        setDrawer({ kind: "patient", rid });
        return;
      case "resend":
        setDrawer({ kind: "resend", rid });
        return;
      case "request_ride":
        nav(`/referrals/${rid}#barriers`);
        return;
    }
  };
  return { run, pending: callOffice.isPending, error: callOffice.error as Error | null };
}
