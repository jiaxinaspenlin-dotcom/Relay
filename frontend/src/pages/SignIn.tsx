import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stethoscope } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { copy } from "../copy";
import { Wordmark } from "../App";
import { ErrorNote } from "../components/Status";
import { Button, Field, Muted, btn } from "../components/ui";
import "./signin.css";

const STAGES = ["Sent", "Received", "Contacted", "Scheduled", "Seen", "Plan back", "Closed"];
const tall = "mt-1 block h-11 w-full rounded-control border border-line bg-surface px-3 text-body text-ink focus:border-hemlock focus:outline-none";
const SEEN_KEY = "relay.signInIntroSeen";

// ------------------------------------------------------------ intro timeline
// Hold on Sent, then travel → stop for each stage, hold on Closed, pull back, pause, reveal.
type Entry =
  | { kind: "stop"; stage: number; dur: number }
  | { kind: "seg"; from: number; dur: number }
  | { kind: "pull"; dur: number }
  | { kind: "gap"; dur: number }
  | { kind: "reveal"; dur: number };
const ZOOM = 3.2;
type Timed = Entry & { at: number };
const TIMELINE: Timed[] = (() => {
  const t: Entry[] = [{ kind: "stop", stage: 0, dur: 650 }];
  for (let i = 0; i < STAGES.length - 1; i++) {
    t.push({ kind: "seg", from: i, dur: 300 });
    t.push({ kind: "stop", stage: i + 1, dur: i + 1 === STAGES.length - 1 ? 650 : 420 });
  }
  t.push({ kind: "pull", dur: 1100 }, { kind: "gap", dur: 250 }, { kind: "reveal", dur: 900 });
  let at = 0;
  return t.map((e) => { const out: Timed = { ...e, at }; at += e.dur; return out; });
})();
const FOCUS_AFTER_REVEAL = 1100;

const easeQuad = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
const easeCubic = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);

type Phase = "intro" | "pulling" | "text" | "revealing" | "final";

function shouldPlay(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  if (window.innerWidth < 860) return false;
  // Pure read (React may call this twice in development); the effect records that it played.
  try {
    if (window.sessionStorage.getItem(SEEN_KEY)) return false;
  } catch {
    /* storage blocked: play it (it can always be skipped) */
  }
  return true;
}

function markPlayed() {
  try {
    window.sessionStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* storage blocked: nothing to remember */
  }
}

