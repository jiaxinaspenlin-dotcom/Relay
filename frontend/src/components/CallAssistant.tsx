/**
 * CallAssistant — AI voice call to a specialist office about a stuck referral.
 *
 * Built on @elevenlabs/react 1.19.x (ConversationProvider + useConversation).
 * Flow:
 *   1. POST /api/referrals/{id}/call-session  → { conversation_token, dynamic_variables }
 *      (backend fetches the token from ElevenLabs with the server-side API key)
 *   2. Voice session in the browser (WebRTC). Transcript streams in live.
 *   3. On end: POST /api/referrals/{id}/call-transcript { conversation_id, turns }
 *      → suggested update (validated server-side). Nothing is saved until the
 *      coordinator confirms it in the Log update form (onSuggestion callback).
 *
 * Demo rule: talk to a teammate playing the office. Never call real offices.
 */
import { useCallback, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";

type Turn = { role: "agent" | "user"; message: string; eventId: number };

export type CallSuggestion = {
  received: "yes" | "no" | "unknown";
  missing_items: string[];
  patient_contacted: "yes" | "no" | "unknown";
  scheduling_phone: string | null;
  scheduling_hours: string | null;
  note: string;
  proposed_stage?: string | null;
  validation_errors?: string[];
};

type Props = {
  referralId: string;
  apiBase?: string;
  onSuggestion?: (s: CallSuggestion) => void;
};

function CallAssistantInner({ referralId, apiBase = "/api", onSuggestion }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [phase, setPhase] = useState<"idle" | "starting" | "live" | "checking" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<CallSuggestion | null>(null);
  const turnsRef = useRef<Turn[]>([]);
  const conversationIdRef = useRef<string | null>(null);

  const submitTranscript = useCallback(async () => {
    const finalTurns = turnsRef.current.filter((t) => t.message.trim());
    if (finalTurns.length === 0) {
      setPhase("error");
      setError("The call ended before anything was said. Start the call again.");
      return;
    }
    setPhase("checking");
    try {
      const res = await fetch(`${apiBase}/referrals/${encodeURIComponent(referralId)}/call-transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationIdRef.current,
          turns: finalTurns.map(({ role, message }) => ({ role, message })),
        }),
      });
      if (!res.ok) throw new Error(`Transcript check failed (${res.status}). The transcript is shown below; log the update by hand.`);
      const s: CallSuggestion = await res.json();
      setSuggestion(s);
      setPhase("done");
      onSuggestion?.(s);
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [apiBase, referralId, onSuggestion]);

  const conversation = useConversation({
    onConnect: () => setPhase("live"),
    onDisconnect: () => {
      void submitTranscript();
    },
    onError: (e: unknown) => {
      setPhase("error");
      setError(typeof e === "string" ? e : "The voice connection failed. Check the microphone permission and try again.");
    },
    onMessage: ({ message, role, event_id }) => {
      // Tentative and final transcriptions share an event_id; keep the latest per (role, event).
      const next = [...turnsRef.current];
      const i = next.findIndex((t) => t.eventId === event_id && t.role === role);
      const turn: Turn = { role, message, eventId: event_id };
      if (i >= 0) next[i] = turn;
      else next.push(turn);
      turnsRef.current = next;
      setTurns(next);
    },
  });

  const start = useCallback(async () => {
    setError(null);
    setSuggestion(null);
    turnsRef.current = [];
    setTurns([]);
    setPhase("starting");
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const res = await fetch(`${apiBase}/referrals/${encodeURIComponent(referralId)}/call-session`, { method: "POST" });
      if (!res.ok) throw new Error(`Couldn't start the call (${res.status}). This referral may not be eligible, or the voice service isn't configured.`);
      const { conversation_token, dynamic_variables } = await res.json();
      conversation.startSession({
        conversationToken: conversation_token,
        connectionType: "webrtc",
        dynamicVariables: dynamic_variables,
        stripAudioTags: true, // removes expressive cues like [happy] / [slow] from the transcript
      });
      // getId() is available once connected; read it lazily on submit as a fallback.
      setTimeout(() => {
        try {
          conversationIdRef.current = conversation.getId();
        } catch {
          /* not connected yet */
        }
      }, 1500);
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [apiBase, referralId, conversation]);

  const stop = useCallback(() => {
    conversation.endSession(); // onDisconnect submits the transcript
  }, [conversation]);

  const live = phase === "live";

  return (
    <section aria-label="AI call to the specialist office" className="rounded-[10px] border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[15px] font-semibold text-ink">Call the office with the AI assistant</h3>
          <p className="mt-1 text-[13px] leading-[18px] text-muted">
            The assistant says it's an AI, asks whether the referral arrived and what's missing, and gets the
            scheduling number. It never books. In the demo, a teammate plays the office.
          </p>
        </div>
        {live ? (
          <button type="button" onClick={stop}
            className="h-10 shrink-0 rounded-md border border-rust px-4 text-[15px] font-semibold text-rust focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hemlock">
            End call
          </button>
        ) : (
          <button type="button" onClick={start} disabled={phase === "starting" || phase === "checking"}
            className="h-10 shrink-0 rounded-md bg-hemlock px-4 text-[15px] font-semibold text-white disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hemlock">
            {phase === "starting" ? "Connecting…" : phase === "done" || phase === "error" ? "Call again" : "Start call"}
          </button>
        )}
      </div>

      <p className="mt-3 text-[13px] text-muted" aria-live="polite">
        {phase === "live" && (conversation.isSpeaking ? "Assistant is speaking" : "Listening")}
        {phase === "checking" && "Checking the transcript…"}
        {phase === "done" && "Call ended. Review the suggested update below."}
      </p>

      {turns.length > 0 && (
        <ol className="mt-3 max-h-64 space-y-2 overflow-y-auto rounded-md bg-paper p-3" aria-label="Call transcript">
          {turns.map((t) => (
            <li key={`${t.role}-${t.eventId}`} className="text-[15px] leading-[22px]">
              <span className="font-semibold text-ink">{t.role === "agent" ? "Assistant" : "Office"}: </span>
              <span className="text-ink">{t.message}</span>
            </li>
          ))}
        </ol>
      )}

      {error && (
        <p role="alert" className="mt-3 text-[15px] text-rust">{error}</p>
      )}

      {suggestion && (
        <div className="mt-4 rounded-md border border-hemlock bg-hemlock-tint p-3">
          <p className="text-[13px] font-semibold text-hemlock">Suggested by AI from the call. Confirm before saving.</p>
          <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-[15px] text-ink">
            <dt className="text-muted">Referral received</dt><dd>{suggestion.received}</dd>
            {suggestion.missing_items.length > 0 && (<><dt className="text-muted">Missing</dt><dd>{suggestion.missing_items.join(", ")}</dd></>)}
            <dt className="text-muted">Patient contacted</dt><dd>{suggestion.patient_contacted}</dd>
            {suggestion.scheduling_phone && (<><dt className="text-muted">Scheduling number</dt><dd className="tabular-nums">{suggestion.scheduling_phone}</dd></>)}
            {suggestion.scheduling_hours && (<><dt className="text-muted">Hours</dt><dd>{suggestion.scheduling_hours}</dd></>)}
            {suggestion.note && (<><dt className="text-muted">Note</dt><dd>{suggestion.note}</dd></>)}
          </dl>
          {suggestion.validation_errors && suggestion.validation_errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-[13px] text-amber">
              {suggestion.validation_errors.map((v) => <li key={v}>{v}</li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export default function CallAssistant(props: Props) {
  return (
    <ConversationProvider>
      <CallAssistantInner {...props} />
    </ConversationProvider>
  );
}
