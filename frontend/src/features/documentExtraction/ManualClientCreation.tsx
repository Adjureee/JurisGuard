import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import type { ClientRecord } from '../../types';
import type { ClientFormValues } from '../criminalCases/schemas';
import { createClientRecord } from '../../services/recordService';

const applicantFields = [
  ['name', 'Name'], ['age', 'Age'], ['sex', 'Sex'], ['civil_status', 'Civil status'],
  ['religion', 'Religion'], ['educational_attainment', 'Educational attainment'],
  ['citizenship', 'Citizenship'], ['language_dialect', 'Language / dialect'],
] as const;
const detailsFields = [
  ['address', 'Address'], ['contact_no', 'Contact number'], ['email', 'Email'],
  ['individual_monthly_income', 'Individual monthly income'], ['spouse', 'Spouse'],
  ['address_of_spouse', 'Spouse address'], ['contact_no_of_spouse', 'Spouse contact number'],
] as const;
const representativeFields = [
  ['representative_name', 'Representative name'], ['representative_age', 'Representative age'],
  ['representative_sex', 'Representative sex'], ['representative_civil_status', 'Representative civil status'],
  ['representative_address', 'Representative address'], ['representative_contact_no', 'Representative contact number'],
  ['representative_relationship', 'Relationship to applicant'], ['representative_email', 'Representative email'],
] as const;
const otherFlags = [
  ['flag_drugs', 'Drug-related'], ['flag_foreign_national', 'Foreign national'], ['flag_vawc_victim', 'VAWC victim'],
  ['flag_refugee_evacuee', 'Refugee / evacuee'], ['flag_law_enforcer', 'Law enforcer'],
  ['flag_tenant_agrarian', 'Tenant in agrarian case'], ['flag_ofw_land_based', 'OFW land-based'],
  ['flag_ofw_sea_based', 'OFW sea-based'], ['flag_arrested_terrorism', 'Arrested for terrorism'],
  ['flag_indigenous_people', 'Indigenous people'], ['flag_pwd', 'PWD'], ['flag_former_rebel_fve', 'Former rebel / FVE'],
  ['flag_torture_victim', 'Victim of torture'], ['flag_trafficking_victim', 'Victim of trafficking'],
  ['flag_voluntary_rehab_petitioner', 'Petitioner for voluntary rehabilitation'],
] as const;

/** Direct client creation through the existing service; no scan or OCR required. */
export function ManualClientCreation({ onSaved, onDirtyChange }: { onSaved: (client: ClientRecord) => void; onDirtyChange?: (dirty:boolean)=>void }) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [flags, setFlags] = useState<Record<string, boolean | null>>({});
  const [flagsReviewed, setFlagsReviewed] = useState(false);
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(()=>{onDirtyChange?.(Object.keys(fields).length>0||Object.keys(flags).length>0);},[fields,flags,onDirtyChange]);
  function input(key: string, label: string) {
    return <label key={key} className="block text-sm font-medium text-slate-700" htmlFor={`manual-${key}`}>{label}{key === 'name' ? ' (required)' : ''}
      <input id={`manual-${key}`} type={key.includes('email') ? 'email' : 'text'} value={fields[key] ?? ''}
        required={key === 'name'} readOnly={review} disabled={saving} autoComplete="off"
        inputMode={key === 'age' || key === 'representative_age' ? 'numeric' : undefined}
        onChange={event => setFields(current => ({ ...current, [key]: event.target.value }))}
        className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-base read-only:bg-slate-50" />
    </label>;
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError('');
    if (!fields.name?.trim()) { setError('Enter the client’s name.'); return; }
    for (const key of ['age', 'representative_age']) {
      if (fields[key] && !/^\d{1,3}$/.test(fields[key])) { setError('Enter an age in whole years, or leave it empty.'); return; }
    }
    if (!review) { setReview(true); return; }
    setSaving(true);
    // Empty age is shown as empty and the existing API stores its zero sentinel
    // as NULL. Citizenship, sex and representative details have no defaults.
    const values: ClientFormValues = {
      client: { ...Object.fromEntries(applicantFields.map(([key]) => [key, fields[key] ?? ''])), age: fields.age ? Number(fields.age) : 0 } as ClientFormValues['client'],
      client_details: { ...Object.fromEntries([...detailsFields, ...representativeFields].map(([key]) => [key, fields[key] ?? ''])), representative_age: fields.representative_age ? Number(fields.representative_age) : 0 } as ClientFormValues['client_details'],
      client_classification: {
        ...Object.fromEntries(otherFlags.map(([key]) => [key, flags[key] === true])),
        flag_female: flags.flag_female ?? null, flag_senior: flags.flag_senior ?? null,
        flag_cicl: flags.flag_cicl ?? null, flags_reviewed: flagsReviewed,
        classification_notes: fields.classification_notes ?? '',
      } as ClientFormValues['client_classification'],
    };
    try { const client = await createClientRecord(values); toast.success('Client created manually'); onSaved(client); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to create client.'); }
    finally { setSaving(false); }
  }
  return <form onSubmit={event => void submit(event)} className="space-y-5 p-5">
    <h3 className="text-lg font-semibold">{review ? 'Review manually entered client' : 'Manual client entry'}</h3>
    <p className="text-sm text-slate-600">Create a client without uploading a document. Enter known information and leave unknown details empty. This does not perform OCR or create a paper-intake verification.</p>
    <fieldset className="rounded border p-4"><legend className="px-1 font-semibold">Applicant</legend><div className="grid gap-4 sm:grid-cols-2">{[...applicantFields, ...detailsFields].map(([key, label]) => input(key, label))}</div></fieldset>
    <fieldset className="rounded border p-4"><legend className="px-1 font-semibold">Representative (if applicable)</legend><div className="grid gap-4 sm:grid-cols-2">{representativeFields.map(([key, label]) => input(key, label))}</div></fieldset>
    <details className="rounded border p-4"><summary className="cursor-pointer font-semibold">Client classification (optional)</summary>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">{([['flag_female', 'Female'], ['flag_senior', 'Senior citizen'], ['flag_cicl', 'CICL']] as const).map(([key, label]) =>
        <label key={key} className="text-sm">{label}<select aria-label={label} value={flags[key] == null ? '' : String(flags[key])} disabled={review || saving}
          onChange={event => setFlags(current => ({ ...current, [key]: event.target.value === '' ? null : event.target.value === 'true' }))} className="ml-2 rounded border px-2 py-2"><option value="">Unknown / not recorded</option><option value="true">Yes</option><option value="false">No</option></select></label>)}
        {otherFlags.map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={flags[key] === true} disabled={review || saving} onChange={event => setFlags(current => ({ ...current, [key]: event.target.checked }))} />{label}</label>)}
      </div><label className="my-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={flagsReviewed} disabled={review || saving} onChange={event => setFlagsReviewed(event.target.checked)} />I verified the recorded Female, Senior citizen and CICL classifications.</label>
      {input('classification_notes', 'Classification notes')}
    </details>
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    <div className="sticky bottom-0 flex justify-end gap-3 border-t bg-white py-4">{review && <button type="button" disabled={saving} onClick={() => setReview(false)} className="rounded border px-4 py-2">Back to edit</button>}
      <button type="submit" disabled={saving} className="rounded bg-[#704389] px-4 py-2 font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : review ? 'Save client' : 'Review client'}</button></div>
  </form>;
}
