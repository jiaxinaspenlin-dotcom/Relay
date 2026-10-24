import { copy } from "../copy";
import { Field, Muted, inputCls } from "./ui";

export type PlanState = { visit_date: string; assessment: string; plan: string; actions_for_pcp: string; questions_contact: string };
export const emptyPlan: PlanState = { visit_date: "", assessment: "", plan: "", actions_for_pcp: "", questions_contact: "" };

// Care-update form in CMS template sections, shared by Log update and the office page.
export function PlanFields({ value, onChange }: { value: PlanState; onChange: (v: PlanState) => void }) {
  const t = copy.planForm;
  return (
    <fieldset className="space-y-3 rounded-panel border border-line bg-paper p-4">
      <legend className="px-1 font-semibold">{t.legend}</legend>
      <Field label={t.visitDate}>
        <input type="date" className={inputCls} value={value.visit_date} onChange={(e) => onChange({ ...value, visit_date: e.target.value })} />
      </Field>
      {([
        ["assessment", t.assessment, 3],
        ["plan", t.plan, 3],
        ["actions_for_pcp", t.actions, 2],
        ["questions_contact", t.contact, 1],
      ] as const).map(([k, label, rows]) => (
        <Field key={k} label={label}>
          <textarea className={inputCls} rows={rows} value={value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.value })} />
        </Field>
      ))}
      <Muted>{t.omitted}</Muted>
    </fieldset>
  );
}
