import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet, Route, Routes } from "react-router-dom";
import { api } from "./api";
import { copy } from "./copy";
import { shortDate } from "./format";
import { Button, RouteGlyph } from "./components/ui";
import Dashboard from "./pages/Dashboard";
import NewReferral from "./pages/NewReferral";
import ReferralDetail from "./pages/ReferralDetail";
import PcpInbox from "./pages/PcpInbox";
import SettingsPage from "./pages/Settings";
import OfficePage from "./pages/Office";
import PrintPage from "./pages/Print";

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2 text-section font-bold text-ink">
      <RouteGlyph />
      {copy.appName}
    </span>
  );
}

/** Demo date + controls, shown in the header only while Demo mode is on (toggle in Settings). */
function DemoClock() {
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const refresh = () => qc.invalidateQueries();
  const plus1 = useMutation({ mutationFn: () => api.advanceClock(1), onSuccess: refresh });
  const plus7 = useMutation({ mutationFn: () => api.advanceClock(7), onSuccess: refresh });
  const reset = useMutation({ mutationFn: api.resetClock, onSuccess: refresh });
  if (!s.data?.clock.demo_mode) return null;
  return (
    <div role="group" aria-label={copy.clock.demoDate} className="flex flex-wrap items-center gap-2">
      <span className="text-caption text-muted">{copy.clock.demoDate}</span>
      <output data-testid="demo-today" data-iso={s.data.clock.today} className="font-semibold">{shortDate(s.data.clock.today)}</output>
      <Button onClick={() => plus1.mutate()} className="min-h-[36px] px-3">{copy.clock.plus1}</Button>
      <Button onClick={() => plus7.mutate()} className="min-h-[36px] px-3">{copy.clock.plus7}</Button>
      <Button variant="quiet" onClick={() => reset.mutate()}>{copy.clock.reset}</Button>
    </div>
  );
}

function Shell() {
  const s = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const link = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-[40px] items-center rounded-control px-3 ${isActive ? "bg-hemlock-tint font-semibold text-hemlock" : "text-ink hover:text-hemlock"}`;
  return (
    <div className="min-h-screen min-[900px]:flex">
      <aside className="border-b border-line bg-surface min-[900px]:sticky min-[900px]:top-0 min-[900px]:h-screen min-[900px]:w-[220px] min-[900px]:shrink-0 min-[900px]:border-b-0 min-[900px]:border-r">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 min-[900px]:block min-[900px]:px-4 min-[900px]:py-5">
          <div className="min-[900px]:mb-6"><Wordmark /></div>
          <nav aria-label={copy.nav.label} className="flex flex-wrap gap-1 min-[900px]:flex-col">
            <NavLink to="/" end className={link}>{copy.nav.dashboard}</NavLink>
            <NavLink to="/new" className={link}>{copy.nav.newReferral}</NavLink>
            <NavLink to="/inbox" className={link}>{copy.nav.inbox}</NavLink>
            <NavLink to="/settings" className={link}>{copy.nav.settings}</NavLink>
          </nav>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        {s.data?.clock.demo_mode && (
          <div role="status" data-testid="demo-banner" className="border-b border-line bg-hemlock-tint px-6 py-1.5 text-caption text-hemlock">
            {copy.demoBanner}, {shortDate(s.data.clock.today)}.
          </div>
        )}
        {s.data?.has_sample && (
          <div role="status" className="border-b border-line bg-surface px-6 py-1.5 text-caption text-muted">{copy.sampleBanner}</div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5">
          <span className="font-semibold">{s.data?.practice.practice}</span>
          <DemoClock />
        </div>
        <main className="max-w-[1180px] px-6 py-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      {/* The office link and print pages use minimal chrome. */}
      <Route path="/office/:token" element={<OfficePage />} />
      <Route path="/print/:rid/:commId" element={<PrintPage />} />
      <Route element={<Shell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/new" element={<NewReferral />} />
        <Route path="/referrals/:rid" element={<ReferralDetail />} />
        <Route path="/inbox" element={<PcpInbox />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
