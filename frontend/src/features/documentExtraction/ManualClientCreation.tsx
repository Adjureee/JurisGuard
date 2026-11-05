import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ClientRecord } from '../../types';
import type { ClientFormValues } from '../criminalCases/schemas';
import {
  civilStatusOptions,
  educationalAttainmentOptions,
  languageDialectOptions,
  religionOptions,
  relationshipOptions,
  sexOptions,
} from '../criminalCases/clientFieldOptions';
import { createClientRecord } from '../../services/recordService';

const otherFlags = [
  ['flag_drugs', 'Drug-related'], ['flag_foreign_national', 'Foreign national'], ['flag_vawc_victim', 'VAWC victim'],
  ['flag_refugee_evacuee', 'Refugee / evacuee'], ['flag_law_enforcer', 'Law enforcer'],
  ['flag_tenant_agrarian', 'Tenant in agrarian case'], ['flag_ofw_land_based', 'OFW land-based'],
  ['flag_ofw_sea_based', 'OFW sea-based'], ['flag_arrested_terrorism', 'Arrested for terrorism'],
  ['flag_indigenous_people', 'Indigenous people'], ['flag_pwd', 'PWD'], ['flag_former_rebel_fve', 'Former rebel / FVE'],
  ['flag_torture_victim', 'Victim of torture'], ['flag_trafficking_victim', 'Victim of trafficking'],
  ['flag_voluntary_rehab_petitioner', 'Petitioner for voluntary rehabilitation'],
] as const;

const initialFields: Record<string, string> = {
  name: '', age: '', sex: '', civil_status: '', religion: '', educational_attainment: '',
  citizenship: 'Filipino', language_dialect: '', address: '', contact_no: '', email: '',
  individual_monthly_income: '', spouse: '', address_of_spouse: '', contact_no_of_spouse: '',
  representative_name: '', representative_age: '', representative_sex: '', representative_civil_status: '',
  representative_address: '', representative_contact_no: '', representative_relationship: '',
  representative_email: '', classification_notes: '',
};

const inputClass = 'mt-1 min-h-11 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20 disabled:bg-slate-100';
const labelClass = 'block text-sm font-medium text-[#4B5563]';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm sm:p-5">
    <h3 className="text-base font-semibold text-[#1F2937]">{title}</h3>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
  </section>;
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-[#E5E7EB] bg-white p-3">
    <dt className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">{label}</dt>
    <dd className="mt-1 break-words text-sm font-medium text-[#2B3642]">{value || '—'}</dd>
  </div>;
}

function ReviewGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4">
    <h3 className="font-semibold text-[#1F2937]">{title}</h3>
    <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</dl>
  </section>;
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Manual client entry only; this path never uploads a document or invokes OCR. */
export function ManualClientCreation({ onSaved, onDirtyChange }: {
  onSaved: (client: ClientRecord) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [fields, setFields] = useState<Record<string, string>>(() => ({ ...initialFields }));
  const [spouseNone, setSpouseNone] = useState(false);
  const [flags, setFlags] = useState<Record<string, boolean>>(() => Object.fromEntries(otherFlags.map(([key]) => [key, false])));
  const [cicl, setCicl] = useState<'unknown' | 'yes' | 'no'>('unknown');
  const [flagsReviewed, setFlagsReviewed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLDivElement>(null);
  const saveGuard = useRef(false);

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  function updateField(key: string, value: string) {
    setFields(current => ({ ...current, [key]: value }));
    setErrors(current => current[key] ? { ...current, [key]: '' } : current);
    setDirty(true);
  }

  function changeCivilStatus(value: string) {
    const wasSingle = fields.civil_status === 'Single';
    updateField('civil_status', value);
    if (value === 'Single') setSpouseNone(true);
    else if (wasSingle) setSpouseNone(false);
  }

  function textField(key: string, label: string, options: {
    required?: boolean; numeric?: 'age' | 'phone' | 'income'; email?: boolean; type?: string;
  } = {}) {
    const { required = false, numeric, email, type = 'text' } = options;
    const maxLength = numeric === 'phone' ? 11 : numeric === 'age' ? 3 : numeric === 'income' ? 9 : undefined;
    return <label key={key} className={labelClass} htmlFor={`manual-${key}`}>
      {label}{required && <span aria-hidden="true"> *</span>}
      <input id={`manual-${key}`} className={inputClass} type={email ? 'email' : type} value={fields[key] ?? ''}
        required={required} disabled={saving} inputMode={numeric ? 'numeric' : undefined} maxLength={maxLength}
        autoComplete="off" aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `manual-${key}-error` : undefined}
        onChange={event => {
          const raw = event.target.value;
          if (numeric && /\D/.test(raw)) {
            setErrors(current => ({ ...current, [key]: 'Use digits only.' }));
            return;
          }
          const value = numeric ? raw.slice(0, maxLength) : raw;
          updateField(key, value);
        }} />
      {errors[key] && <span id={`manual-${key}-error`} role="alert" className="mt-1 block text-xs text-rose-700">{errors[key]}</span>}
    </label>;
  }

  function selectField(key: string, label: string, options: readonly string[], required = false, onValue?: (value: string) => void) {
    return <label key={key} className={labelClass} htmlFor={`manual-${key}`}>
      {label}{required && <span aria-hidden="true"> *</span>}
      <select id={`manual-${key}`} className={inputClass} value={fields[key] ?? ''} required={required} disabled={saving}
        aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `manual-${key}-error` : undefined}
        onChange={event => onValue ? onValue(event.target.value) : updateField(key, event.target.value)}>
        <option value="">Select</option>{options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
      {errors[key] && <span id={`manual-${key}-error`} role="alert" className="mt-1 block text-xs text-rose-700">{errors[key]}</span>}
    </label>;
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    const requiredFields: Array<[string, string]> = [
      ['name', 'Name'], ['age', 'Age'], ['sex', 'Sex'], ['civil_status', 'Civil status'],
      ['religion', 'Religion'], ['educational_attainment', 'Educational attainment'],
      ['citizenship', 'Citizenship'], ['language_dialect', 'Language / dialect'], ['address', 'Address'],
      ['contact_no', 'Contact number'], ['email', 'Email'], ['individual_monthly_income', 'Individual monthly income'],
    ];
    for (const [key, label] of requiredFields) if (!fields[key]?.trim()) next[key] = `${label} is required.`;
    if (fields.age && !/^\d{1,3}$/.test(fields.age)) next.age = 'Enter age as a whole number.';
    if (fields.contact_no && !/^\d{1,11}$/.test(fields.contact_no)) next.contact_no = 'Enter up to 11 digits.';
    if (fields.email && !validEmail(fields.email)) next.email = 'Enter a valid email address.';
    if (fields.individual_monthly_income && (!/^\d{1,9}$/.test(fields.individual_monthly_income) || Number(fields.individual_monthly_income) > 999999999)) {
      next.individual_monthly_income = 'Enter a non-negative amount using digits only.';
    }
    if (!spouseNone) {
      for (const [key, label] of [['spouse', 'Spouse'], ['address_of_spouse', 'Spouse address'], ['contact_no_of_spouse', 'Spouse contact number']] as const) {
        if (!fields[key]?.trim()) next[key] = `${label} is required when spouse information applies.`;
      }
      if (fields.contact_no_of_spouse && !/^\d{1,11}$/.test(fields.contact_no_of_spouse)) next.contact_no_of_spouse = 'Enter up to 11 digits.';
    }
    if (fields.representative_age && !/^\d{1,3}$/.test(fields.representative_age)) next.representative_age = 'Enter age as a whole number, or leave it empty.';
    if (fields.representative_contact_no && !/^\d{1,11}$/.test(fields.representative_contact_no)) next.representative_contact_no = 'Enter up to 11 digits, or leave it empty.';
    if (fields.representative_email && !validEmail(fields.representative_email)) next.representative_email = 'Enter a valid email address, or leave it empty.';
    return next;
  }

  function reviewClient() {
    const nextErrors = validate();
    setErrors(nextErrors);
    setError('');
    if (Object.keys(nextErrors).length) {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    setReview(true);
  }

  function payload(): ClientFormValues {
    const age = Number(fields.age);
    const details = {
      address: fields.address.trim(),
      contact_no: fields.contact_no,
      email: fields.email.trim(),
      individual_monthly_income: fields.individual_monthly_income,
      spouse: spouseNone ? 'None' : fields.spouse.trim(),
      address_of_spouse: spouseNone ? 'None' : fields.address_of_spouse.trim(),
      contact_no_of_spouse: spouseNone ? 'None' : fields.contact_no_of_spouse,
      representative_name: fields.representative_name.trim(),
      representative_age: fields.representative_age ? Number(fields.representative_age) : 0,
      representative_sex: fields.representative_sex,
      representative_civil_status: fields.representative_civil_status,
      representative_address: fields.representative_address.trim(),
      representative_contact_no: fields.representative_contact_no,
      representative_relationship: fields.representative_relationship,
      representative_email: fields.representative_email.trim(),
      detained: false,
      detained_since: '',
      place_of_detention: '',
    };
    return {
      client: {
        name: fields.name.trim(), age, sex: fields.sex, civil_status: fields.civil_status,
        religion: fields.religion, educational_attainment: fields.educational_attainment,
        citizenship: fields.citizenship.trim(), language_dialect: fields.language_dialect,
      },
      client_details: details,
      client_classification: {
        flag_female: flagsReviewed ? fields.sex === 'Female' : null,
        flag_senior: flagsReviewed ? age >= 60 : null,
        flag_cicl: flagsReviewed ? (cicl === 'unknown' ? null : cicl === 'yes') : null,
        flags_reviewed: flagsReviewed,
        flag_urban: false,
        flag_rural: false,
        ...Object.fromEntries(otherFlags.map(([key]) => [key, flags[key] === true])),
        classification_notes: fields.classification_notes.trim(),
      },
    } as ClientFormValues;
  }

  async function saveClient() {
    if (saveGuard.current) return;
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setReview(false);
      setError('Correct the highlighted fields before saving.');
      return;
    }
    saveGuard.current = true;
    setSaving(true);
    setError('');
    try {
      const created = await createClientRecord(payload());
      setDirty(false);
      onSaved(created);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to create client. Your entries are still here; try again.');
    } finally {
      saveGuard.current = false;
      setSaving(false);
    }
  }

  const age = fields.age && /^\d+$/.test(fields.age) ? Number(fields.age) : undefined;
  const womanValue = fields.sex ? (fields.sex === 'Female' ? 'Yes' : 'No') : 'Unresolved';
  const seniorValue = age === undefined ? 'Unresolved' : age >= 60 ? 'Yes' : 'No';
  const selectedFlags = otherFlags.filter(([key]) => flags[key]).map(([, label]) => label);
  const representativeValues = [
    ['Representative name', 'representative_name'], ['Representative age', 'representative_age'],
    ['Representative sex', 'representative_sex'], ['Representative civil status', 'representative_civil_status'],
    ['Representative address', 'representative_address'], ['Representative contact number', 'representative_contact_no'],
    ['Relationship to applicant', 'representative_relationship'], ['Representative email', 'representative_email'],
  ] as const;
  const hasRepresentative = representativeValues.some(([, key]) => fields[key]?.trim());

  return <div ref={formRef} className="flex min-h-full flex-col">
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
      <p className="text-sm leading-6 text-slate-600">Create a client without uploading a document. Enter known information and leave unknown details empty. This does not perform OCR or create a paper-intake verification.</p>
      {error && <p role="alert" className="rounded-md bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}

      {!review ? <div className="space-y-5">
        <Section title="Applicant">
          {textField('name', 'Name', { required: true })}
          {textField('age', 'Age', { required: true, numeric: 'age' })}
          {selectField('sex', 'Sex', sexOptions, true)}
          {selectField('civil_status', 'Civil status', civilStatusOptions, true, changeCivilStatus)}
          {selectField('religion', 'Religion', religionOptions, true)}
          {selectField('educational_attainment', 'Educational attainment', educationalAttainmentOptions, true)}
          {textField('citizenship', 'Citizenship', { required: true })}
          {selectField('language_dialect', 'Language / dialect', languageDialectOptions, true)}
          {textField('address', 'Address', { required: true })}
          {textField('contact_no', 'Contact number', { required: true, numeric: 'phone' })}
          {textField('email', 'Email', { required: true, email: true })}
          {textField('individual_monthly_income', 'Individual monthly income', { required: true, numeric: 'income' })}
          <div className="sm:col-span-2"><h4 className="border-t border-slate-200 pt-4 font-semibold text-[#1F2937]">Spouse information</h4></div>
          <label className={labelClass} htmlFor="manual-spouse">Spouse{!spouseNone && <span aria-hidden="true"> *</span>}
            <input id="manual-spouse" className={inputClass} value={fields.spouse} disabled={spouseNone || saving} aria-invalid={!!errors.spouse}
              onChange={event => updateField('spouse', event.target.value)} />
            {errors.spouse && <span role="alert" className="mt-1 block text-xs text-rose-700">{errors.spouse}</span>}
          </label>
          <label className="flex min-h-11 items-center gap-2 self-end rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-[#4B5563]">
            <input type="checkbox" checked={spouseNone} disabled={fields.civil_status === 'Single' || saving}
              onChange={event => { setSpouseNone(event.target.checked); setDirty(true); setErrors(current => ({ ...current, spouse: '', address_of_spouse: '', contact_no_of_spouse: '' })); }}
              className="h-4 w-4 accent-[#704389]" />None
          </label>
          <label className={labelClass} htmlFor="manual-address_of_spouse">Spouse address{!spouseNone && <span aria-hidden="true"> *</span>}
            <input id="manual-address_of_spouse" className={inputClass} value={fields.address_of_spouse} disabled={spouseNone || saving} aria-invalid={!!errors.address_of_spouse}
              onChange={event => updateField('address_of_spouse', event.target.value)} />
            {errors.address_of_spouse && <span role="alert" className="mt-1 block text-xs text-rose-700">{errors.address_of_spouse}</span>}
          </label>
          <label className={labelClass} htmlFor="manual-contact_no_of_spouse">Spouse contact number{!spouseNone && <span aria-hidden="true"> *</span>}
            <input id="manual-contact_no_of_spouse" className={inputClass} value={fields.contact_no_of_spouse} disabled={spouseNone || saving} inputMode="numeric" maxLength={11} aria-invalid={!!errors.contact_no_of_spouse}
              onChange={event => { const value = event.target.value; if (/\D/.test(value)) { setErrors(current => ({ ...current, contact_no_of_spouse: 'Use digits only.' })); return; } updateField('contact_no_of_spouse', value.slice(0, 11)); }} />
            {errors.contact_no_of_spouse && <span role="alert" className="mt-1 block text-xs text-rose-700">{errors.contact_no_of_spouse}</span>}
          </label>
        </Section>

        <Section title="Representative (if applicable)">
          {textField('representative_name', 'Representative name')}
          {textField('representative_age', 'Representative age', { numeric: 'age' })}
          {selectField('representative_sex', 'Representative sex', sexOptions)}
          {selectField('representative_civil_status', 'Representative civil status', civilStatusOptions)}
          {textField('representative_address', 'Representative address')}
          {textField('representative_contact_no', 'Representative contact number', { numeric: 'phone' })}
          {selectField('representative_relationship', 'Relationship to applicant', relationshipOptions)}
          {textField('representative_email', 'Representative email', { email: true })}
        </Section>

        <Section title="Client Classification">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
            <p><span className="font-semibold">Woman:</span> {womanValue}{fields.sex === 'Female' ? ' (based on recorded sex)' : ''}</p>
            <p className="mt-2"><span className="font-semibold">Senior citizen:</span> {seniorValue}{age !== undefined && age >= 60 ? ' (age 60 or above)' : ''}</p>
          </div>
          <label className={labelClass} htmlFor="manual-cicl">CICL — source evidence review
            <select id="manual-cicl" className={inputClass} value={cicl} disabled={saving} onChange={event => { setCicl(event.target.value as typeof cicl); setDirty(true); }}>
              <option value="unknown">Unresolved — review evidence</option><option value="yes">Yes — explicitly supported</option><option value="no">No — explicitly negated</option>
            </select>
          </label>
          <div className="sm:col-span-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {otherFlags.map(([key, label]) => <label key={key} className="flex min-h-11 items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563]">
              <input type="checkbox" checked={flags[key]} disabled={saving} onChange={event => { setFlags(current => ({ ...current, [key]: event.target.checked })); setDirty(true); }} className="h-4 w-4 accent-[#704389]" />{label}
            </label>)}
          </div>
          <label className="sm:col-span-2 flex items-start gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3 text-sm font-medium text-[#4B5563]">
            <input type="checkbox" checked={flagsReviewed} disabled={saving} onChange={event => { setFlagsReviewed(event.target.checked); setDirty(true); }} className="mt-1 h-4 w-4 accent-[#704389]" />
            <span>I verified the recorded Female, Senior citizen and CICL classifications.</span>
          </label>
          <div className="sm:col-span-2">{textField('classification_notes', 'Classification notes')}</div>
        </Section>
      </div> : <div className="space-y-5">
        <h3 className="text-lg font-semibold text-[#1F2937]">Review client</h3>
        <ReviewGroup title="Applicant">
          <ReviewItem label="Name" value={fields.name} /><ReviewItem label="Age" value={fields.age} />
          <ReviewItem label="Sex" value={fields.sex} /><ReviewItem label="Civil status" value={fields.civil_status} />
          <ReviewItem label="Religion" value={fields.religion} /><ReviewItem label="Educational attainment" value={fields.educational_attainment} />
          <ReviewItem label="Citizenship" value={fields.citizenship} /><ReviewItem label="Language / dialect" value={fields.language_dialect} />
          <ReviewItem label="Address" value={fields.address} /><ReviewItem label="Contact number" value={fields.contact_no} />
          <ReviewItem label="Email" value={fields.email} /><ReviewItem label="Individual monthly income" value={fields.individual_monthly_income} />
        </ReviewGroup>
        <ReviewGroup title="Spouse">
          {spouseNone ? <ReviewItem label="Spouse status" value="None" /> : <>
            <ReviewItem label="Spouse" value={fields.spouse} /><ReviewItem label="Spouse address" value={fields.address_of_spouse} />
            <ReviewItem label="Spouse contact number" value={fields.contact_no_of_spouse} />
          </>}
        </ReviewGroup>
        <ReviewGroup title="Representative (if applicable)">
          {hasRepresentative ? representativeValues.filter(([, key]) => fields[key]?.trim()).map(([label, key]) => <ReviewItem key={key} label={label} value={fields[key]} />)
            : <p className="text-sm text-slate-600 sm:col-span-2">No representative information was entered.</p>}
        </ReviewGroup>
        <ReviewGroup title="Client Classification">
          <ReviewItem label="Woman (based on recorded sex)" value={womanValue} />
          <ReviewItem label="Senior citizen (based on age)" value={seniorValue} />
          <ReviewItem label="CICL (evidence reviewed)" value={cicl === 'unknown' ? 'Unresolved' : cicl === 'yes' ? 'Yes' : 'No'} />
          <div className="sm:col-span-2 lg:col-span-3"><p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Additional classifications</p><p className="mt-1 text-sm font-medium text-[#2B3642]">{selectedFlags.join(', ') || 'None selected'}</p></div>
          <ReviewItem label="Classification verification" value={flagsReviewed ? 'Verified' : 'Not verified'} />
          <div className="sm:col-span-2 lg:col-span-3"><p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Classification notes</p><p className="mt-1 whitespace-pre-wrap text-sm text-[#2B3642]">{fields.classification_notes.trim() || 'No classification notes entered.'}</p></div>
        </ReviewGroup>
      </div>}
    </div>
    <footer className="sticky bottom-0 flex shrink-0 justify-between gap-3 border-t border-[#E5E7EB] bg-white px-5 py-4 sm:px-6">
      {review ? <>
        <button type="button" disabled={saving} onClick={() => { setReview(false); setError(''); }} className="intake-secondary">Back to edit</button>
        <button type="button" disabled={saving} onClick={() => void saveClient()} className="intake-primary disabled:cursor-not-allowed disabled:opacity-50">{saving ? 'Saving client…' : 'Save client'}</button>
      </> : <>
        <span aria-hidden="true" />
        <button type="button" onClick={reviewClient} className="intake-primary">Review client</button>
      </>}
    </footer>
  </div>;
}
