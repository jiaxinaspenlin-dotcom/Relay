import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stethoscope } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { LIVE, api, type Card } from "../api";
import { copy } from "../copy";
import { ActionDrawers, type DrawerState } from "../components/ActionDrawers";
import { useRunNextAction } from "../components/NextAction";
import { CallChip, activeCall } from "../components/OfficeCall";
import { RouteTrack } from "../components/RouteTrack";
import { ErrorNote, Loading } from "../components/Status";
import { Button, StatusText, btn, type Tone } from "../components/ui";
import { useMe } from "../components/useMe";

type TabKey = "lost" | "waiting" | "ontrack";
const TABS: TabKey[] = ["lost", "waiting", "ontrack"];
const TERMINAL = new Set(["closed", "cancelled", "declined"]);

// Section colors: rust for Lost, amber for Waiting, hemlock for On track.
const TAB_STYLE: Record<TabKey, { text: string; line: string; pill: string; tone: Tone }> = {
  lost: { text: "text-rust", line: "bg-rust", pill: "bg-rust-tint text-rust", tone: "rust" },
  waiting: { text: "text-amber", line: "bg-amber", pill: "bg-amber-tint text-amber", tone: "amber" },
  ontrack: { text: "text-hemlock", line: "bg-hemlock", pill: "bg-hemlock-tint text-hemlock", tone: "muted" },
};

function EmptyState() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const sample = useMutation({ mutationFn: api.loadSample, onSuccess: () => qc.invalidateQueries() });
  const coordinator = useMe()?.role !== "clinician";
  return (
    <div className="max-w-xl pt-6" data-testid="empty-state">
      <h1 className="text-page font-bold">{copy.empty.title}</h1>
      <p className="mt-2 text-muted">{copy.empty.body}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        {coordinator && <Button variant="primary" onClick={() => nav("/new")}>{copy.empty.add}</Button>}
        <Button onClick={() => sample.mutate()} disabled={sample.isPending}>{copy.empty.sample}</Button>
      </div>
      {sample.error && <div className="mt-3"><ErrorNote error={sample.error} /></div>}
    </div>
  );
}

function Row({ card, tab, coordinator, setDrawer }: { card: Card; tab: TabKey; coordinator: boolean; setDrawer: (s: DrawerState) => void }) {
  const next = useRunNextAction(setDrawer);
  const nav = useNavigate();
  const miles = card.miles === null ? "" : card.miles === 0 ? ", same town" : `, ${card.miles} mi`;
  const status = tab === "ontrack" && coordinator && card.reviewer ? copy.dashboard.waitingReview(card.reviewer) : card.row_status;
  const call = coordinator ? activeCall(card.call) : null;
  return (
    <li data-testid={`row-${card.id}`}
      className="relative grid grid-cols-1 items-center gap-4 border-b border-line px-6 py-4 last:border-b-0 hover:bg-paper min-[860px]:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_200px] max-[859px]:px-4">
      {/* The whole row opens the referral; the action sits above this link. */}
      <Link to={`/referrals/${card.id}`} aria-label={copy.dashboard.rowLabel(card.patient.name)} className="absolute inset-0 focus-visible:outline-offset-[-2px]" />
      <div className="min-w-0">
        <div className="truncate font-semibold">{card.patient.name}</div>
        <div className="text-caption text-muted">{card.specialty}{miles}</div>
      </div>
      <div className="min-w-0">
        <RouteTrack steps={card.stepper} flags={card.stuck} />
        <StatusText tone={TAB_STYLE[tab].tone} className="mt-2 text-caption" testid="row-status">{status}</StatusText>
        {next.error && <p role="alert" className="mt-1 text-caption text-rust">{next.error.message}</p>}
      </div>
      <div className="relative z-10 flex h-10 items-center justify-start min-[860px]:justify-end">
        {call ? (
          <CallChip call={call} onReview={() => nav(`/referrals/${card.id}#call-result`)} onRetry={() => next.run(card)} />
        ) : coordinator && card.next_action && tab !== "ontrack" ? (
          <button type="button" className={btn("secondary", "max-[859px]:w-full")} onClick={() => next.run(card)} disabled={next.pending}>
            {card.next_action.label}
          </button>
        ) : null}
      </div>
    </li>
  );
}

function readStored(key: string): TabKey | null {
  try {
    const v = window.localStorage.getItem(key);
    return v && (TABS as string[]).includes(v) ? (v as TabKey) : null;
  } catch {
    return null;
  }
}

function store(key: string, v: TabKey) {
  try {
    window.localStorage.setItem(key, v);
  } catch {
    /* private mode or storage full: the URL still holds the tab */
  }
}

