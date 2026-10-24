import { useQuery } from "@tanstack/react-query";
import { Inbox, LayoutGrid, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { NavLink, Outlet, Route, Routes } from "react-router-dom";
import { api } from "./api";
import { copy } from "./copy";
import { shortDate } from "./format";
import { RouteGlyph } from "./components/ui";
import Dashboard from "./pages/Dashboard";
import NewReferral from "./pages/NewReferral";
import ReferralDetail from "./pages/ReferralDetail";
import PcpInbox from "./pages/PcpInbox";
import SettingsPage from "./pages/Settings";
import OfficePage from "./pages/Office";
import PrintPage from "./pages/Print";

export function Wordmark({ color = "#FFFFFF" }: { color?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[20px] font-bold leading-none" style={{ color }}>
      <RouteGlyph color={color} />
      {copy.appName}
    </span>
  );
}

function RailLink({ to, icon: Icon, label, count, end }: { to: string; icon: LucideIcon; label: string; count?: number; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      aria-label={count ? `${label}, ${count}` : label}
      className={({ isActive }) =>
        `flex min-h-[40px] items-center gap-3 rounded-control px-3 transition-colors focus-visible:outline-white ${
          isActive ? "bg-white/[.16] text-white" : "text-white/[.82] hover:bg-white/[.08]"}`}
    >
      <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
      <span className="max-[859px]:sr-only">{label}</span>
      {!!count && (
        <span aria-hidden="true" className="ml-auto rounded-full bg-white px-2 text-caption font-semibold text-hemlock max-[859px]:ml-0">
          {count}
        </span>
      )}
    </NavLink>
  );
}

function Shell() {
  const s = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const d = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard });
  return (
    <div className="min-h-screen min-[860px]:flex">
      {/* The rail stretches to the page height; its contents stay pinned while the page scrolls. */}
      <aside className="bg-hemlock min-[860px]:w-[216px] min-[860px]:shrink-0">
        <div className="min-[860px]:sticky min-[860px]:top-0 min-[860px]:flex min-[860px]:h-screen min-[860px]:flex-col">
        <div className="flex items-center justify-between gap-3 px-4 py-3 min-[860px]:block min-[860px]:px-4 min-[860px]:py-7">
          <div className="min-[860px]:mb-8 min-[860px]:px-3"><Wordmark /></div>
          <nav aria-label={copy.nav.label} className="flex gap-1 min-[860px]:flex-col">
            <RailLink to="/" end icon={LayoutGrid} label={copy.nav.dashboard} count={d.data?.summary.stuck} />
            <RailLink to="/inbox" icon={Inbox} label={copy.nav.inbox} count={d.data?.summary.unread_plans} />
            <RailLink to="/settings" icon={SlidersHorizontal} label={copy.nav.settings} />
          </nav>
        </div>
        <div className="mt-auto hidden px-7 pb-7 text-caption text-white/75 min-[860px]:block">{s.data?.practice.practice}</div>
        </div>
      </aside>
      <div className="relative min-w-0 flex-1 overflow-x-hidden bg-paper">
        {s.data?.clock.demo_mode && (
          <div role="status" data-testid="demo-banner" className="border-b border-line bg-surface px-12 py-1.5 text-caption text-muted max-[859px]:px-5">
            {copy.demoBanner}, {shortDate(s.data.clock.today)}
          </div>
        )}
        <main className="relative mx-auto max-w-[1000px] px-12 py-10 max-[859px]:px-5 max-[859px]:py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      {/* The office link and print pages use no app chrome. */}
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
