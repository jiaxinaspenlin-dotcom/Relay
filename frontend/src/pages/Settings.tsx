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
  const save = useMutation({ mutationFn: () => api.updateSettings({ practice }), onSuccess: () => { setSaved(true); refresh(); } });
  const demo = useMutation({ mutationFn: (on: boolean) => api.updateSettings({ demo_mode: on }), onSuccess: refresh });
  const sample = useMutation({ mutationFn: api.loadSample, onSuccess: refresh });
  const clear = useMutation({ mutationFn: api.clearData, onSuccess: refresh });
  const t = copy.settings;

  if (s.isLoading) return <Loading />;
  if (s.error) return <ErrorNote error={s.error} />;
  const c = s.data!.clock;
  const err = save.error || demo.error || sample.error || clear.error;
  const set = (k: keyof typeof practice) => (e: React.ChangeEvent<HTMLInputElement>) => { setSaved(false); setPractice({ ...practice, [k]: e.target.value }); };

  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="text-page font-bold">{t.title}</h1>
      {err && <ErrorNote error={err} />}

      <Panel title={t.practice} id="practice-h">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <Muted>{t.practiceHelp}</Muted>
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
        <p className="mt-3 font-semibold" data-testid="demo-state">
          {c.demo_mode ? `${t.demoOn} ${copy.clock.demoDate}: ${shortDate(c.today)}.` : t.demoOff}
        </p>
        <div className="mt-2">
          <Button onClick={() => demo.mutate(!c.demo_mode)}>{c.demo_mode ? t.turnOff : t.turnOn}</Button>
        </div>
        {c.demo_mode && <Muted className="mt-2 block">{copy.clock.resetNote}</Muted>}
      </Panel>

      <Panel title={t.data} id="data-h">
        <div className="space-y-5">
          <div>
            {s.data!.has_sample ? <p>{t.sampleLoaded}</p> : (
              <>
                <Button onClick={() => sample.mutate()} disabled={sample.isPending}>{t.loadSample}</Button>
                <Muted className="mt-1 block">{t.sampleHelp}</Muted>
              </>
            )}
          </div>
          <div>
            <Button variant="danger" onClick={() => window.confirm(t.clearConfirm) && clear.mutate()}>{t.clear}</Button>
            <Muted className="mt-1 block">{t.clearHelp}</Muted>
          </div>
        </div>
      </Panel>
    </div>
  );
}
