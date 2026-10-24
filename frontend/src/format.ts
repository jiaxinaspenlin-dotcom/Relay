// Display formats (design.md): dates as "Oct 15", never ISO in the UI.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}`;
}

export function longDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y] = iso.split("-");
  return `${shortDate(iso)}, ${y}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function time12(hhmm: string | null | undefined): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** Route line: "{patient town} to {practice town}, {n} mi straight-line". */
export function routeLine(from: string, to: string, miles: number | null): string {
  if (miles === null) return `${from} to ${to}`;
  if (miles === 0) return `${from} to ${to}, same town`;
  return `${from} to ${to}, ${miles} mi straight-line`;
}

// The two challenge failures get rust; every other stuck rule is amber.
export const FAILURE_RULES = new Set(["not_scheduled", "seen_no_plan"]);
