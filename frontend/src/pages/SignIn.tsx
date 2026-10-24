import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stethoscope } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { copy } from "../copy";
import { Wordmark } from "../App";
import { ErrorNote } from "../components/Status";
import { Button, Field, Muted, btn } from "../components/ui";

const STAGES = ["Sent", "Received", "Contacted", "Scheduled", "Seen", "Plan back", "Closed"];
const tall = "mt-1 block h-11 w-full rounded-control border border-line bg-surface px-3 text-body text-ink focus:border-hemlock focus:outline-none";

/** The 7-stage route in white: filled dots, the last one ringed, the line filling left to right
 * once on load (~2.4 s; instant under reduced motion). */
function HeroTrack() {
  const [fill, setFill] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setFill(100)));
    return () => cancelAnimationFrame(id);
  }, []);
  const n = STAGES.length;
  const col = 100 / n;
  const first = col / 2;
  const span = 100 - col;
  return (
    <div className="w-full max-w-[520px]" role="img" aria-label={`${copy.signIn.trackLabel}: ${STAGES.join(", ")}`}>
      <div className="relative h-4">
        <span aria-hidden="true" className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-white/30" style={{ left: `${first}%`, width: `${span}%` }} />
        <span aria-hidden="true" className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-white transition-[width] duration-[2400ms] ease-in-out motion-reduce:transition-none"
          style={{ left: `${first}%`, width: `${(span * fill) / 100}%` }} />
        {STAGES.map((s, i) => (
          <span key={s} aria-hidden="true"
            className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ${i === n - 1 ? "border-2 border-white bg-hemlock ring-2 ring-white/40 ring-offset-2 ring-offset-hemlock" : "bg-white"}`}
            style={{ left: `${col * i + col / 2}%` }} />
        ))}
      </div>
      <ol aria-hidden="true" className="mt-2 grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {STAGES.map((s) => <li key={s} className="text-center text-[12px] leading-4 text-white/80">{s}</li>)}
      </ol>
    </div>
  );
}

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
  const errId = "sign-in-error";

  return (
    <div className="grid min-h-screen min-[860px]:grid-cols-2">
      <div className="relative flex flex-col overflow-hidden bg-hemlock px-12 py-12 max-[859px]:px-6 max-[859px]:py-8">
        <Wordmark />
        {/* Behind the headline and the track, inside the green half. */}
        <div aria-hidden="true" className="pointer-events-none absolute bottom-[150px] right-[-24px] hidden min-[860px]:block">
          <Stethoscope size={520} strokeWidth={0.6} color="#FFFFFF" style={{ opacity: 0.06, transform: "rotate(-24deg)" }} />
        </div>
        <div className="relative z-10 flex flex-1 flex-col justify-center gap-6 py-12 max-[859px]:gap-4 max-[859px]:py-6">
          <p className="text-[40px] font-bold leading-[48px] text-white max-[859px]:text-[28px] max-[859px]:leading-9">{t.headline}</p>
          <p className="max-w-[460px] text-[17px] leading-6 text-white/[.82]">{t.lede}</p>
          <div className="pt-4"><HeroTrack /></div>
        </div>
        <p className="relative z-10 text-[13px] text-white/65 max-[859px]:hidden">{t.footer}</p>
      </div>

      <main className="flex items-center justify-center bg-surface px-6 py-12">
        <div className="w-full max-w-[380px] space-y-8">
          {s && !s.has_users ? (
            <>
              <div>
                <h1 className="text-[28px] font-bold leading-9">{t.setupTitle}</h1>
                <p className="mt-1 text-muted">{t.setupHelp}</p>
              </div>
              <form className="space-y-4" aria-label={t.setupTitle} onSubmit={(e) => { e.preventDefault(); first.mutate(); }}>
                <Field label={t.name}><input className={tall} value={setup.name} onChange={(e) => setSetup({ ...setup, name: e.target.value })} required /></Field>
                <Field label={t.practice}><input className={tall} value={setup.practice} onChange={(e) => setSetup({ ...setup, practice: e.target.value })} required /></Field>
                <Field label={t.email}><input type="email" autoComplete="username" className={tall} value={setup.email} onChange={(e) => setSetup({ ...setup, email: e.target.value })} required /></Field>
                <Field label={t.password} hint={t.passwordHint}><input type="password" autoComplete="new-password" className={tall} value={setup.password} onChange={(e) => setSetup({ ...setup, password: e.target.value })} required minLength={8} /></Field>
                {first.error && <ErrorNote error={first.error} />}
                <button type="submit" className={btn("primary", "h-11 w-full")} disabled={first.isPending}>{t.create}</button>
              </form>
              <div className="space-y-2 border-t border-line pt-6">
                <Muted className="block">{t.orSample}</Muted>
                <Button className="w-full" onClick={() => loadSample.mutate()} disabled={loadSample.isPending}>{copy.empty.sample}</Button>
                {loadSample.error && <ErrorNote error={loadSample.error} />}
              </div>
            </>
          ) : (
            <>
              <h1 className="text-[28px] font-bold leading-9">{t.title}</h1>
              <form className="space-y-4" aria-label={t.title} onSubmit={(e) => { e.preventDefault(); signIn.mutate(); }}>
                <Field label={t.email}><input type="email" autoComplete="username" className={tall} value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
                <div>
                  <Field label={t.password}>
                    <input type="password" autoComplete="current-password" className={tall} value={password} onChange={(e) => setPassword(e.target.value)} required
                      aria-invalid={!!signIn.error} aria-errormessage={signIn.error ? errId : undefined} />
                  </Field>
                  {signIn.error && <p id={errId} role="alert" className="mt-2 text-caption text-rust">{signIn.error.message}. {t.tryAgain}</p>}
                </div>
                <button type="submit" className={btn("primary", "h-11 w-full")} disabled={signIn.isPending}>{t.submit}</button>
              </form>
              {s?.has_sample && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 text-caption text-muted" role="separator" aria-label={t.orTry}>
                    <span className="h-px flex-1 bg-line" aria-hidden="true" />{t.orTry}<span className="h-px flex-1 bg-line" aria-hidden="true" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {s.sample_accounts.map((a) => (
                      <button key={a.role} type="button" onClick={() => sample.mutate(a.role as "coordinator" | "clinician")} disabled={sample.isPending}
                        aria-label={t.sampleAs(a.name, a.role)}
                        className="flex flex-col items-start gap-1 rounded-control border border-line bg-surface px-4 py-3 text-left hover:border-hemlock hover:bg-hemlock-tint disabled:cursor-not-allowed">
                        <span className="font-semibold text-ink">{a.name}</span>
                        <span className="text-caption text-muted">{a.role === "clinician" ? copy.nav.roleClinician : copy.nav.roleCoordinator}</span>
                      </button>
                    ))}
                  </div>
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
