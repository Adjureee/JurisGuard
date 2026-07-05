import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import MainLayout from "../layouts/MainLayout";
import PageHeader from "../components/PageHeader";
import AddCaseModal from "../components/modals/AddCaseModal";
import AddClientModal from "../components/modals/AddClientModal";
import ExportCsvModal from "../components/modals/ExportCsvModal";
import ModalPortal from "../components/modals/ModalPortal";
import { StatusBadge } from "../features/criminalCases/components/StatusBadge";
import { useCriminalCasesStore } from "../features/criminalCases/criminalCasesStore";
import {
  filterCriminalCaseRows,
  type CaseTableFilter,
  type CriminalCaseRow,
} from "../services/exportService";
import {
  listCaseRecords,
  listClientRecords,
  terminateCaseRecord,
  updateCaseRecord,
  updateClientRecord,
  type TerminationPayload,
} from "../services/recordService";
import type { CaseStatus, ClientRecord, CriminalCaseRecord } from "../types";
import type {
  CaseFormValues,
  ClientFormValues,
} from "../features/criminalCases/schemas";

const accordionBorderClass: Record<CaseStatus, string> = {
  Pending: "border-amber-200",
  Ongoing: "border-emerald-200",
  Active: "border-emerald-200",
  Terminated: "border-red-200",
  Archived: "border-parchment-300",
};

const filterOptions: Array<{ value: CaseTableFilter; label: string }> = [
  { value: "all", label: "All Cases" },
  { value: "urban", label: "Urban" },
  { value: "rural", label: "Rural" },
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

const panaboBarangays = [
  "A. O. Floirendo",
  "Buenavista",
  "Cacao",
  "Cagangohan",
  "Consolacion",
  "Dapco",
  "Datu Abdul Dadia",
  "Gredu",
  "J. P. Laurel",
  "Kasilak",
  "Katipunan",
  "Katualan",
  "Kauswagan",
  "Kiotoy",
  "Little Panay",
  "Lower Panaga",
  "Mabunao",
  "Maduao",
  "Malativas",
  "Manay",
  "Nanyo",
  "New Malaga",
  "New Malitbog",
  "New Pandan",
  "New Visayas",
  "Quezon",
  "Salvacion",
  "San Francisco",
  "San Nicolas",
  "San Pedro",
  "San Roque",
  "San Vicente",
  "Santa Cruz",
  "Santo Nino",
  "Sindaton",
  "Southern Davao",
  "Tagpore",
  "Tibungol",
  "Upper Licanan",
  "Waterfall",
];

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
      <path fill="currentColor" d="M9 3h2v6h6v2h-6v6H9v-6H3V9h6V3Z" />
    </svg>
  );
}

function UserPlusIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
      <path
        fill="currentColor"
        d="M8 10a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0 2c3.3 0 6 1.6 6 3.5V17H2v-1.5C2 13.6 4.7 12 8 12Zm7-6h2v3h3v2h-3v3h-2v-3h-3V9h3V6Z"
      />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
      <path
        fill="currentColor"
        d="M3 5h8v2H3V5Zm10-1h2v1h2v2h-2v1h-2V4ZM3 13h2v-1h2v4H5v-1H3v-2Zm6 0h8v2H9v-2Z"
      />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
      <path
        fill="currentColor"
        d="M10 4C5.8 4 2.7 7.1 1.5 10c1.2 2.9 4.3 6 8.5 6s7.3-3.1 8.5-6C17.3 7.1 14.2 4 10 4Zm0 10a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0-2.1a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8Z"
      />
    </svg>
  );
}

function InfoTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-line bg-card p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-gray-800">
        {value || "-"}
      </p>
    </div>
  );
}

function toClientFormValues(client: ClientRecord): ClientFormValues {
  return {
    client: { ...client.client },
    client_details: { ...client.client_details },
    client_classification: { ...client.client_classification },
  };
}

