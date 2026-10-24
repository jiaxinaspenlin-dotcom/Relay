import { lazy, Suspense, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { copy } from "../copy";
import { SendButtons, type Channel } from "./SendButtons";
import { ErrorNote, Loading } from "./Status";
import { UpdateForm, type UpdatePrefill } from "./UpdateForm";
import { Button, Drawer, Field, Muted, inputCls } from "./ui";
import type { CallSuggestion } from "./CallAssistant";

const CallAssistant = lazy(() => import("./CallAssistant"));

export type DrawerKind = "update" | "follow_up" | "patient" | "call";
export type DrawerState = { kind: DrawerKind; rid: string; prefill?: UpdatePrefill | null } | null;

/** AI call suggestion → Log update prefill. The coordinator still has to press Save. */
export function suggestionToPrefill(s: CallSuggestion): UpdatePrefill | null {
  const stage = s.proposed_stage;
  const extra = [s.scheduling_phone && `Scheduling phone ${s.scheduling_phone}`, s.scheduling_hours && `Hours ${s.scheduling_hours}`, s.note]
    .filter(Boolean).join(". ");
  const items = s.missing_items.map((m) => (m === "authorization" ? "insurance_authorization" : m));
  if (stage === "Received-incomplete") return { action: "missing", missing: items, note: extra, phone: s.scheduling_phone, fromAi: true };
  if (stage === "Received-complete") return { action: "received", note: extra, phone: s.scheduling_phone, fromAi: true };
  if (stage === "Patient contacted") return { action: "patient_contacted", contact_mode: "office_called", note: extra, phone: s.scheduling_phone, fromAi: true };
  return null;
}

function UpdateDrawer({ rid, prefill, onClose }: { rid: string; prefill?: UpdatePrefill | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ["referral", rid], queryFn: () => api.referral(rid) });
  return (
    <Drawer title={copy.update.title} onClose={onClose}>
      <Muted className="mb-4 block">{copy.update.help}</Muted>
      {q.data ? <UpdateForm rid={rid} actions={q.data.update_actions} prefill={prefill} officePhone={q.data.referral.performer.phone} onDone={onClose} /> : <Loading />}
    </Drawer>
  );
}

function FollowUpDrawer({ rid, onClose }: { rid: string; onClose: () => void }) {
  const qc = useQueryClient();
  const draft = useQuery({ queryKey: ["draft", rid], queryFn: () => api.draft(rid) });
  const [text, setText] = useState("");
  useEffect(() => { if (draft.data) setText(draft.data.text); }, [draft.data]);
  const t = copy.drawer;
  const send = useMutation({
    mutationFn: async (channel: Channel) => {
      const d = draft.data!;
      const r = await api.sendMessage(rid, { recipient: d.recipient, text, rule: d.rule, drafted_text: d.text, channel, kind: "follow_up" });
      return r.communication_id;
    },
    onSuccess: () => { qc.invalidateQueries(); onClose(); },
  });
  return (
    <Drawer title={t.followUp} onClose={onClose}>
      {draft.isLoading && <Loading />}
      {draft.error && <ErrorNote error={draft.error} />}
      {draft.data && (
        <div className="space-y-4">
          <p>{t.to} {draft.data.recipient_label.toLowerCase()}.</p>
          <p className={`text-caption ${draft.data.verified ? "text-hemlock" : "text-rust"}`}>
            {draft.data.verified ? t.verified : `${t.notVerified} ${draft.data.problems.join("; ")}`}
          </p>
          <Field label={t.message} hint={t.template}>
            <textarea data-testid="followup-text" className={inputCls} rows={12} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <details>
            <summary className="cursor-pointer text-hemlock">{t.facts}</summary>
            <dl className="mt-2 space-y-1 text-caption">
              {draft.data.facts.map((f) => (
                <div key={f.id} className="grid grid-cols-[3rem_1fr] gap-2"><dt className="text-muted">[{f.id}]</dt><dd>{f.label}: {f.value}</dd></div>
              ))}
            </dl>
          </details>
          <SendButtons rid={rid} subject={draft.data.subject} text={text} disabled={!text.trim() || send.isPending} send={(c) => send.mutateAsync(c)} />
          {send.error && <ErrorNote error={send.error} />}
          <Muted>{copy.delivery}</Muted>
        </div>
      )}
    </Drawer>
  );
}