export default function Dashboard() {
  const q = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard, ...LIVE });
  const me = useMe();
  const coordinator = me?.role !== "clinician";
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [params, setParams] = useSearchParams();
  const storeKey = `relay.dashTab.${me?.id ?? "anon"}`;
  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({ lost: null, waiting: null, ontrack: null });

  // A tab's pill flashes when a referral moves into it between refreshes (not on first load).
  const seen = useRef<Record<TabKey, Set<string>> | null>(null);
  const [flash, setFlash] = useState<Set<TabKey>>(new Set());

  const cards = q.data ? q.data.pipeline.flatMap((c) => c.cards) : [];
  const groups: Record<TabKey, Card[]> = { lost: [], waiting: [], ontrack: [] };
  for (const c of cards) {
    if (c.tab === "ontrack" && TERMINAL.has(c.stage)) continue;
    groups[c.tab].push(c);
  }
  const order = (q.data?.needs_attention ?? []).map((r) => r.referral_id);
  for (const k of ["lost", "waiting"] as TabKey[]) groups[k].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  useEffect(() => {
    if (!q.data) return;
    const now: Record<TabKey, Set<string>> = { lost: new Set(groups.lost.map((c) => c.id)), waiting: new Set(groups.waiting.map((c) => c.id)), ontrack: new Set(groups.ontrack.map((c) => c.id)) };
    if (seen.current) {
      const moved = TABS.filter((k) => [...now[k]].some((id) => !seen.current![k].has(id)));
      if (moved.length) {
        setFlash(new Set(moved));
        window.setTimeout(() => setFlash(new Set()), 1200);
      }
    }
    seen.current = now;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  if (q.isLoading) return <Loading rows={4} />;
  if (q.error) return <ErrorNote error={q.error} />;
  const d = q.data!;
  if (d.total === 0) return <EmptyState />;

  const fromUrl = params.get("tab");
  const urlTab = fromUrl === "lost" || fromUrl === "waiting" || fromUrl === "ontrack" ? fromUrl : null;
  const fallback = TABS.find((k) => groups[k].length) ?? "lost";
  const tab: TabKey = urlTab ?? readStored(storeKey) ?? fallback;
  const select = (k: TabKey, focus = false) => {
    store(storeKey, k);
    setParams((p) => { const n = new URLSearchParams(p); n.set("tab", k); return n; }, { replace: true });
    if (focus) tabRefs.current[k]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const i = TABS.indexOf(tab);
    const to = e.key === "ArrowRight" ? TABS[(i + 1) % 3] : e.key === "ArrowLeft" ? TABS[(i + 2) % 3]
      : e.key === "Home" ? TABS[0] : e.key === "End" ? TABS[2] : null;
    if (to) { e.preventDefault(); select(to, true); }
  };
  const t = copy.dashboard;
  const attention = groups.lost.length + groups.waiting.length;
  const rows = groups[tab];

  return (
    <>
      {/* Background stethoscope: dashboard only, very faint, behind everything. */}
      <div aria-hidden="true" className="pointer-events-none absolute -right-[240px] top-0 z-0 hidden overflow-visible min-[860px]:block">
        <Stethoscope size={800} strokeWidth={0.2} color="#1F5F5B" style={{ opacity: 0.05, transform: "rotate(-24deg)" }} />
      </div>
      <div className="relative z-10 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-page font-bold" data-testid="headline">{t.headline(attention)}</h1>
            <p className="mt-1 text-muted">{t.open(d.summary.open)}</p>
            {d.has_sample && (
              <p className="mt-2 text-caption text-muted" data-testid="sample-line">
                {t.showingSample} · <Link to="/settings" className="text-hemlock underline-offset-2 hover:underline">{t.removeSample}</Link>
              </p>
            )}
          </div>
          {coordinator && <Link to="/new" className={btn("primary")}>{t.newReferral}</Link>}
        </div>

        <div role="tablist" aria-label={t.tabsLabel} className="flex gap-6 overflow-x-auto border-b border-line" onKeyDown={onKey}>
          {TABS.map((k) => {
            const active = k === tab;
            const st = TAB_STYLE[k];
            return (
              <button key={k} ref={(el) => { tabRefs.current[k] = el; }} type="button" role="tab" id={`tab-${k}`}
                aria-selected={active} aria-controls={`panel-${k}`} tabIndex={active ? 0 : -1} data-testid={`tab-${k}`}
                onClick={() => select(k)}
                className={`relative -mb-px flex h-12 shrink-0 items-center gap-2 whitespace-nowrap px-1 font-semibold focus-visible:outline-offset-[-2px] ${active ? st.text : "text-muted hover:text-ink"}`}>
                {t.tabs[k]}
                <span className={`inline-flex h-6 min-w-[24px] items-center justify-center rounded-full px-2 text-caption font-semibold ${active ? st.pill : "border border-line bg-surface text-muted"} ${flash.has(k) ? "pill-flash" : ""}`}>
                  {groups[k].length}
                </span>
                <span aria-hidden="true" className={`absolute inset-x-0 bottom-0 h-[3px] rounded-full ${active ? st.line : "bg-transparent"}`} />
              </button>
            );
          })}
        </div>

        <section role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} data-testid={tab === "ontrack" ? "on-track" : tab} tabIndex={0}
          className="overflow-hidden rounded-panel border border-line bg-surface">
          {rows.length === 0 ? (
            <p className="px-6 py-8 text-muted" data-testid="tab-empty">{t.emptyTab[tab]}</p>
          ) : (
            <ul>
              {rows.map((c) => <Row key={c.id} card={c} tab={tab} coordinator={coordinator} setDrawer={setDrawer} />)}
            </ul>
          )}
        </section>
      </div>
      <ActionDrawers state={drawer} setState={setDrawer} />
    </>
  );
}
