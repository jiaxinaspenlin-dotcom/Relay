// Thin API client. Every screen reads from here (src/mock/*.json is design-only).

export type StuckFlag = {
  rule: string;
  days: number;
  message: string;
  status: string;
  threshold: number;
  unit: string;
  recipient: string;
  action: "call_office" | "follow_up" | "send_records" | "message_patient" | "open";
  challenge_failure: number | null;
};

export type StepperItem = { stage: string; label: string; at: string | null };

export type PatientBrief = {
  id: string;
  name: string;
  town: string;
  county: string | null;
  dob: string | null;
  age: number | null;
  coverage: string;
  coverage_label: string;
  masshealth: boolean;
  medicare: boolean;
  sample: boolean;
  has_chart: boolean;
};

export type Card = {
  id: string;
  sample: boolean;
  patient: PatientBrief;
  specialty: string;
  priority: string;
  performer: { id: string; name: string; town: string; fictional: boolean; address: string; phone: string };
  stage: string;
  stage_label: string;
  status_label: string;
  stepper: StepperItem[];
  last_update: string;
  days_in_stage: number;
  miles: number | null;
  appointment: { start: string; time: string | null; status: string } | null;
  authorization: string;
  authorization_label: string;
  open_barriers: { type: string; label: string; opened: string }[];
  stuck: StuckFlag[];
  can_call: boolean;
};

export type Dashboard = {
  as_of: string;
  total: number;
  has_sample: boolean;
  summary: {
    open: number;
    stuck: number;
    lost: number;
    unread_plans: number;
    closed_this_month: number;
    median_days_sent_to_scheduled: number | null;
  };
  needs_attention: { referral_id: string; days_stuck: number; failure: boolean; flags: StuckFlag[]; card: Card }[];
  pipeline: { stage: string; label: string; referral_ids: string[]; cards: Card[] }[];
};