function toCaseFormValues(record: CriminalCaseRecord): CaseFormValues {
  return {
    client_id: record.client_id,
    intake_record: { ...record.intake_record },
    representative: { ...record.representative },
    adverse_party: { ...record.adverse_party },
    cases: {
      ...record.cases,
      case_status: record.cases.case_status ?? record.cases.status_of_case,
      incident_barangay: record.cases.incident_barangay ?? "",
      incident_city: record.cases.incident_city ?? "Panabo City",
      incident_address: record.cases.incident_address ?? "",
      latitude: record.cases.latitude ?? "",
      longitude: record.cases.longitude ?? "",
      assigned_pao: record.cases.assigned_pao ?? "",
      filing_date: record.cases.filing_date ?? "",
      hearing_schedule: record.cases.hearing_schedule ?? "",
      remarks: record.cases.remarks ?? "",
    },
  };
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-10 w-full rounded-lg border border-parchment-300 bg-card px-3 text-sm text-gray-800 outline-none transition focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
        {label}
      </span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        className="mt-1 w-full rounded-lg border border-parchment-300 bg-card px-3 py-2 text-sm text-gray-800 outline-none transition focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
      />
    </label>
  );
}

function CaseFilterSelect({
  value,
  onChange,
}: {
  value: CaseTableFilter;
  onChange: (value: CaseTableFilter) => void;
}) {
  const selected =
    filterOptions.find((option) => option.value === value) ?? filterOptions[0];

  return (
    <div className="flex h-10 items-center gap-2 rounded-lg border border-parchment-300 bg-card px-3 text-gray-800">
      <SlidersIcon />
      <select
        className="h-8 min-w-32 bg-card text-sm font-medium text-gray-800 outline-none"
        value={value}
        onChange={(event) => onChange(event.target.value as CaseTableFilter)}
        aria-label="Filter criminal cases"
      >
        {filterOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="hidden rounded-full bg-parchment-100 px-2 py-0.5 text-xs font-medium text-gray-600 lg:inline-flex">
        {selected.label}
      </span>
    </div>
  );
}

function CaseAccordion({ record }: { record: CriminalCaseRecord }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={`rounded-[10px] border bg-card ${accordionBorderClass[record.cases.status_of_case]}`}
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-parchment-100"
      >
        <div>
          <p className="text-sm font-semibold text-gray-800">
            {record.intake_record.control_no}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {record.cases.title_of_case}
          </p>
        </div>
        <StatusBadge status={record.cases.status_of_case} />
      </button>

      {open && (
        <div className="space-y-5 border-t border-line px-4 py-4">
          <section>
            <h4 className="text-sm font-semibold text-gray-800">
              Case Identification
            </h4>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <InfoTile
                label="Applicant Role"
                value={
                  record.intake_record.applicant_role === "Others"
                    ? record.intake_record.applicant_role_other
                    : record.intake_record.applicant_role
                }
              />
              <InfoTile label="Case No" value={record.cases.case_no} />
              <InfoTile label="Court" value={record.cases.court_body} />
              <InfoTile label="Title" value={record.cases.title_of_case} />
              <InfoTile
                label="Cause of Action"
                value={record.cases.cause_of_action}
              />
              <InfoTile
                label="Pending in Court"
                value={record.cases.pending_in_court ? "Yes" : "No"}
              />
            </div>
          </section>

          <section>
            <h4 className="text-sm font-semibold text-gray-800">
              Adverse Party
            </h4>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <InfoTile label="Role" value={record.adverse_party.role} />
              <InfoTile label="Name" value={record.adverse_party.name} />
              <InfoTile label="Address" value={record.adverse_party.address} />
            </div>
          </section>

          <section>
            <h4 className="text-sm font-semibold text-gray-800">
              Detention & Location
            </h4>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <InfoTile
                label="Urban/Rural"
                value={record.cases.location_type}
              />
              <InfoTile
                label="Incident Barangay"
                value={record.cases.incident_barangay ?? ""}
              />
              <InfoTile
                label="Incident City"
                value={record.cases.incident_city ?? "Panabo City"}
              />
              <InfoTile
                label="Incident Address"
                value={record.cases.incident_address ?? ""}
              />
              <InfoTile
                label="Date Confined"
                value={record.cases.date_of_confinement}
              />
              <InfoTile
                label="Place of Detention"
                value={record.cases.place_of_detention}
              />
            </div>
          </section>

          <section>
            <h4 className="text-sm font-semibold text-gray-800">
              Case Status
            </h4>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <InfoTile
                label="Last Action Taken"
                value={record.cases.last_action_taken}
              />
              <InfoTile
                label="Facts of Case"
                value={record.cases.facts_of_case}
              />
              {record.cases.status_of_case === "Terminated" && (
                <>
                  <InfoTile
                    label="Cause of Termination"
                    value={record.cases.cause_of_termination}
                  />
                  <InfoTile
                    label="Date of Termination"
                    value={record.cases.date_of_termination}
                  />
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function UpdateClientInfoModal({
  client,
  onClose,
  onSaved,
}: {
  client: ClientRecord;
  onClose: () => void;
  onSaved: (client: ClientRecord) => void;
}) {
  const [values, setValues] = useState<ClientFormValues>(() =>
    toClientFormValues(client),
  );
  const [saving, setSaving] = useState(false);

  const updateClient = (
    field: keyof ClientFormValues["client"],
    value: string,
  ) => {
    setValues((current) => ({
      ...current,
      client: {
        ...current.client,
        [field]: field === "age" ? Number(value) : value,
      },
    }));
  };
  const updateDetails = (
    field: keyof ClientFormValues["client_details"],
    value: string,
  ) => {
    setValues((current) => ({
      ...current,
      client_details: {
        ...current.client_details,
        [field]: field === "representative_age" ? Number(value) : value,
      },
    }));
  };

  const submit = async () => {
    setSaving(true);
    try {
      const updated = await updateClientRecord(client.client_id, values);
      onSaved(updated);
      toast.success("Client information updated");
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to update client",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalPortal>
    <div className="jurisguard-modal-overlay bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="jurisguard-modal-surface max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-line bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-line bg-parchment-100 px-5 py-4">
          <h3 className="text-base font-bold text-gray-800">
            Update Client Info
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-parchment-100"
          >
            Close
          </button>
        </div>
        <div className="max-h-[calc(90vh-140px)] overflow-y-auto p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              label="Full Name"
              value={values.client.name}
              onChange={(value) => updateClient("name", value)}
            />
            <TextField
              label="Age"
              type="number"
              value={values.client.age}
              onChange={(value) => updateClient("age", value)}
            />
            <TextField
              label="Gender"
              value={values.client.sex}
              onChange={(value) => updateClient("sex", value)}
            />
            <TextField
              label="Civil Status"
              value={values.client.civil_status}
              onChange={(value) => updateClient("civil_status", value)}
            />
            <TextField
              label="Contact"
              value={values.client_details.contact_no}
              onChange={(value) => updateDetails("contact_no", value)}
            />
            <TextField
              label="Email"
              value={values.client_details.email}
              onChange={(value) => updateDetails("email", value)}
            />
            <div className="md:col-span-2">
              <TextAreaField
                label="Address"
                value={values.client_details.address}
                onChange={(value) => updateDetails("address", value)}
              />
            </div>
            <div className="md:col-span-2">
              <TextAreaField
                label="Notes"
                value={values.client_classification.classification_notes}
                onChange={(value) =>
                  setValues((current) => ({
                    ...current,
                    client_classification: {
                      ...current.client_classification,
                      classification_notes: value,
                    },
                  }))
                }
              />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line bg-parchment-100 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line bg-card px-4 py-2 text-sm font-medium text-gray-600 hover:bg-parchment-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Client Info"}
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

function UpdateCaseModal({
  record,
  onClose,
  onSaved,
}: {
  record: CriminalCaseRecord;
  onClose: () => void;
  onSaved: (record: CriminalCaseRecord) => void;
}) {
  const [values, setValues] = useState<CaseFormValues>(() =>
    toCaseFormValues(record),
  );
  const [saving, setSaving] = useState(false);
  const updateCase = (
    field: keyof CaseFormValues["cases"],
    value: string | boolean,
  ) => {
    setValues((current) => ({
      ...current,
      cases: {
        ...current.cases,
        [field]: value,
      },
    }));
  };

  const submit = async () => {
    setSaving(true);
    try {
      const updated = await updateCaseRecord(record.case_id, {
        ...values,
        cases: {
          ...values.cases,
          case_status: values.cases.status_of_case,
          incident_city: values.cases.incident_city || "Panabo City",
        },
      });
      onSaved(updated);
      toast.success("Case updated");
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to update case",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalPortal>
    <div className="jurisguard-modal-overlay bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="jurisguard-modal-surface max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-line bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-line bg-parchment-100 px-5 py-4">
          <h3 className="text-base font-bold text-gray-800">Update Case</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-parchment-100"
          >
            Close
          </button>
        </div>
        <div className="max-h-[calc(90vh-140px)] overflow-y-auto p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              label="Case Title"
              value={values.cases.title_of_case}
              onChange={(value) => updateCase("title_of_case", value)}
            />
            <TextField
              label="Case Number"
              value={values.cases.case_no}
              onChange={(value) => updateCase("case_no", value)}
            />
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                Case Status
              </span>
              <select
                value={values.cases.status_of_case}
                onChange={(event) =>
                  updateCase("status_of_case", event.target.value as CaseStatus)
                }
                className="mt-1 h-10 w-full rounded-lg border border-parchment-300 bg-card px-3 text-sm text-gray-800 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
              >
                <option>Pending</option>
                <option>Ongoing</option>
                <option>Active</option>
                <option>Archived</option>
              </select>
            </label>
            <TextField
              label="Assigned PAO"
              value={values.cases.assigned_pao ?? ""}
              onChange={(value) => updateCase("assigned_pao", value)}
            />
            <TextField
              label="Filing Date"
              type="date"
              value={values.cases.filing_date ?? values.intake_record.form_date}
              onChange={(value) =>
                setValues((current) => ({
                  ...current,
                  intake_record: { ...current.intake_record, form_date: value },
                  cases: { ...current.cases, filing_date: value },
                }))
              }
            />
            <TextField
              label="Hearing Schedule"
              value={values.cases.hearing_schedule ?? ""}
              onChange={(value) => updateCase("hearing_schedule", value)}
            />
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                Barangay
              </span>
              <select
                value={values.cases.incident_barangay ?? ""}
                onChange={(event) =>
                  updateCase("incident_barangay", event.target.value)
                }
                className="mt-1 h-10 w-full rounded-lg border border-parchment-300 bg-card px-3 text-sm text-gray-800 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
              >
                <option value="">Select barangay</option>
                {panaboBarangays.map((barangay) => (
                  <option key={barangay}>{barangay}</option>
                ))}
              </select>
            </label>
            <TextField
              label="City"
              value={values.cases.incident_city ?? "Panabo City"}
              onChange={(value) => updateCase("incident_city", value)}
            />
            <TextField
              label="Latitude"
              value={values.cases.latitude ?? ""}
              onChange={(value) => updateCase("latitude", value)}
            />
            <TextField
              label="Longitude"
              value={values.cases.longitude ?? ""}
              onChange={(value) => updateCase("longitude", value)}
            />
            <div className="md:col-span-2">
              <TextAreaField
                label="Incident Address"
                value={values.cases.incident_address ?? ""}
                onChange={(value) => updateCase("incident_address", value)}
              />
            </div>
            <div className="md:col-span-2">
              <TextAreaField
                label="Remarks"
                value={values.cases.remarks ?? values.cases.last_action_taken}
                onChange={(value) =>
                  setValues((current) => ({
                    ...current,
                    cases: {
                      ...current.cases,
                      remarks: value,
                      last_action_taken: value,
                    },
                  }))
                }
              />
            </div>
            <div className="md:col-span-2">
              <TextAreaField
                label="Facts of Case"
                value={values.cases.facts_of_case}
                onChange={(value) => updateCase("facts_of_case", value)}
              />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line bg-parchment-100 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line bg-card px-4 py-2 text-sm font-medium text-gray-600 hover:bg-parchment-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Case"}
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

function TerminationModal({
  record,
  onClose,
  onTerminated,
}: {
  record: CriminalCaseRecord;
  onClose: () => void;
  onTerminated: (record: CriminalCaseRecord) => void;
}) {
  const [values, setValues] = useState<TerminationPayload>({
    termination_reason: "",
    resolution_type: "",
    date_terminated: new Date().toISOString().slice(0, 10),
    final_remarks: "",
    handled_by: "",
    supporting_document_path: "",
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!values.termination_reason.trim()) {
      toast.error("Termination reason is required");
      return;
    }
    setSaving(true);
    try {
      const updated = await terminateCaseRecord(record.case_id, values);
      onTerminated(updated);
      toast.success("Case terminated");
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to terminate case",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalPortal>
    <div className="jurisguard-modal-overlay bg-black/75 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="jurisguard-modal-surface w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-line bg-parchment-100 px-5 py-4">
          <h3 className="text-base font-bold text-gray-800">Terminate Case</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-parchment-100"
          >
            Close
          </button>
        </div>
        <div className="space-y-4 p-5">
          <TextAreaField
            label="Reason"
            value={values.termination_reason}
            onChange={(value) =>
              setValues((current) => ({
                ...current,
                termination_reason: value,
              }))
            }
          />
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
              Resolution Type
            </span>
            <select
              value={values.resolution_type}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  resolution_type: event.target.value,
                }))
              }
              className="mt-1 h-10 w-full rounded-lg border border-parchment-300 bg-card px-3 text-sm text-gray-800 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
            >
              <option value="">Select resolution</option>
              <option>Dismissed</option>
              <option>Resolved</option>
              <option>Withdrawn</option>
              <option>Referred</option>
              <option>Closed after assistance</option>
            </select>
          </label>
          <TextField
            label="Date Terminated"
            type="date"
            value={values.date_terminated}
            onChange={(value) =>
              setValues((current) => ({ ...current, date_terminated: value }))
            }
          />
          <TextAreaField
            label="Final Remarks"
            value={values.final_remarks}
            onChange={(value) =>
              setValues((current) => ({ ...current, final_remarks: value }))
            }
          />
          <TextField
            label="Handled By"
            value={values.handled_by}
            onChange={(value) =>
              setValues((current) => ({ ...current, handled_by: value }))
            }
          />
          <TextField
            label="Supporting Document Reference"
            value={values.supporting_document_path}
            onChange={(value) =>
              setValues((current) => ({
                ...current,
                supporting_document_path: value,
              }))
            }
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-line bg-parchment-100 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line bg-card px-4 py-2 text-sm font-medium text-gray-600 hover:bg-parchment-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {saving ? "Terminating..." : "Confirm Termination"}
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

function ClientRecordModal({
  client,
  cases,
  mode,
  onClose,
  onClientUpdated,
  onCaseUpdated,
  onCaseTerminated,
}: {
  client: ClientRecord | null;
  cases: CriminalCaseRecord[];
  mode: "view" | "update";
  onClose: () => void;
  onClientUpdated: (client: ClientRecord) => void;
  onCaseUpdated: (record: CriminalCaseRecord) => void;
  onCaseTerminated: (record: CriminalCaseRecord) => void;
}) {
  const navigate = useNavigate();
  const [clientUpdateOpen, setClientUpdateOpen] = useState(false);
  const [caseUpdateRecord, setCaseUpdateRecord] =
    useState<CriminalCaseRecord | null>(null);
  const [terminationRecord, setTerminationRecord] =
    useState<CriminalCaseRecord | null>(null);
  if (!client) return null;
  const terminatedCount = cases.filter(
    (record) =>
      record.cases.is_terminated ||
      record.cases.status_of_case === "Terminated",
  ).length;
  const activeCount = Math.max(cases.length - terminatedCount, 0);

  return (
    <ModalPortal>
    <div className="jurisguard-modal-overlay bg-black/70 backdrop-blur-sm transition-opacity duration-200" role="dialog" aria-modal="true">
      <div className="jurisguard-modal-surface max-h-[92vh] w-full max-w-5xl animate-[modalIn_200ms_ease-out] overflow-hidden rounded-2xl border border-line bg-card shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-parchment-100 px-6 py-5">
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">
              Criminal Cases
            </p>
            <h2 className="mt-1 text-xl font-bold text-gray-800">
              {mode === "view" ? "Criminal Case Record" : "Update Record"}
            </h2>
            <p className="mt-2 truncate text-sm text-gray-500">
              {client.client.name}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden gap-2 sm:flex">
              <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-600">
                {cases.length} case(s)
              </span>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800">
                {activeCount} active
              </span>
              <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-bold text-rose-800">
                {terminatedCount} closed
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-parchment-300 bg-card px-3 py-1.5 text-sm font-semibold text-gray-600 transition duration-200 hover:bg-parchment-200 hover:text-gray-800"
            >
              Close
            </button>
          </div>
        </div>

        <div className="max-h-[calc(92vh-90px)] overflow-y-auto bg-card px-6 py-5">
          <section className="rounded-[14px] border border-line bg-card p-5 shadow-sm ">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-gray-800">
                Person Information
              </h3>
              {mode === "update" && (
                <button
                  type="button"
                  onClick={() => setClientUpdateOpen(true)}
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700"
                >
                  Update Client Info
                </button>
              )}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-5">
              <InfoTile label="Full Name" value={client.client.name} />
              <InfoTile label="Gender" value={client.client.sex} />
              <InfoTile label="Age" value={client.client.age} />
              <InfoTile
                label="Contact"
                value={client.client_details.contact_no}
              />
              <InfoTile label="Address" value={client.client_details.address} />
              <InfoTile
                label="Status"
                value={
                  cases.some(
                    (record) =>
                      record.cases.is_terminated ||
                      record.cases.status_of_case === "Terminated",
                  )
                    ? "Has terminated case"
                    : "Active"
                }
              />
              <InfoTile
                label="Notes"
                value={client.client_classification.classification_notes}
              />
            </div>
          </section>

          <section className="mt-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-800">
                Criminal Cases
              </h3>
              <p className="text-sm text-gray-500">{cases.length} records</p>
            </div>

            <div className="space-y-3">
              {cases.map((record) => (
                <div
                  key={record.case_id}
                  className="rounded-[10px] border border-line bg-card"
                >
                  <CaseAccordion record={record} />
                  <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-parchment-100 px-4 py-3">
                    {mode === "view" && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            navigate(
                              `/criminal-cases/form-view/${record.case_id}`,
                            )
                          }
                          className="rounded-lg border border-brand-600 bg-card px-3 py-1.5 text-xs font-semibold text-brand-600 transition hover:bg-brand-50 hover:text-brand-700"
                        >
                          View Form
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            navigate(
                              `/criminal-cases/form-view/${record.case_id}?autoPrint=1`,
                            )
                          }
                          className="rounded-lg border border-brand-600 bg-card px-3 py-1.5 text-xs font-semibold text-brand-600 transition hover:bg-brand-50 hover:text-brand-700"
                        >
                          Print Form
                        </button>
                      </>
                    )}
                    {mode === "update" && (
                      <>
                        {!(
                          record.cases.is_terminated ||
                          record.cases.status_of_case === "Terminated"
                        ) && (
                          <>
                            <button
                              type="button"
                              onClick={() => setCaseUpdateRecord(record)}
                              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700"
                            >
                              Update Case
                            </button>
                            <button
                              type="button"
                              onClick={() => setTerminationRecord(record)}
                              className="rounded-lg border border-red-600 bg-card px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-600 hover:text-white"
                            >
                              Terminate
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
      {clientUpdateOpen && (
        <UpdateClientInfoModal
          client={client}
          onClose={() => setClientUpdateOpen(false)}
          onSaved={onClientUpdated}
        />
      )}
      {caseUpdateRecord && (
        <UpdateCaseModal
          record={caseUpdateRecord}
          onClose={() => setCaseUpdateRecord(null)}
          onSaved={onCaseUpdated}
        />
      )}
      {terminationRecord && (
        <TerminationModal
          record={terminationRecord}
          onClose={() => setTerminationRecord(null)}
          onTerminated={onCaseTerminated}
        />
      )}
    </div>
    </ModalPortal>
  );
}

export default function CriminalCasesPage() {
  const { user } = useAuth();
  const canCollaborateOnCases =
    user?.role === "admin" ||
    user?.role === "staff" ||
    user?.role === "legal_staff";
  const clients = useCriminalCasesStore((state) => state.clients);
  const cases = useCriminalCasesStore((state) => state.cases);
  const setClients = useCriminalCasesStore((state) => state.setClients);
  const setCases = useCriminalCasesStore((state) => state.setCases);
  const upsertClient = useCriminalCasesStore((state) => state.upsertClient);
  const upsertCase = useCriminalCasesStore((state) => state.upsertCase);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<CaseTableFilter>("all");
  const [showCaseModal, setShowCaseModal] = useState(false);
  const [showClientModal, setShowClientModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [activeClientId, setActiveClientId] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<"view" | "update">("view");

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    async function loadRecords() {
      try {
        const [clientRows, caseRows] = await Promise.all([
          listClientRecords(),
          listCaseRecords(),
        ]);
        if (!cancelled) {
          setClients(clientRows);
          setCases(caseRows);
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(
            error instanceof Error ? error.message : "Unable to load records",
          );
        }
      }
    }

    void loadRecords();

    return () => {
      cancelled = true;
    };
  }, [setCases, setClients, user]);

  const visibleClients = useMemo(
    () =>
      canCollaborateOnCases
        ? clients
        : clients.filter(
            (client) =>
              client.created_by_user_id === null ||
              client.created_by_user_id === user?.user_id,
          ),
    [canCollaborateOnCases, clients, user?.user_id],
  );
  const visibleCases = useMemo(
    () =>
      canCollaborateOnCases
        ? cases
        : cases.filter(
            (record) =>
              record.created_by_user_id === null ||
              record.created_by_user_id === user?.user_id,
          ),
    [canCollaborateOnCases, cases, user?.user_id],
  );
  const activeVisibleCases = useMemo(
    () =>
      visibleCases.filter(
        (record) =>
          !(
            record.cases.is_terminated ||
            record.cases.status_of_case === "Terminated"
          ),
      ),
    [visibleCases],
  );

  const rows = useMemo<CriminalCaseRow[]>(
    () =>
      activeVisibleCases.map((record) => {
        const client = visibleClients.find(
          (item) => item.client_id === record.client_id,
        );
        return {
          record,
          client,
          clientName: client?.client.name ?? "Unknown client",
        };
      }),
    [activeVisibleCases, visibleClients],
  );

  const filteredRows = useMemo(
    () => filterCriminalCaseRows(rows, { search, table_filter: filter }),
    [filter, rows, search],
  );

  const activeClient =
    visibleClients.find((client) => client.client_id === activeClientId) ??
    null;
  const activeCases = visibleCases.filter(
    (record) => record.client_id === activeClientId,
  );

  const openRecord = (record: CriminalCaseRecord, mode: "view" | "update") => {
    setActiveClientId(record.client_id);
    setActionMode(mode);
  };

  return (
    <MainLayout>
      <PageHeader
        eyebrow="Criminal Cases"
        title="Case Records Management"
        description="Manage PAO Panabo client profiles, active criminal case records, printable intake forms, and update workflows."
        actions={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => setShowCaseModal(true)}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
          >
            <PlusIcon />
            Add Case
          </button>
          <button
            type="button"
            onClick={() => setShowClientModal(true)}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-green-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-green-800"
          >
            <UserPlusIcon />
            Add Client
          </button>
          </div>
        }
      />

      <div className="rounded-xl border border-line bg-card p-5 shadow-sm">
        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <CaseFilterSelect value={filter} onChange={setFilter} />
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-600">Total:</span>
              <span className="rounded-lg bg-brand-600 px-2.5 py-1 text-base font-semibold leading-none text-white">
                {filteredRows.length}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowExportModal(true)}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white shadow-sm transition duration-200 hover:bg-brand-700"
            >
              Export CSV
            </button>
          </div>

          <input
            type="text"
            placeholder="Search case..."
            className="h-10 w-full rounded-lg border border-parchment-300 bg-card px-3 text-sm text-gray-800 outline-none transition placeholder:text-gray-600 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20 lg:w-1/4"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-sm">
            <thead className="sticky top-0 z-10 border-b border-parchment-300 bg-parchment-100 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-3 text-left font-semibold">
                  Control No.
                </th>
                <th className="px-3 py-3 text-left font-semibold">
                  Party Represented
                </th>
                <th className="px-3 py-3 text-left font-semibold">
                  Gender / Sex
                </th>
                <th className="px-3 py-3 text-left font-semibold">Title</th>
                <th className="px-5 py-3 text-left font-semibold">Status</th>
                <th className="px-3 py-3 text-left font-semibold">Person</th>
                <th className="px-3 py-3 text-right font-semibold"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filteredRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-5 py-10 text-center text-gray-800/50"
                  >
                    No criminal cases found.
                  </td>
                </tr>
              ) : (
                filteredRows.map(({ record, client, clientName }) => (
                  <tr
                    key={record.case_id}
                    className="odd:bg-card even:bg-parchment-100 transition duration-200 hover:bg-parchment-100"
                  >
                    <td className="px-3 py-4 text-gray-800">
                      {record.intake_record.control_no}
                    </td>
                    <td className="px-3 py-4 text-gray-600">
                      {record.intake_record.party_represented}
                    </td>
                    <td className="px-3 py-4 text-gray-600">
                      {client?.client.sex ?? "-"}
                    </td>
                    <td className="px-3 py-4 text-gray-600">
                      {record.cases.title_of_case}
                    </td>
                    <td className="px-5 py-4">
                      <StatusBadge status={record.cases.status_of_case} />
                    </td>
                    <td className="px-3 py-4 text-gray-600">{clientName}</td>
                    <td className="px-3 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openRecord(record, "view")}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-600 bg-card px-3 py-1.5 text-xs font-semibold text-brand-600 transition duration-200 hover:bg-brand-50 hover:text-brand-700"
                        >
                          <EyeIcon />
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => openRecord(record, "update")}
                          className="rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-semibold text-gray-600 transition duration-200 hover:bg-parchment-100"
                        >
                          Update
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AddClientModal
        isOpen={showClientModal}
        onClose={() => setShowClientModal(false)}
      />
      <AddCaseModal
        isOpen={showCaseModal}
        onClose={() => setShowCaseModal(false)}
      />
      <ExportCsvModal
        isOpen={showExportModal}
        rows={filteredRows}
        onClose={() => setShowExportModal(false)}
      />
      <ClientRecordModal
        mode={actionMode}
        client={activeClient}
        cases={activeCases}
        onClose={() => setActiveClientId(null)}
        onClientUpdated={upsertClient}
        onCaseUpdated={upsertCase}
        onCaseTerminated={upsertCase}
      />
    </MainLayout>
  );
}
