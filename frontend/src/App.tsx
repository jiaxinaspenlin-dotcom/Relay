import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, Route, Routes } from "react-router-dom";
import { api } from "./api";
import { copy } from "./copy";
import Dashboard from "./pages/Dashboard";
import NewReferral from "./pages/NewReferral";
import ReferralDetail from "./pages/ReferralDetail";
import PcpInbox from "./pages/PcpInbox";
import SettingsPage from "./pages/Settings";
import OfficePage from "./pages/Office";
import PrintPage from "./pages/Print";

function Banners() {
  const s = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  if (!s.data) return null;
  return (
    <>
      {s.data.clock.demo_mode && (
        <div role="status" data-testid="demo-banner" className="bg-violet-700 px-4 py-1.5 text-center text-sm text-white">
          {copy.demoBanner}: <span className="font-mono font-semibold">{s.data.clock.today}</span>
        </div>
      )}
      {s.data.has_sample && (
        <div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-sm text-amber-900">
          {copy.sampleBanner}
        </div>
      )}
    </>
  );
}

function Shell() {
  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-2.5 py-1.5 text-sm ${isActive ? "bg-accent-soft font-semibold text-accent" : "text-slate-700 hover:text-accent"}`;
  return (
    <div className="min-h-screen bg-slate-50">
      <Banners />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tracking-tight text-accent">{copy.appName}</span>
            <span className="text-xs text-slate-500">{copy.tagline}</span>
          </div>
          <nav aria-label="Main" className="flex flex-wrap gap-1">
            <NavLink to="/" end className={link}>{copy.nav.dashboard}</NavLink>
            <NavLink to="/new" className={link}>{copy.nav.newReferral}</NavLink>
            <NavLink to="/inbox" className={link}>{copy.nav.inbox}</NavLink>
            <NavLink to="/settings" className={link}>{copy.nav.settings}</NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      {/* Office link and print pages use minimal chrome. */}
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
