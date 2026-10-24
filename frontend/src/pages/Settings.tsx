import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { copy } from "../copy";
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
  const load = useMutation({ mutationFn: api.loadSample, onSuccess: refresh });
  const remove = useMutation({ mutationFn: api.removeSample, onSuccess: refresh });
  const t = copy.settings;
  if (s.isLoading) return <Loading />;
  if (s.error) return <ErrorNote error={s.error} />;
  const err = save.error || load.error || remove.error;
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

      <Panel title={t.data} id="data-h">
        <Muted className="mb-4 block">{t.sampleHelp}</Muted>
        {s.data!.has_sample
          ? <Button onClick={() => remove.mutate()} disabled={remove.isPending}>{t.removeSample}</Button>
          : <Button onClick={() => load.mutate()} disabled={load.isPending}>{t.loadSample}</Button>}
      </Panel>
    </div>
  );
}
