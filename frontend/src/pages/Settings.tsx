import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { copy } from "../copy";
import { shortDate } from "../format";
import { ErrorNote, Loading } from "../components/Status";
import { Button, Field, Muted, Panel, inputCls } from "../components/ui";

export default function SettingsPage() {
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const [practice, setPractice] = useState({ practice: "", clinician: "", coordinator: "" });
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (s.data) setPractice(s.data.practice); }, [s.data]);
  const refresh = () => qc.invalidateQueries();
  const m = (fn: () => Promise<unknown>) => ({ mutationFn: fn, onSuccess: refresh });
  const save = useMutation({ mutationFn: () => api.updateSettings({ practice }), onSuccess: () => { setSaved(true); refresh(); } });
  const demo = useMutation({ mutationFn: (on: boolean) => api.updateSettings({ demo_mode: on }), onSuccess: refresh });
  const plus1 = useMutation(m(() => api.advanceClock(1)));
  const plus7 = useMutation(m(() => api.advanceClock(7)));
  const reset = useMutation(m(api.resetClock));
  const resetSample = useMutation(m(api.resetSample));
  const sample = useMutation(m(api.loadSample));
  const clear = useMutation(m(api.clearData));
  const t = copy.settings;
  if (s.isLoading) return <Loading />;
  if (s.error) return <ErrorNote error={s.error} />;
  const c = s.data!.clock;
  const err = save.error || demo.error || plus1.error || plus7.error || reset.error || resetSample.error || sample.error || clear.error;
  const set = (k: keyof typeof practice) => (e: React.ChangeEvent<HTMLInputElement>) => { setSaved(false); setPractice({ ...practice, [k]: e.target.value }); };

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-page font-bold">{t.title}</h1>
      {err && <ErrorNote error={err} />}

      <Panel title={t.practice} id="practice-h">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <Field label={t.practiceName}><input className={inputCls} value={practice.practice} onChange={set("practice")} required /></Field>
          <Field label={t.clinician}><input className={inputCls} value={practice.clinician} onChange={set("clinician")} required /></Field>
          <Field label={t.coordinator}><input className={inputCls} value={practice.coordinator} onChange={set("coordinator")} required /></Field>
          <div className="flex items-center gap-3">
            <Button variant="primary" type="submit">{t.save}</Button>
            {saved && <span role="status" className="text-hemlock">{t.saved}</span>}
          </div>
        </form>
      </Panel>

      <Panel title={t.demo} id="demo-h">
        <p className="text-muted">{t.demoHelp}</p>
        <div className="mt-4"><Button onClick={() => demo.mutate(!c.demo_mode)}>{c.demo_mode ? t.turnOff : t.turnOn}</Button></div>
        {c.demo_mode && (
          <div className="mt-5 space-y-4 border-t border-line pt-5" role="group" aria-label={t.date}>
            <p>{t.date}: <output data-testid="demo-today" data-iso={c.today} className="font-semibold">{shortDate(c.today)}</output></p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => plus1.mutate()}>{t.plus1}</Button>
              <Button onClick={() => plus7.mutate()}>{t.plus7}</Button>
              <Button variant="quiet" onClick={() => reset.mutate()}>{t.reset}</Button>
            </div>
            {s.data!.has_sample && <Button onClick={() => resetSample.mutate()}>{t.resetSample}</Button>}
          </div>
        )}
      </Panel>

      <Panel title={t.data} id="data-h">
        <div className="flex flex-wrap items-center gap-3">
          {s.data!.has_sample ? <Muted>{t.sampleLoaded}</Muted> : <Button onClick={() => sample.mutate()} disabled={sample.isPending}>{t.loadSample}</Button>}
          <Button variant="danger" onClick={() => window.confirm(t.clearConfirm) && clear.mutate()}>{t.clear}</Button>
        </div>
      </Panel>
    </div>
  );
}