// ------------------------------------------------------------ stage badges
// Each badge is its own aria-hidden div (not a span inside a label) with a green icon on white.
const ICONS: { cls: string; svg: ReactNode; rings?: number }[] = [
  { cls: "si-b-sent", svg: <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></> },
  { cls: "si-b-received", svg: <><path d="M3 13h5l1.5 3h5l1.5-3h5" /><path d="M3 13v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /><path className="si-recv-arrow" d="M12 3v7m-3-3 3 3 3-3" /></> },
  { cls: "si-b-contacted", rings: 2, svg: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /> },
  { cls: "si-b-scheduled", svg: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /><rect className="si-day" x="13" y="14" width="4" height="4" rx=".8" /></> },
  { cls: "si-b-seen", svg: <path className="si-beat" d="M2 12h4l3-8 6 16 3-8h4" /> },
  { cls: "si-b-plan", svg: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path className="si-doc-line" d="M8 12h8" /><path className="si-doc-line" d="M8 15h8" /><path className="si-doc-line" d="M8 18h5" /></> },
  { cls: "si-b-closed", rings: 1, svg: <path className="si-check" d="m6 12.5 4 4 8-9" /> },
];

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

  // ---------------------------------------------------------- intro state
  const [play] = useState(shouldPlay);
  const [phase, setPhase] = useState<Phase>(play ? "intro" : "final");
  const [staticEnd, setStaticEnd] = useState(!play);
  const [lit, setLit] = useState(play ? 0 : STAGES.length); // stages reached (dots lit, badge shown)
  const pitch = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLDivElement>(null);
  const trail = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const raf = useRef(0);
  const geo = useRef({ left: 0, top: 0, cx: 0, cy: 0, trackX: 0, dotY: 0, col: 0 });

  const dotX = (i: number) => geo.current.col * (i + 0.5); // in track coordinates

  const finish = useCallback(() => {
    cancelAnimationFrame(raf.current);
    if (pitch.current) pitch.current.style.transform = "";
    if (arrow.current) arrow.current.style.opacity = "0";
    if (trail.current) trail.current.style.width = "0px";
    if (fill.current) { fill.current.style.left = `${dotX(0)}px`; fill.current.style.width = `${dotX(STAGES.length - 1) - dotX(0)}px`; }
    setLit(STAGES.length);
    setStaticEnd(true);
    setPhase("final");
    window.setTimeout(() => emailRef.current?.focus(), 0);
  }, []);

  // Measure the untransformed layout, place the camera before the first paint, then run one loop.
  useLayoutEffect(() => {
    const tr = track.current;
    if (!tr || !pitch.current) return;
    // Layout from offset* values, which ignore transforms, so it can be re-read every frame
    // (web fonts can shift the block after the first paint).
    const g = geo.current;
    const measure = () => {
      let left = 0, top = 0;
      for (let el: HTMLElement | null = pitch.current; el; el = el.offsetParent as HTMLElement | null) { left += el.offsetLeft; top += el.offsetTop; }
      g.left = left; g.top = top;
      g.col = tr.offsetWidth / STAGES.length;
      g.cx = window.innerWidth / 2; g.cy = window.innerHeight / 2;
      g.trackX = tr.offsetLeft;
      g.dotY = tr.offsetTop + 7 - 10; // dot row center, minus 10px so the badges stay in frame
    };
    measure();
    if (fill.current) fill.current.style.left = `${dotX(0)}px`;
    if (!play) { finish(); return; }
    markPlayed();

    const camera = (x: number, scale: number, k: number) => {
      // translate(cx - left - s·x, cy - top - s·y) scale(s); k scales the translation during the pull-back
      const fx = g.trackX + x;
      const tx = (g.cx - g.left - ZOOM * fx) * k;
      const ty = (g.cy - g.top - ZOOM * g.dotY) * k;
      pitch.current!.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    };
    camera(dotX(0), ZOOM, 1);
    setLit(1);

    const start = performance.now();
    const seen = { lit: 1, phase: "intro" as Phase, focused: false };
    const end = TIMELINE[TIMELINE.length - 1];
    const tick = (now: number) => {
      measure();
      const el = now - start;
      const e = TIMELINE.find((x) => el < x.at + x.dur) ?? end;
      const p = Math.min(Math.max((el - e.at) / e.dur, 0), 1);
      let x = dotX(STAGES.length - 1);
      let litNow = seen.lit;
      if (e.kind === "stop") {
        x = dotX(e.stage);
        litNow = Math.max(litNow, e.stage + 1);
        camera(x, ZOOM, 1);
        arrow.current!.style.opacity = "0";
        trail.current!.style.width = "0px";
      } else if (e.kind === "seg") {
        const q = easeQuad(p);
        x = dotX(e.from) + (dotX(e.from + 1) - dotX(e.from)) * q;
        camera(x, ZOOM, 1);
        const len = Math.sin(Math.PI * p) * 14;
        arrow.current!.style.opacity = "1";
        arrow.current!.style.left = `${x - 8}px`;
        trail.current!.style.left = `${x - 8 - len}px`;
        trail.current!.style.width = `${len}px`;
      } else {
        arrow.current!.style.opacity = "0";
        trail.current!.style.width = "0px";
        if (e.kind === "pull") {
          const q = easeCubic(p);
          camera(x, ZOOM - (ZOOM - 1) * q, 1 - q);
        } else {
          pitch.current!.style.transform = "";
        }
      }
      fill.current!.style.width = `${x - dotX(0)}px`;
      if (litNow !== seen.lit) { seen.lit = litNow; setLit(litNow); }
      const ph: Phase = e.kind === "pull" ? (p > 0.55 ? "text" : "pulling") : e.kind === "gap" ? "text" : e.kind === "reveal" ? "revealing" : "intro";
      if (ph !== seen.phase) { seen.phase = ph; setPhase(ph); }
      if (!seen.focused && el >= end.at + FOCUS_AFTER_REVEAL) { seen.focused = true; emailRef.current?.focus(); }
      if (el >= end.at + end.dur && seen.focused) { setPhase("final"); return; }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    const onResize = () => finish();
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(raf.current); window.removeEventListener("resize", onResize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pulled = phase !== "intro";
  const showText = phase === "text" || phase === "revealing" || phase === "final";
  const formLive = phase === "revealing" || phase === "final";
  const rootCls = ["si-root", pulled && "si-pulling", showText && "si-text", phase === "revealing" && "si-revealing",
    phase === "final" && "si-final", staticEnd && "si-static"].filter(Boolean).join(" ");

  return (
    <div className={rootCls} data-testid="sign-in-page" data-phase={phase}>
      <div className="si-green">
        <div className="si-left">
          <div className="si-fade relative z-10"><Wordmark /></div>
          <div aria-hidden="true" className="si-steth">
            <Stethoscope size={520} strokeWidth={0.6} color="#FFFFFF" style={{ transform: "rotate(-24deg)" }} />
          </div>
          <div className="relative z-10 flex flex-1 flex-col justify-center py-12 max-[859px]:py-6">
            <div ref={pitch} className="si-pitch">
              <p className="si-fade text-[40px] font-bold leading-[48px] text-white max-[859px]:text-[28px] max-[859px]:leading-9">{t.headline}</p>
              <p className="si-fade mt-6 max-w-[460px] text-[17px] leading-6 text-white/[.82] max-[859px]:mt-4">{t.lede}</p>
              <div ref={track} className="si-track mt-12 max-[859px]:mt-8" role="img" aria-label={`${t.trackLabel}: ${STAGES.join(", ")}`}>
                <div className="si-dots">
                  <div aria-hidden="true" className="si-line" style={{ left: `${100 / 14}%`, right: `${100 / 14}%` }} />
                  <div aria-hidden="true" ref={fill} className="si-fill" style={staticEnd ? { left: `${100 / 14}%`, width: `${(100 * 6) / 7}%` } : undefined} />
                  <div aria-hidden="true" ref={trail} className="si-trail" />
                  <div aria-hidden="true" ref={arrow} className="si-arrow">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                  </div>
                  {STAGES.map((st, i) => (
                    <div key={st} className="si-dot-cell" aria-hidden="true">
                      <div className={`si-dot ${i < lit ? "si-lit" : ""} ${i === STAGES.length - 1 && i < lit && !staticEnd ? "si-arrived" : ""}`} />
                    </div>
                  ))}
                  {play && !staticEnd && ICONS.map((b, i) => (
                    <div key={b.cls} aria-hidden="true" className={`si-badge ${b.cls} ${i < lit ? "si-in" : ""}`} style={{ left: `calc(${((i + 0.5) * 100) / 7}% - 12px)` }}>
                      <div className="si-badge-circle">
                        <svg className="si-icon" viewBox="0 0 24 24">{b.svg}</svg>
                      </div>
                      {Array.from({ length: b.rings ?? 0 }, (_, k) => <div key={k} className="si-ring" />)}
                    </div>
                  ))}
                </div>
                <div className="si-labels" aria-hidden="true">
                  {STAGES.map((st, i) => <div key={st} className={`si-label ${i < lit ? "si-lit" : ""}`}>{st}</div>)}
                </div>
              </div>
            </div>
          </div>
          <p className="si-fade relative z-10 text-[13px] text-white/65 max-[859px]:hidden">{t.footer}</p>
        </div>
      </div>

      {(phase === "intro" || phase === "pulling" || phase === "text") && (
        <button type="button" className="si-skip" onClick={finish}>{t.skip}</button>
      )}

      <main className="si-form-side bg-surface" aria-hidden={formLive ? undefined : true}>
        <div className="si-form space-y-8">
          {s && !s.has_users ? (
            <>
              <div>
                <h1 className="text-[28px] font-bold leading-9">{t.setupTitle}</h1>
                <p className="mt-1 text-muted">{t.setupHelp}</p>
              </div>
              <form className="space-y-4" aria-label={t.setupTitle} onSubmit={(e) => { e.preventDefault(); first.mutate(); }}>
                <Field label={t.name}><input className={tall} value={setup.name} onChange={(e) => setSetup({ ...setup, name: e.target.value })} required /></Field>
                <Field label={t.practice}><input className={tall} value={setup.practice} onChange={(e) => setSetup({ ...setup, practice: e.target.value })} required /></Field>
                <Field label={t.email}><input ref={emailRef} type="email" autoComplete="username" className={tall} value={setup.email} onChange={(e) => setSetup({ ...setup, email: e.target.value })} required /></Field>
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
                <Field label={t.email}><input ref={emailRef} type="email" autoComplete="username" className={tall} value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
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
