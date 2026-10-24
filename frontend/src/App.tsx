import { NavLink, Route, Routes } from "react-router-dom";
import { copy } from "./copy";
import dashboard from "./mock/dashboard.json";

// Scaffold only (task 1.1). Screens are built in Block 4 against src/mock/*.json, then the API.
function Placeholder({ title }: { title: string }) {
  return (
    <section className="p-6">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-slate-600">{copy.placeholder}</p>
    </section>
  );
}

function DashboardStub() {
  const s = dashboard.summary;
  return (
    <section className="p-6">
      <h1 className="text-xl font-semibold">{copy.nav.dashboard}</h1>
      <p className="mt-2 font-mono text-sm text-slate-700">
        open {s.open} · stuck {s.stuck} · closed this month {s.closed_this_month} (synthetic)
      </p>
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
      <nav aria-label="Main" className="flex gap-6 border-b px-6 py-3">
        <span className="font-semibold">{copy.appName}</span>
        <NavLink to="/" end className={link}>{copy.nav.dashboard}</NavLink>
        <NavLink to="/new" className={link}>{copy.nav.newReferral}</NavLink>
        <NavLink to="/specialist" className={link}>{copy.nav.specialist}</NavLink>
        <NavLink to="/inbox" className={link}>{copy.nav.inbox}</NavLink>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<DashboardStub />} />
          <Route path="/new" element={<Placeholder title={copy.nav.newReferral} />} />
          <Route path="/specialist" element={<Placeholder title={copy.nav.specialist} />} />
          <Route path="/inbox" element={<Placeholder title={copy.nav.inbox} />} />
        </Routes>
      </main>
    </div>
  );
}
