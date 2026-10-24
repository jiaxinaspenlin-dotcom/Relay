import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LIVE, api, type CallAttempt, type CallBrief, type Detail } from "../api";
import { copy } from "../copy";
import { suggestionToPrefill } from "./ActionDrawers";
import { ErrorNote } from "./Status";
import type { UpdatePrefill } from "./UpdateForm";
import { Button, Panel } from "./ui";

/** How "Call office" works for this user: a real phone call placed by the server (default), the
 * in-browser AI call when only voice is configured, or Log update. Coordinators only. */
export type CallMode = "phone" | "call" | "update";
export function useCallMode(): CallMode {
  const cfg = useQuery({ queryKey: ["config"], queryFn: api.config, staleTime: Infinity });
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, retry: false, staleTime: 60_000 });
  if (me.data?.user.role !== "coordinator") return "update";
  if (cfg.data?.phone_calling_enabled) return "phone";
  return cfg.data?.voice_enabled ? "call" : "update";
}

export function useCallOffice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rid: string) => api.callOffice(rid),
    onSuccess: (_d, rid) => {
      qc.invalidateQueries({ queryKey: ["calls", rid] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

/** A "no answer" stays visible for the day it happened; after that the row goes back to normal. */
export function recentNoAnswer(c: CallBrief | null | undefined): boolean {
  return !!c && c.status === "no_answer" && new Date(c.started_at).toDateString() === new Date().toDateString();
}

/** Dashboard row status for an AI phone call, or null when there's nothing to show. */
export function rowCallStatus(c: CallBrief | null | undefined): { text: string; tone: "calling" | "ready" | "none" } | null {
  const t = copy.phoneCall;
  if (!c) return null;
  if (c.status === "calling") return { text: t.calling(c.practice), tone: "calling" };
  if (c.status === "ready_for_review") return { text: t.finished, tone: "ready" };
  if (recentNoAnswer(c)) return { text: t.noAnswer, tone: "none" };
  return null;
}

function Transcript({ call }: { call: CallAttempt }) {
  const t = copy.phoneCall;
  return (
    <details className="rounded-control border border-line px-4 py-2">
      <summary className="cursor-pointer text-hemlock min-h-[32px] flex items-center">{t.viewTranscript}</summary>
      {/* Voice tags ("[happy]") are stripped on the server. */}
      <ol className="mt-2 space-y-2 text-caption" data-testid="call-transcript">
        {call.transcript.map((turn, i) => (
          <li key={i}><span className="font-semibold">{turn.role === "agent" ? t.agent : t.office}:</span> {turn.message}</li>
        ))}
      </ol>
    </details>
  );
}

/** Referral detail: the newest phone call. "Calling…", then the result card (Apply / Edit / View
 * transcript) or "No answer, try again". Nothing is applied until the coordinator presses Apply. */
export function CallPanel({ d, onEdit, onPatientMessage }: {
  d: Detail; onEdit: (p: UpdatePrefill) => void; onPatientMessage: () => void;
}) {
  const rid = d.card.id;
  const qc = useQueryClient();
  const t = copy.phoneCall;
  const calls = useQuery({ queryKey: ["calls", rid], queryFn: () => api.calls(rid), ...LIVE });
  const again = useCallOffice();
  const apply = useMutation({ mutationFn: (cid: string) => api.applyCall(rid, cid), onSuccess: () => qc.invalidateQueries() });
  const usePhone = useMutation({
    mutationFn: (phone: string) => api.setOfficePhone(rid, phone),
    onSuccess: () => { qc.invalidateQueries(); onPatientMessage(); },
  });
  const [usedPhone, setUsedPhone] = useState(false);
  const call = calls.data?.calls[0];
  if (!call) return null;

  if (call.status === "calling") return null; // the header shows "Calling…"
  if (call.status === "no_answer") {
    if (!recentNoAnswer(call)) return null;
    return (
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" data-testid="call-status">
            <span className="font-semibold text-amber">{t.noAnswer}</span>
            {call.reason && <span className="block text-caption text-muted">{call.reason}.</span>}
          </p>
          {d.card.can_call && <Button onClick={() => again.mutate(rid)} disabled={again.isPending}>{t.tryAgain}</Button>}
        </div>
        {again.error && <div className="mt-2"><ErrorNote error={again.error} /></div>}
      </Panel>
    );
  }
  if (call.status !== "ready_for_review" || !call.result) return null;

  const r = call.result;
  const prefill: UpdatePrefill = {
    ...(suggestionToPrefill(r) ?? { action: "", note: [r.proposed_action, r.note].filter(Boolean).join(". "), phone: r.scheduling_phone, fromAi: true }),
    callId: call.id,
  };
  const phone = r.scheduling_phone;
  const canUsePhone = !!phone && d.can_message_patient && phone !== d.referral.performer.phone;
  return (
    <Panel title={t.resultTitle} id="call-h" className="border-hemlock">
      <div className="space-y-4" data-testid="call-result">
        <p className="text-caption text-muted">{t.meta(call.user_name, call.duration_label)}</p>
        <p className="font-semibold" data-testid="call-summary">{call.summary}</p>
        {r.proposed_action && <p className="text-amber font-semibold">{t.next(r.proposed_action)}</p>}
        {r.validation_errors.length > 0 && (
          <div className="rounded-control bg-amber-tint px-3 py-2 text-caption">
            <div className="font-semibold text-amber">{t.checks}</div>
            <ul className="list-disc pl-6">{r.validation_errors.map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => apply.mutate(call.id)} disabled={apply.isPending}>{t.apply}</Button>
          <Button onClick={() => onEdit(prefill)}>{t.edit}</Button>
          {canUsePhone && !usedPhone && (
            <Button variant="quiet" onClick={() => { setUsedPhone(true); usePhone.mutate(phone!); }} disabled={usePhone.isPending}>{t.usePhone}</Button>
          )}
        </div>
        {apply.error && <ErrorNote error={apply.error} />}
        {usePhone.error && <ErrorNote error={usePhone.error} />}
        <Transcript call={call} />
      </div>
    </Panel>
  );
}
