// Thin API client. Every screen reads from here; src/mock/*.json is for offline design only.

export type StuckFlag = {
  rule: string;
  days: number;
  message: string;
  setting_key: string;
  threshold: number;
  unit: string;
  recipient: string;
  challenge_failure: number | null;
};

export type StepperItem = { stage: string; label: string; at: string | null };

export type Card = {
  id: string;
  patient: { id: string; synthetic_name: string; town: string; county: string; age: number; sex: string; payer: string };
  specialty: string;
  priority: string;
  performer: { id: string; name: string; town: string; fictional: boolean };
  stage: string;
  stage_label: string;
  stepper: StepperItem[];
  miles: number | null;
  appointment: { start: string; status: string } | null;
  open_barriers: { type: string; label: string; opened: string }[];
  stuck: StuckFlag[];
};

export type Dashboard = {
  as_of: string;
  summary: {
    open: number;
    stuck: number;
    closed_this_month: number;
    median_days_sent_to_scheduled: number | null;
    median_basis_n: number;
  };
  needs_attention: { referral_id: string; days_stuck: number; flags: StuckFlag[]; card: Card }[];
  pipeline: { stage: string; label: string; referral_ids: string[]; cards: Card[] }[];
  practice_settings: { label: string; values: Record<string, number> };
};

export type TimelineItem = {
  kind: "event" | "communication";
  at: string;
  stage?: string;
  actor?: string;
  note?: string;
  source?: string | null;
  recipient?: string;
  text?: string;
  edited?: boolean;
};

export type Plan = {
  returned_on: string;
  from: string;
  visit_date: string;
  reason: string;
  assessment: string;
  plan: string;
  actions_for_pcp: string;
  questions_contact: string;
  omitted_fields_note: string;
};

export type PlaceItem = {
  kind: string;
  title: string;
  source: string;
  source_url: string;
  year: string;
  level: string;
  cannot_tell_you: string;
  values?: { measure: string; value: number; ci_low: number; ci_high: number; unit: string }[];
  block_groups?: number;
  criteria?: { criteria: string; block_groups: number }[];
  designations?: { hpsa_id: string; name: string; designation_type: string; score: number | null; includes_town: boolean }[];
  hospitals?: HospitalCard[];
};

export type HospitalCard = {
  name: string;
  town: string;
  miles: number;
  beds: number;
  beds_label: string;
  icu_beds: number;
  cms_rating: number | null;
};

export type Detail = {
  card: Card;
  referral: {
    id: string;
    reason_text: string;
    reason_condition: { code: string; display: string };
    priority: string;
    plan: Plan | null;
    performer: { name: string; town: string; fictional: boolean; address?: string };
  };
  timeline: TimelineItem[];
  log_update_actions: string[];
  can_close: boolean;
  place_context: { town: string; county: string; items: PlaceItem[] };
};

export type Practice = {
  id: string;
  label: string;
  address: string;
  town: string | null;
  city_raw: string;
  clinician_count: number;
  medicare_assignment: "accepts" | "may_accept";
  medicare_label: string;
  miles: number | null;
  nearest_hospital: HospitalCard | null;
};

export type FinderResult = {
  specialty: string;
  patient_town: string;
  medicare_prominent: boolean;
  telehealth_note: string;
  total: number;
  distance_unavailable: number;
  results: Practice[];
};

export type Patient = {
  id: string;
  synthetic_name: string;
  town: string;
  county: string;
  age: number;
  sex: string;
  payer: string;
  suggested_specialty: string;
  suggested_condition_code: string;
  live_demo: boolean;
};

export type Draft = {
  rule: string;
  rule_message: string;
  recipient: "specialist" | "patient" | "pcp";
  recipient_label: string;
  facts: { id: string; label: string; value: string; source: string }[];
  text: string;
  verified: boolean;
  problems: string[];
};

export type InboxItem = {
  card: Card;
  reason_text: string;
  reason_condition: { display: string };
  priority: string;
  plan: Plan;
  timeline: TimelineItem[];
};

export type Clock = { today: string; base: string; offset_days: number };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* keep statusText */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

const post = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });

export const api = {
  dashboard: () => request<Dashboard>("/api/dashboard"),
  clock: () => request<Clock>("/api/clock"),
  advanceClock: (days: 1 | 7) => post<Clock>("/api/clock", { advance_days: days }),
  resetClock: () => post<Clock>("/api/clock", { reset: true }),
  resetDemo: () => post<Clock>("/api/reset", {}),
  patients: () => request<{ patients: Patient[]; specialties: string[] }>("/api/patients"),
  conditions: (pid: string) =>
    request<{ conditions: { code: string; display: string; onset: string | null }[] }>(
      `/api/patients/${pid}/conditions`,
    ),
  finder: (specialty: string, pid: string) =>
    request<FinderResult>(
      `/api/finder?specialty=${encodeURIComponent(specialty)}&patient_id=${encodeURIComponent(pid)}`,
    ),
  createReferral: (body: {
    patient_id: string;
    specialty: string;
    practice_id: string;
    reason_text: string;
    priority: string;
    condition_code: string;
  }) => post<Detail>("/api/referrals", body),
  referral: (rid: string) => request<Detail>(`/api/referrals/${rid}`),
  logUpdate: (rid: string, body: unknown) => post<Detail>(`/api/referrals/${rid}/updates`, body),
  draft: (rid: string) => request<Draft>(`/api/referrals/${rid}/draft`),
  send: (rid: string, body: { recipient: string; text: string; rule: string; drafted_text: string }) =>
    post<Detail>(`/api/referrals/${rid}/communications`, body),
  inbox: () => request<{ items: InboxItem[] }>("/api/inbox"),
  close: (rid: string, note: string) => post<Detail>(`/api/referrals/${rid}/close`, { note }),
  fhirUrl: (rid: string) => `/api/referrals/${rid}/fhir`,
};
