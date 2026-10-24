import { NavLink, Route, Routes } from "react-router-dom";
import { copy } from "./copy";
import { DemoClock } from "./components/DemoClock";
import Dashboard from "./pages/Dashboard";
import NewReferral from "./pages/NewReferral";
import ReferralDetail from "./pages/ReferralDetail";
import PcpInbox from "./pages/PcpInbox";

function Deferred({ title }: { title: string }) {
  return (
    <section className="p-6">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-slate-600">{copy.deferred}</p>
    </section>
  );
}

export default function App() {
  const link = ({ isActive }: { isActive: boolean }) =>
    isActive ? "font-semibold text-accent" : "text-slate-700 hover:text-accent";
  return (
    <div className="min-h-screen">
      <div role="status" className="bg-amber-50 px-4 py-2 text-sm text-amber-900">
        {copy.syntheticBanner}
      </div>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3">
        <nav aria-label="Main" className="flex flex-wrap gap-5">
          <span className="font-semibold">{copy.appName}</span>
          <NavLink to="/" end className={link}>{copy.nav.dashboard}</NavLink>
          <NavLink to="/new" className={link}>{copy.nav.newReferral}</NavLink>
          <NavLink to="/inbox" className={link}>{copy.nav.inbox}</NavLink>
          <NavLink to="/specialist" className={link}>{copy.nav.specialist}</NavLink>
        </nav>
        <DemoClock />
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/new" element={<NewReferral />} />
          <Route path="/referrals/:rid" element={<ReferralDetail />} />
          <Route path="/inbox" element={<PcpInbox />} />
          <Route path="/specialist" element={<Deferred title={copy.nav.specialist} />} />
        </Routes>
      </main>
    </div>
  );
}
