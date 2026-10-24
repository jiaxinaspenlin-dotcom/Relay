import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Phone, X } from "lucide-react";
import { LIVE, api, type CallAttempt, type CallBrief, type Detail } from "../api";
import { copy } from "../copy";
import { suggestionToPrefill } from "./ActionDrawers";
import { ErrorNote } from "./Status";
import { useToast } from "./Toast";
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

/** The call to show on a row (in place of its action button), or null. */
export function activeCall(c: CallBrief | null | undefined): CallBrief | null {
  if (!c) return null;
  if (c.status === "calling" || c.status === "ready_for_review" || recentNoAnswer(c)) return c;
  return null;
}

export type CallState = "dialing" | "on_call" | "reading" | "ready" | "no_answer";
export function callState(c: CallBrief): CallState {
  if (c.status === "ready_for_review") return "ready";
  if (c.status === "no_answer") return "no_answer";
  if (c.phase === "in-progress") return "on_call";
  if (c.phase === "processing") return "reading";
  return "dialing";
}

/** m:ss since the call started; ticks every second while `live` (also under reduced motion). */
export function useElapsed(startIso: string, live: boolean): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [live]);
  const secs = Math.max(0, Math.floor((now - new Date(startIso).getTime()) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

export function VoiceBars({ light = false }: { light?: boolean }) {
  return (
    <span aria-hidden="true" className="inline-flex h-4 items-center gap-[2px]">
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={`voice-bar w-[3px] rounded-full ${light ? "bg-white" : "bg-hemlock"}`} style={{ animationDelay: `${i * 120}ms` }} />
      ))}
    </span>
  );
}

/** The live call chip. Same spot and size as the row's action button (40px), so nothing jumps:
 * Dialing office → On the call 0:42 → Reading the call 1:05 → Review call update, or No answer. */
export function CallChip({ call, onReview, onRetry }: { call: CallBrief; onReview: () => void; onRetry: () => void }) {
  const t = copy.phoneCall;
  const state = callState(call);
  const elapsed = useElapsed(call.started_at, state === "dialing" || state === "on_call" || state === "reading");
  const pill = "inline-flex h-10 items-center gap-2 rounded-full border pl-[6px] pr-4 text-caption font-semibold whitespace-nowrap";
  const circle = "relative inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full";
  let chip;
  if (state === "dialing") {
    chip = (
      <span className={`${pill} border-line bg-surface text-ink`}>
        <span className={`${circle} bg-hemlock-tint`}>
          <span aria-hidden="true" className="call-ring absolute inset-0 rounded-full border border-hemlock" />
          <span aria-hidden="true" className="call-ring absolute inset-0 rounded-full border border-hemlock" style={{ animationDelay: "800ms" }} />
          <Phone size={14} strokeWidth={2} className="phone-wiggle text-hemlock" aria-hidden="true" />
        </span>
        <span>{t.dialing}</span>
      </span>
    );
  } else if (state === "on_call") {
    chip = (
      <span className={`${pill} border-hemlock bg-hemlock-tint text-hemlock`}>
        <span className={`${circle} bg-hemlock`}><Phone size={14} strokeWidth={2} className="text-white" aria-hidden="true" /></span>
        <VoiceBars />
        <span>{t.onCall} <span className="tabular-nums">{elapsed}</span></span>
      </span>
    );
  } else if (state === "reading") {
    chip = (
      <span className={`${pill} border-line bg-surface text-ink`}>
        <span className={`${circle} bg-hemlock-tint`}>
          <svg aria-hidden="true" viewBox="0 0 16 16" className="call-spin h-4 w-4"><circle cx="8" cy="8" r="6" fill="none" stroke="#1F5F5B" strokeWidth="2" strokeDasharray="22 40" strokeLinecap="round" /></svg>
        </span>
        <span className="shimmer-text">{t.reading} <span className="tabular-nums">{elapsed}</span></span>
      </span>
    );
  } else if (state === "ready") {
    chip = (
      <button type="button" onClick={onReview} className={`${pill} call-pop border-hemlock bg-hemlock text-white hover:bg-[#184d4a]`}>
        <span className={`${circle} bg-white/20`}><Check size={14} strokeWidth={2.4} aria-hidden="true" /></span>
        <span>{t.review}</span>
      </button>
    );
  } else {
    chip = (
      <span className={`${pill} border-amber/40 bg-amber-tint pr-1 text-amber`}>
        <span className={`${circle} bg-surface`}><X size={14} strokeWidth={2.4} aria-hidden="true" /></span>
        <span>{t.noAnswerShort}</span>
        <span aria-hidden="true" className="h-6 w-px bg-amber/40" />
        <button type="button" onClick={onRetry} className="h-8 rounded-full px-3 text-amber underline-offset-2 hover:underline">{t.tryAgain}</button>
      </span>
    );
  }
  return (
    <span data-testid="row-call" data-state={state} className="inline-flex">
      {chip}
      {/* Announce state changes, not every timer tick. */}
      <span className="sr-only" role="status" aria-live="polite">{t.announce[state](call.practice)}</span>
    </span>
  );
}

