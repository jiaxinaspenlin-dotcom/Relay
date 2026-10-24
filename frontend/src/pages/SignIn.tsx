import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stethoscope } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { copy } from "../copy";
import { Wordmark } from "../App";
import { ErrorNote } from "../components/Status";
import { Button, Field, Muted, btn, inputCls } from "../components/ui";

// Split layout: hemlock half with the wordmark and a large white stethoscope; white half with the form.
export default function SignIn() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["auth-status"], queryFn: api.authStatus });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState({ name: "", email: "", password: "", practice: "" });
  const t = copy.signIn;
  const done = (r: { home: string }) => { qc.clear(); nav(r.home, { replace: true }); };
  const signIn = useMutation({ mutationFn: () => api.signIn(email, password), onSuccess: done });
  const sample = useMutation({ mutationFn: (role: "coordinator" | "clinician") => api.sampleSignIn(role), onSuccess: done });
  const first = useMutation({ mutationFn: () => api.setup(setup), onSuccess: done });
  const loadSample = useMutation({ mutationFn: api.loadSample, onSuccess: () => qc.invalidateQueries({ queryKey: ["auth-status"] }) });
  const s = status.data;

  return (
    <div className="grid min-h-screen min-[860px]:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-hemlock p-12 min-[860px]:block">
        <Wordmark />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -right-24">
          <Stethoscope size={720} strokeWidth={0.6} color="#FFFFFF" style={{ opacity: 0.1, transform: "rotate(-24deg)" }} />
        </div>
      </div>
      <main className="flex items-center justify-center bg-surface px-6 py-12">
        <div className="w-full max-w-sm space-y-8">
          <div className="min-[860px]:hidden"><Wordmark color="#1F5F5B" /></div>
          {s && !s.has_users ? (
            <>
              <div>
                <h1 className="text-page font-bold">{t.setupTitle}</h1>
                <p className="mt-1 text-muted">{t.setupHelp}</p>
              </div>
              <form className="space-y-4" aria-label={t.setupTitle} onSubmit={(e) => { e.preventDefault(); first.mutate(); }}>
                <Field label={t.name}><input className={inputCls} value={setup.name} onChange={(e) => setSetup({ ...setup, name: e.target.value })} required /></Field>
                <Field label={t.practice}><input className={inputCls} value={setup.practice} onChange={(e) => setSetup({ ...setup, practice: e.target.value })} required /></Field>
                <Field label={t.email}><input type="email" autoComplete="username" className={inputCls} value={setup.email} onChange={(e) => setSetup({ ...setup, email: e.target.value })} required /></Field>
                <Field label={t.password} hint={t.passwordHint}><input type="password" autoComplete="new-password" className={inputCls} value={setup.password} onChange={(e) => setSetup({ ...setup, password: e.target.value })} required minLength={8} /></Field>
                <button type="submit" className={btn("primary", "w-full")} disabled={first.isPending}>{t.create}</button>
                {first.error && <ErrorNote error={first.error} />}
              </form>
              <div className="space-y-2 border-t border-line pt-6">
                <Muted className="block">{t.orSample}</Muted>
                <Button className="w-full" onClick={() => loadSample.mutate()} disabled={loadSample.isPending}>{copy.empty.sample}</Button>
                {loadSample.error && <ErrorNote error={loadSample.error} />}
              </div>
            </>
          ) : (
            <>
              <h1 className="text-page font-bold">{t.title}</h1>
              <form className="space-y-4" aria-label={t.title} onSubmit={(e) => { e.preventDefault(); signIn.mutate(); }}>
                <Field label={t.email}><input type="email" autoComplete="username" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
                <Field label={t.password}><input type="password" autoComplete="current-password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
                <button type="submit" className={btn("primary", "w-full")} disabled={signIn.isPending}>{t.submit}</button>
                {signIn.error && <ErrorNote error={signIn.error} />}
              </form>
              {s?.has_sample && (
                <div className="space-y-2 border-t border-line pt-6">
                  <Button className="w-full" onClick={() => sample.mutate("coordinator")} disabled={sample.isPending}>{t.sampleCoordinator}</Button>
                  <Button className="w-full" onClick={() => sample.mutate("clinician")} disabled={sample.isPending}>{t.sampleClinician}</Button>
                  {sample.error && <ErrorNote error={sample.error} />}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