function PatientDrawer({ rid, onClose }: { rid: string; onClose: () => void }) {
  const qc = useQueryClient();
  const msg = useQuery({ queryKey: ["patient-message", rid], queryFn: () => api.patientMessage(rid) });
  const [text, setText] = useState("");
  const [phone, setPhone] = useState("");
  useEffect(() => { if (msg.data) setText(msg.data.text); }, [msg.data]);
  const savePhone = useMutation({
    mutationFn: () => api.setOfficePhone(rid, phone),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["patient-message", rid] }); qc.invalidateQueries({ queryKey: ["referral", rid] }); },
  });
  const send = useMutation({
    mutationFn: async (channel: Channel) =>
      (await api.sendMessage(rid, { recipient: "patient", text, drafted_text: msg.data!.text, channel, kind: "patient_message" })).communication_id,
    onSuccess: () => { qc.invalidateQueries(); onClose(); },
  });
  const t = copy.detail;
  return (
    <Drawer title={copy.drawer.patientMessage} onClose={onClose}>
      {msg.isLoading && <Loading />}
      {msg.error && <ErrorNote error={msg.error} />}
      {msg.data && (
        <div className="space-y-4">
          {msg.data.needs_phone && (
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (phone.trim()) savePhone.mutate(); }}>
              <Field label={t.officePhone} hint={t.officePhoneHelp}>
                <input className={inputCls} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
              <Button type="submit" disabled={!phone.trim()}>{t.savePhone}</Button>
              {savePhone.error && <ErrorNote error={savePhone.error} />}
            </form>
          )}
          <Field label={copy.drawer.message}>
            <textarea data-testid="patient-message" className={inputCls} rows={9} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <SendButtons rid={rid} subject={msg.data.subject} text={text} disabled={!text.trim() || msg.data.needs_phone || send.isPending} send={(c) => send.mutateAsync(c)} />
          {send.error && <ErrorNote error={send.error} />}
        </div>
      )}
    </Drawer>
  );
}

function CallDrawer({ rid, onClose, onSuggestion }: { rid: string; onClose: () => void; onSuggestion: (p: UpdatePrefill) => void }) {
  return (
    <Drawer title={copy.drawer.callTitle} onClose={onClose}>
      <Suspense fallback={<Loading />}>
        <CallAssistant referralId={rid} onSuggestion={(s) => { const p = suggestionToPrefill(s); if (p) onSuggestion(p); }} />
      </Suspense>
    </Drawer>
  );
}

export function ActionDrawers({ state, setState }: { state: DrawerState; setState: (s: DrawerState) => void }) {
  if (!state) return null;
  const close = () => setState(null);
  if (state.kind === "update") return <UpdateDrawer rid={state.rid} prefill={state.prefill} onClose={close} />;
  if (state.kind === "follow_up") return <FollowUpDrawer rid={state.rid} onClose={close} />;
  if (state.kind === "patient") return <PatientDrawer rid={state.rid} onClose={close} />;
  return <CallDrawer rid={state.rid} onClose={close} onSuggestion={(p) => setState({ kind: "update", rid: state.rid, prefill: p })} />;
}

/** "Call office" opens the AI call when voice is configured; otherwise it opens Log update. */
export function useCallKind(): DrawerKind {
  const cfg = useQuery({ queryKey: ["config"], queryFn: api.config, staleTime: Infinity });
  return cfg.data?.voice_enabled ? "call" : "update";
}