function Transcript({ call }: { call: CallAttempt }) {
  const t = copy.phoneCall;
  return (
    <details className="rounded-control border border-line px-4 py-2">
      <summary className="flex min-h-[32px] cursor-pointer items-center text-hemlock">{t.viewTranscript}</summary>
      {/* Voice tags ("[happy]") are stripped on the server. */}
      <ol className="mt-2 space-y-2 text-caption" data-testid="call-transcript">
        {call.transcript.map((turn, i) => (
          <li key={i}><span className="font-semibold">{turn.role === "agent" ? t.agent : t.office}:</span> {turn.message}</li>
        ))}
      </ol>
    </details>
  );
}

/** Referral detail during a call: a white card at the top with the step line. */
function LiveCallCard({ call }: { call: CallAttempt }) {
  const t = copy.phoneCall;
  const state = callState(call);
  const elapsed = useElapsed(call.started_at, true);
  const steps: { key: CallState | "done"; label: string }[] = [
    { key: "dialing", label: t.steps.dialed },
    { key: "on_call", label: `${t.steps.onCall} · ${elapsed}` },
    { key: "reading", label: t.steps.summarizing },
    { key: "ready", label: t.steps.ready },
  ];
  const at = steps.findIndex((s) => s.key === state);
  return (
    <section className="rounded-panel border border-line bg-surface p-6 max-[859px]:p-4" data-testid="live-call" aria-labelledby="live-call-h">
      <div className="flex flex-wrap items-center gap-4">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-hemlock">
          <Phone size={20} strokeWidth={2} className={`text-white ${state === "dialing" ? "phone-wiggle" : ""}`} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="live-call-h" className="flex flex-wrap items-center gap-3 font-semibold">
            {t.liveTitle(call.practice)}
            {state === "on_call" && <VoiceBars />}
          </h2>
          <ol className="mt-1 flex flex-wrap items-center gap-x-2 text-caption" data-testid="live-call-steps">
            {steps.map((s, i) => (
              <li key={s.key} className="flex items-center gap-2">
                {i > 0 && <span aria-hidden="true" className="text-muted">—</span>}
                <span className={i === at ? "font-bold text-hemlock" : i < at ? "text-ink" : "text-muted"} aria-current={i === at ? "step" : undefined}>
                  {s.label}
                </span>
              </li>
            ))}
          </ol>
        </div>
        <span className="text-caption text-muted">{t.keepWorking}</span>
      </div>
      <span className="sr-only" role="status" aria-live="polite">{t.announce[state](call.practice)}</span>
    </section>
  );
}

export function useCalls(rid: string) {
  return useQuery({ queryKey: ["calls", rid], queryFn: () => api.calls(rid), ...LIVE });
}

/** Referral detail: the newest phone call. While it runs, the live call card; then the result card
 * (Apply / Edit / View transcript) or "No answer, try again". Nothing is applied until Apply. */
export function CallPanel({ d, onEdit, onPatientMessage }: {
  d: Detail; onEdit: (p: UpdatePrefill) => void; onPatientMessage: () => void;
}) {
  const rid = d.card.id;
  const qc = useQueryClient();
  const toast = useToast();
  const t = copy.phoneCall;
  const calls = useCalls(rid);
  const again = useCallOffice();
  const apply = useMutation({
    mutationFn: (cid: string) => api.applyCall(rid, cid),
    onSuccess: () => { qc.invalidateQueries(); toast(copy.toast.applied); },
  });
  const usePhone = useMutation({
    mutationFn: (phone: string) => api.setOfficePhone(rid, phone),
    onSuccess: () => { qc.invalidateQueries(); onPatientMessage(); },
  });
  const [usedPhone, setUsedPhone] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const call = calls.data?.calls[0];
  // "Review call update" on the dashboard links here with #call-result.
  useEffect(() => {
    if (call?.status === "ready_for_review" && window.location.hash === "#call-result") {
      ref.current?.scrollIntoView({ block: "start" });
    }
  }, [call?.status]);
  if (!call) return null;

  if (call.status === "calling") return <LiveCallCard call={call} />;
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
    <div ref={ref} id="call-result" className="scroll-mt-6">
      <Panel title={t.resultTitle} id="call-h" className="border-hemlock">
        <div className="space-y-4" data-testid="call-result">
          <p className="text-caption text-muted">{t.meta(call.user_name, call.duration_label)}</p>
          <p className="font-semibold" data-testid="call-summary">{call.summary}</p>
          {r.proposed_action && <p className="font-semibold text-amber">{t.next(r.proposed_action)}</p>}
          {r.validation_errors.length > 0 && (
            <div className="rounded-control border border-amber/40 bg-surface px-3 py-2 text-caption">
              <div className="font-semibold text-amber">{t.checks}</div>
              <ul className="list-disc pl-6">{r.validation_errors.map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
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
    </div>
  );
}
