import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { copy } from "../copy";

export function DemoClock() {
  const qc = useQueryClient();
  const clock = useQuery({ queryKey: ["clock"], queryFn: api.clock });
  const refreshAll = () => qc.invalidateQueries();
  const plus1 = useMutation({ mutationFn: () => api.advanceClock(1), onSuccess: refreshAll });
  const plus7 = useMutation({ mutationFn: () => api.advanceClock(7), onSuccess: refreshAll });
  const reset = useMutation({ mutationFn: api.resetClock, onSuccess: refreshAll });
  const resetDemo = useMutation({ mutationFn: api.resetDemo, onSuccess: refreshAll });
  const btn = "rounded border border-slate-300 px-2 py-0.5 text-sm hover:bg-slate-50";

  return (
    <div role="group" aria-label={copy.clock.label} className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-slate-600">{copy.clock.label}</span>
      <output aria-live="polite" data-testid="demo-today" className="font-mono font-semibold">
        {clock.data?.today ?? "…"}
      </output>
      <button className={btn} onClick={() => plus1.mutate()}>{copy.clock.plus1}</button>
      <button className={btn} onClick={() => plus7.mutate()}>{copy.clock.plus7}</button>
      <button className={btn} onClick={() => reset.mutate()}>{copy.clock.reset}</button>
      <button
        className={btn}
        onClick={() => window.confirm(copy.clock.resetDemoConfirm) && resetDemo.mutate()}
      >
        {copy.clock.resetDemo}
      </button>
    </div>
  );
}
