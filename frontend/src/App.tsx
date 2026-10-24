import { useQuery } from "@tanstack/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, Inbox, LayoutGrid, LogOut, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { LIVE, api } from "./api";
import { copy } from "./copy";
import { RouteGlyph } from "./components/ui";
import Dashboard from "./pages/Dashboard";
import NewReferral from "./pages/NewReferral";
import ReferralDetail from "./pages/ReferralDetail";
import PcpInbox from "./pages/PcpInbox";
import SettingsPage from "./pages/Settings";
import OfficePage from "./pages/Office";
import PrintPage from "./pages/Print";
import SignIn from "./pages/SignIn";
import { Loading } from "./components/Status";

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

function SignOut({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient();
  const out = useMutation({ mutationFn: api.signOut, onSuccess: () => { qc.clear(); window.location.assign("/sign-in"); } });
  return (
    <button type="button" onClick={() => out.mutate()} aria-label={copy.nav.signOut}
      className={`flex min-h-[40px] items-center gap-3 rounded-control px-3 text-white/[.82] hover:bg-white/[.08] ${compact ? "" : "w-full"}`}>
      <LogOut size={18} strokeWidth={1.8} aria-hidden="true" />
      <span className={compact ? "sr-only" : ""}>{copy.nav.signOut}</span>
    </button>
  );
}

function Shell() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, retry: false });
  const loc = useLocation();
  const s = useQuery({ queryKey: ["settings"], queryFn: api.settings, enabled: !!me.data });
  const d = useQuery({ queryKey: ["dashboard"], queryFn: api.dashboard, ...LIVE, enabled: !!me.data });
  if (me.isLoading) return <Loading />;
  if (me.error || !me.data) return <Navigate to="/sign-in" replace state={{ from: loc.pathname }} />;
  const user = me.data.user;
  const clinician = user.role === "clinician";
  return (
    <div className="min-h-screen min-[860px]:flex">
      {/* The rail stretches to the page height; its contents stay pinned while the page scrolls. */}
      <aside className="bg-hemlock min-[860px]:w-[216px] min-[860px]:shrink-0">
        <div className="min-[860px]:sticky min-[860px]:top-0 min-[860px]:flex min-[860px]:h-screen min-[860px]:flex-col">
        <div className="flex items-center justify-between gap-3 px-4 py-3 min-[860px]:block min-[860px]:px-4 min-[860px]:py-8">
          <div className="min-[860px]:mb-8 min-[860px]:px-3"><Wordmark /></div>
          <nav aria-label={copy.nav.label} className="flex gap-1 min-[860px]:flex-col">
            {clinician ? (
              <>
                <RailLink to="/inbox" icon={Inbox} label={copy.nav.inbox} count={d.data?.summary.unread_plans} />
                <RailLink to="/" end icon={LayoutGrid} label={copy.nav.referrals} />
              </>
            ) : (
              <>
                <RailLink to="/" end icon={LayoutGrid} label={copy.nav.dashboard} count={d.data?.summary.stuck} />
                <RailLink to="/new" icon={FilePlus2} label={copy.nav.newReferral} />
              </>
            )}
            <RailLink to="/settings" icon={SlidersHorizontal} label={copy.nav.settings} />
            <span className="min-[860px]:hidden"><SignOut compact /></span>
          </nav>
        </div>
        <div className="mt-auto hidden px-4 pb-8 min-[860px]:block">
          <div className="mb-2 px-3 text-caption text-white/75">
            <div className="font-semibold text-white" data-testid="signed-in-as">{user.name}</div>
            <div data-testid="signed-in-role">{clinician ? copy.nav.roleClinician : copy.nav.roleCoordinator}</div>
            <div>{s.data?.practice.practice ?? user.practice}</div>
          </div>
          <SignOut />
        </div>
        </div>
      </aside>
      <div className="relative min-w-0 flex-1 overflow-x-hidden bg-paper">
        {/* Content sits 56px from the rail, up to 1000px wide, left-aligned on wide screens. */}
        <main className="relative max-w-[1112px] px-14 py-12 max-[859px]:px-4 max-[859px]:py-6">
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
      <Route path="/sign-in" element={<SignIn />} />
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
