import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { copy } from "../copy";
import { ErrorNote, Loading } from "../components/Status";
import { Button, Field, Num, Panel, inputCls } from "../components/ui";

export default function SettingsPage() {
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const [practice, setPractice] = useState({ practice: "", clinician: "", coordinator: "" });
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (s.data) setPractice(s.data.practice);
  }, [s.data]);
  const refresh = () => qc.invalidateQueries();
  const save = useMutation({
    mutationFn: () => api.updateSettings({ practice }),
    onSuccess: () => { setSaved(true); refresh(); },
  });
  const demo = useMutation({ mutationFn: (on: boolean) => api.updateSettings({ demo_mode: on }), onSuccess: refresh });
  const plus1 = useMutation({ mutationFn: () => api.advanceClock(1), onSuccess: refresh });
  const plus7 = useMutation({ mutationFn: () => api.advanceClock(7), onSuccess: refresh });
  const back = useMutation({ mutationFn: api.resetClock, onSuccess: refresh });
  const sample = useMutation({ mutationFn: api.loadSample, onSuccess: refresh });
  const clear = useMutation({ mutationFn: api.clearData, onSuccess: refresh });
  const t = copy.settings;

  if (s.isLoading) return <Loading />;
  if (s.error) return <ErrorNote error={s.error} />;
  const c = s.data!.clock;
  const err = save.error || demo.error || plus1.error || plus7.error || back.error || sample.error || clear.error;

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
      {err && <ErrorNote error={err} />}

      <Panel title={t.practice} id="practice-h">
        <form
          className="space-y-3"
          onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
        >
          <p className="text-xs text-slate-500">{t.practiceHelp}</p>
          <Field label={t.practiceName}>
            <input className={inputCls} value={practice.practice} onChange={(e) => { setSaved(false); setPractice({ ...practice, practice: e.target.value }); }} required />
          </Field>
          <Field label={t.clinician}>
            <input className={inputCls} value={practice.clinician} onChange={(e) => { setSaved(false); setPractice({ ...practice, clinician: e.target.value }); }} required />
          </Field>
          <Field label={t.coordinator}>
            <input className={inputCls} value={practice.coordinator} onChange={(e) => { setSaved(false); setPractice({ ...practice, coordinator: e.target.value }); }} required />
          </Field>
          <div className="flex items-center gap-2">
            <Button variant="primary" type="submit">{t.save}</Button>
            {saved && <span role="status" className="text-sm text-emerald-700">{t.saved}</span>}
          </div>
        </form>
      </Panel>

      <Panel title={t.demo} id="demo-h">
        <p className="text-sm text-slate-600">{t.demoHelp}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium" data-testid="demo-state">{c.demo_mode ? t.demoOn : t.demoOff}</span>
          <Button variant={c.demo_mode ? "secondary" : "primary"} onClick={() => demo.mutate(!c.demo_mode)}>
            {c.demo_mode ? t.turnOff : t.turnOn}
          </Button>
        </div>
        {c.demo_mode && (
          <div className="mt-4 space-y-2 rounded-md bg-violet-50 p-3" role="group" aria-label={t.simulatedDate}>
            <div className="text-sm">
              {t.simulatedDate}: <Num><output data-testid="demo-today" className="font-semibold">{c.today}</output></Num>
              <span className="ml-3 text-xs text-slate-500">{t.realDate}: <Num>{c.real_today}</Num></span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => plus1.mutate()}>{t.plus1}</Button>
              <Button onClick={() => plus7.mutate()}>{t.plus7}</Button>
              <Button variant="quiet" onClick={() => back.mutate()}>{t.resetClock}</Button>
            </div>
            <p className="text-xs text-slate-500">{t.resetClockNote}</p>
          </div>
        )}
      </Panel>

      <Panel title={t.data} id="data-h">
        <div className="space-y-4">
          <div>
            {s.data!.has_sample ? (
              <p className="text-sm text-slate-700">{t.sampleLoaded}</p>
            ) : (
              <>
                <Button onClick={() => sample.mutate()} disabled={sample.isPending}>{t.loadSample}</Button>
                <p className="mt-1 text-xs text-slate-500">{t.sampleHelp}</p>
              </>
            )}
          </div>
          <div>
            <Button variant="danger" onClick={() => window.confirm(t.clearConfirm) && clear.mutate()}>{t.clear}</Button>
            <p className="mt-1 text-xs text-slate-500">{t.clearHelp}</p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