export type TimelineItem = {
  kind: "event" | "communication";
  event_kind?: string;
  at: string;
  id?: string;
  stage?: string;
  actor?: string;
  note?: string;
  source?: string | null;
  recipient?: string;
  text?: string;
  edited?: boolean;
  channel?: string;
  message_kind?: string;
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

export type HospitalCard = {
  name: string;
  town: string;
  miles: number;
  beds: number;
  beds_label: string;
  icu_beds: number;
  cms_rating: number | null;
  distance_label?: string;
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
  designations?: { hpsa_id: string; name: string; designation_type: string; score: number | null; includes_town: boolean }[];
};

export type Communication = { id: string; sent: string; recipient: string; text: string; kind: string; channel: string };

export type Detail = {
  card: Card;
  referral: {
    id: string;
    reason_text: string;
    reason_condition: { code: string; display: string };
    priority: string;
    plan: Plan | null;
    performer: { name: string; town: string; fictional: boolean; address?: string; phone: string };
    requester: { practice: string; clinician: string; coordinator: string };
    communications: Communication[];
    receipt: { complete: boolean; missing: string[]; note: string } | null;
  };
  timeline: TimelineItem[];
  update_actions: string[];
  can_send: boolean;
  can_close: boolean;
  can_message_patient: boolean;
  office_path: string;
  hint: string;
  transport: {
    masshealth: boolean;
    barrier_open: boolean;
    show_pt1: boolean;
    pt1_status: "not_started" | "requested" | "confirmed";
    pt1_url: string;
    show_plan_note: boolean;
    transport_plan: string;
  };
  place_context: { town: string; county: string; items: PlaceItem[] };
};

export type Practice = {
  id: string;
  label: string;
  address: string;
  town: string | null;
  city_raw: string;
  clinician_count: number;
  clinician_label: string;
  medicare_assignment: "accepts" | "may_accept";
  medicare_label: string;
  miles: number | null;
  distance_label: string;
  phone: string;
  nearest_hospital: HospitalCard | null;
};

export type FinderResult = {
  specialty: string;
  patient_town: string;
  medicare_prominent: boolean;
  telehealth_note: string;
  total: number;
  has_more: boolean;
  results: Practice[];
};

export type Patient = PatientBrief & { suggested_specialty: string | null; suggested_condition_code: string | null };

export type Draft = {
  rule: string;
  rule_message: string;
  recipient: "specialist" | "patient" | "pcp";
  recipient_label: string;
  subject: string;
  facts: { id: string; label: string; value: string; source: string }[];
  text: string;
  verified: boolean;
  problems: string[];
};

export type PatientMessage = { subject: string; text: string; phone: string; needs_phone: boolean };

export type InboxItem = {
  card: Card;
  reason_text: string;
  reason_condition: { display: string };
  priority: string;
  plan: Plan;
  timeline: TimelineItem[];
};

export type Clock = { today: string; real_today: string; demo_mode: boolean; offset_days: number };

export type Settings = {
  clock: Clock;
  practice: { practice: string; clinician: string; coordinator: string };
  has_sample: boolean;
  referrals: number;
};

export type OfficeView = {
  referral_id: string;
  sample: boolean;
  today: string;
  stage: string;
  stage_label: string;
  status_label: string;
  stepper: StepperItem[];
  to: string;
  from: { practice: string; clinician: string; coordinator: string };
  patient: { name: string; dob: string | null; town: string };
  specialty: string;
  priority: string;
  condition: string;
  reason_text: string;
  authorization: string;
  appointment: { start: string; time: string | null; status: string } | null;
  actions: string[];
};

export type Message = { subject: string; text: string };

/** Body shared by the office link and coordinator Log update (backend app/updates.py). */
export type UpdateBody = {
  action: string;
  note?: string;
  missing?: string[];
  authorization?: string;
  contact_mode?: string;
  appointment_date?: string;
  appointment_time?: string | null;
  plan?: { visit_date: string | null; assessment: string; plan: string; actions_for_pcp: string; questions_contact: string };
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string"
        ? body.detail
        : Array.isArray(body.detail) ? body.detail.map((d: { msg: string }) => d.msg).join("; ") : JSON.stringify(body.detail);
    } catch {
      /* keep statusText */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

const post = <T,>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

export type FinderParams = { maxMiles: number | null; acceptsOnly: boolean; limit: number };

export const api = {
  config: () => request<{ voice_enabled: boolean }>("/api/config"),
  dashboard: () => request<Dashboard>("/api/dashboard"),
  settings: () => request<Settings>("/api/settings"),
  updateSettings: (body: { demo_mode?: boolean; practice?: Settings["practice"] }) => post<Settings>("/api/settings", body),
  advanceClock: (days: 1 | 7) => post<Clock>("/api/clock", { advance_days: days }),
  resetClock: () => post<Clock>("/api/clock", { reset: true }),
  loadSample: () => post<Settings>("/api/sample-data", {}),
  resetSample: () => post<Settings>("/api/sample-data/reset", {}),
  clearData: () => post<Settings>("/api/clear-data", { confirm: "DELETE" }),
  towns: () => request<{ towns: string[] }>("/api/towns"),
  patients: () => request<{ patients: Patient[]; specialties: string[]; coverage_options: Record<string, string> }>("/api/patients"),
  addPatient: (body: { name: string; town: string; coverage: string; dob: string | null }) => post<PatientBrief>("/api/patients", body),
  conditions: (pid: string) => request<{ has_chart: boolean; conditions: { code: string; display: string }[] }>(`/api/patients/${pid}/conditions`),
  finder: (specialty: string, pid: string, p: FinderParams) => {
    const q = new URLSearchParams({ specialty, patient_id: pid, limit: String(p.limit) });
    if (p.maxMiles) q.set("max_miles", String(p.maxMiles));
    if (p.acceptsOnly) q.set("accepts_only", "true");
    return request<FinderResult>(`/api/finder?${q}`);
  },
  createReferral: (body: {
    patient_id: string; specialty: string; practice_id: string; reason_text: string; priority: string;
    condition_code: string; condition_text: string;
  }) => post<Detail>("/api/referrals", body),
  referral: (rid: string) => request<Detail>(`/api/referrals/${rid}`),
  referralMessage: (rid: string) => request<Message>(`/api/referrals/${rid}/message`),
  sendReferral: (rid: string, channel: "copy" | "email" | "print") =>
    post<Detail & { message: Message; communication_id: string }>(`/api/referrals/${rid}/send`, { channel }),
  logUpdate: (rid: string, body: UpdateBody & { source: string }) => post<Detail>(`/api/referrals/${rid}/updates`, body),
  addBarrier: (rid: string, type: string, note: string) => post<Detail>(`/api/referrals/${rid}/barriers`, { type, note }),
  setTransport: (rid: string, body: { pt1_status?: string; transport_plan?: string }) => post<Detail>(`/api/referrals/${rid}/transport`, body),
  setOfficePhone: (rid: string, phone: string) => post<Detail>(`/api/referrals/${rid}/office-phone`, { phone }),
  draft: (rid: string) => request<Draft>(`/api/referrals/${rid}/draft`),
  patientMessage: (rid: string) => request<PatientMessage>(`/api/referrals/${rid}/patient-message`),
  sendMessage: (rid: string, body: { recipient: string; text: string; rule?: string; drafted_text: string; channel: string; kind: string }) =>
    post<Detail & { communication_id: string }>(`/api/referrals/${rid}/communications`, body),
  inbox: () => request<{ items: InboxItem[] }>("/api/inbox"),
  close: (rid: string, note: string) => post<Detail>(`/api/referrals/${rid}/close`, { note }),
  fhirUrl: (rid: string) => `/api/referrals/${rid}/fhir`,
  office: (token: string) => request<OfficeView>(`/api/office/${token}`),
  officeAct: (token: string, body: UpdateBody) => post<OfficeView>(`/api/office/${token}`, body),
};
