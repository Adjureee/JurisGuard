import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import MainLayout from "../layouts/MainLayout";
import DateFilterSelect from "../components/DateFilterSelect";
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
  attachClientToCase,
  listCaseRecords,
  listClientRecords,
  terminateCaseRecord,
  updateCaseRecord,
  updateClientRecord,
  type TerminationPayload,
} from "../services/recordService";
import type {
  CaseParticipant,
  CaseStatus,
  CaseType,
  ClientClassification,
  ClientRecord,
  CriminalCaseRecord,
} from "../types";
import type {
  CaseFormValues,
  ClientFormValues,
} from "../features/criminalCases/schemas";
import {
  matchesDateFilter,
  type DateFilterValue,
} from "../utils/dateFilters";

const accordionBorderClass: Record<CaseStatus, string> = {
  Pending: "border-amber-200",
  Terminated: "border-red-200",
};

const filterOptions: Array<{ value: CaseTableFilter; label: string }> = [
  { value: "all", label: "All Locations" },
  { value: "urban", label: "Urban" },
  { value: "rural", label: "Rural" },
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

const religionOptions = [
  "Roman Catholic",
  "Christian",
  "Iglesia ni Cristo",
  "Islam",
  "Buddhist",
  "Indigenous Belief",
  "None",
];

const urbanBarangays = [
  "Cagangohan",
  "Datu Abdul Dadia",
  "Gredu (Poblacion)",
  "J.P. Laurel",
  "New Pandan (Poblacion)",
  "New Visayas",
  "Quezon",
  "San Francisco (Poblacion)",
  "San Vicente",
  "Salvacion",
  "Santo Nino (Poblacion)",
];

const ruralBarangays = [
  "A. O. Floirendo",
  "Buenavista",
  "Cacao",
  "Consolacion",
  "Dapco",
  "Kasilak",
  "Katipunan",
  "Katualan",
  "Kauswagan",
  "Kiotoy",
  "Little Panay",
  "Lower Panaga (Roxas)",
  "Mabunao",
  "Maduao",
  "Malativas",
  "Manay",
  "Nanyo",
  "New Malaga (Dalisay)",
  "New Malitbog",
  "San Nicolas",
  "San Pedro",
  "San Roque",
  "Santa Cruz",
  "Sindaton",
  "Southern Davao",
  "Tagpore",
  "Tibungol",
  "Upper Licanan",
  "Waterfall",
];

const panaboBarangays = [...urbanBarangays, ...ruralBarangays];

const courtBodyOptions = [
  "RTC Branch 4",
  "RTC Branch 34",
  "Family Court - Panabo District",
  "MTCC - Panabo District",
];

const courtFilterOptions = ["All Courts", ...courtBodyOptions];

const classificationOptions = [
  ["flag_drugs", "Drug-related"],
  ["flag_foreign_national", "Foreign National"],
  ["flag_vawc_victim", "VAWC Victim"],
  ["flag_refugee_evacuee", "Refugee / Evacuee"],
  ["flag_law_enforcer", "Law Enforcer"],
  ["flag_tenant_agrarian", "Tenant in Agrarian Case"],
  ["flag_ofw_land_based", "OFW Land-Based"],
  ["flag_ofw_sea_based", "OFW Sea-Based"],
  ["flag_arrested_terrorism", "Arrested for Terrorism"],
  ["flag_indigenous_people", "Indigenous People"],
  ["flag_pwd", "PWD"],
  ["flag_former_rebel_fve", "Former Rebel / FVE"],
  ["flag_torture_victim", "Victim of Torture"],
  ["flag_trafficking_victim", "Victim of Trafficking"],
  ["flag_voluntary_rehab_petitioner", "Petitioner for Voluntary Rehab"],
] as const;

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
    <div className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
        {label}
      </p>
      <p className="mt-1 text-base font-medium text-[#111827]">
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
      detained: Boolean(record.cases.detained),
      date_of_confinement: record.cases.date_of_confinement ?? "",
      place_of_detention: record.cases.place_of_detention ?? "",
      location_type: record.cases.location_type ?? "",
      cause_of_action: record.cases.cause_of_action ?? "",
      facts_of_case: record.cases.facts_of_case ?? "",
      assigned_pao: record.cases.assigned_pao ?? "",
      filing_date: record.cases.filing_date ?? "",
      hearing_schedule: record.cases.hearing_schedule ?? "",
      remarks: record.cases.remarks ?? "",
    },
  };
}

function caseParticipants(
  record: CriminalCaseRecord,
  fallbackClient?: ClientRecord,
): CaseParticipant[] {
  if (record.participants?.length) return record.participants;
  return fallbackClient
    ? [
        {
          case_client_id: "",
          client_id: fallbackClient.client_id,
          name: fallbackClient.client.name,
          sex: fallbackClient.client.sex,
          age: fallbackClient.client.age,
          party_represented: record.intake_record.party_represented,
          applicant_role: record.intake_record.applicant_role,
          applicant_role_other: record.intake_record.applicant_role_other,
          address: fallbackClient.client_details.address,
          contact_no: fallbackClient.client_details.contact_no,
          classification: fallbackClient.client_classification,
        },
      ]
    : [];
}

function participantNames(record: CriminalCaseRecord, fallbackClient?: ClientRecord) {
  return caseParticipants(record, fallbackClient)
    .map((participant) => participant.name)
    .filter(Boolean);
}

function participantSexes(record: CriminalCaseRecord, fallbackClient?: ClientRecord) {
  return caseParticipants(record, fallbackClient)
    .map((participant) => participant.sex)
    .filter(Boolean);
}

function participantClassificationLabels(participant: CaseParticipant) {
  return classificationOptions
    .filter(([key]) => Boolean(participant.classification?.[key as keyof ClientClassification]))
    .map(([, label]) => label);
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  list,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  list?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
        {label}
      </span>
      <input
        type={type}
        list={list}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-10 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm text-[#2B3642] outline-none transition focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
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
      <span className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
        {label}
      </span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
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
  return (
    <div className="flex h-9 items-center gap-2 rounded-md border border-[#D1D5DB] bg-white px-3 text-[#2B3642]">
      <SlidersIcon />
      <select
        className="h-8 min-w-32 bg-white text-sm font-medium text-[#2B3642] outline-none"
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
    </div>
  );
}

function CaseAccordion({
  record,
  fallbackClient,
  showInterviewSheets = false,
  onInterviewSheet,
}: {
  record: CriminalCaseRecord;
  fallbackClient?: ClientRecord;
  showInterviewSheets?: boolean;
  onInterviewSheet?: (
    record: CriminalCaseRecord,
    participant: CaseParticipant,
  ) => void;
}) {
  const participants = caseParticipants(record, fallbackClient);
  const isMultiParty = participants.length > 1;
  const [open, setOpen] = useState(isMultiParty);

  return (
    <div
      className={`overflow-hidden rounded-xl border bg-white shadow-sm ${accordionBorderClass[record.cases.status_of_case]}`}
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-[#F9FAFB]"
      >
        <div>
          <p className="text-base font-bold text-[#111827]">
            {record.intake_record.control_no}
          </p>
          <p className="mt-1 text-sm text-[#4B5563]">
            {record.cases.title_of_case}
          </p>
        </div>
        <StatusBadge status={record.cases.status_of_case} />
      </button>

      {open && (
        <div className="space-y-5 border-t border-[#E5E7EB] bg-[#F9FAFB] px-5 py-5">
          <section className="rounded-xl border border-[#E5E7EB] bg-white p-4">
            <h4 className="text-base font-semibold text-[#111827]">
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

          {isMultiParty && (
            <section className="rounded-xl border border-[#E5E7EB] bg-white p-4">
              <h4 className="text-base font-semibold text-[#111827]">
                Participants
              </h4>
              <p className="mt-1 text-sm text-[#6B7280]">
                Shared case, individual client information.
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {participants.map((participant) => (
                  <div
                    key={participant.case_client_id || participant.client_id}
                    className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4"
                  >
                    <p className="text-lg font-bold text-[#111827]">
                      {participant.name}
                    </p>
                    <div className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
                          Gender / Sex
                        </p>
                        <p className="mt-1 text-sm font-medium text-[#111827]">
                          {participant.sex || "-"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
                          Age
                        </p>
                        <p className="mt-1 text-sm font-medium text-[#111827]">
                          {participant.age || "-"}
                        </p>
                      </div>
                      <div className="sm:col-span-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
                          Address
                        </p>
                        <p className="mt-1 break-words text-sm font-medium text-[#111827]">
                          {participant.address || "-"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
                          Contact Number
                        </p>
                        <p className="mt-1 text-sm font-medium text-[#111827]">
                          {participant.contact_no || "-"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
                          Applicant Case Involvement
                        </p>
                        <p className="mt-1 text-sm font-medium text-[#111827]">
                          {participant.applicant_role === "Others"
                            ? participant.applicant_role_other
                            : participant.applicant_role || "Role not set"}
                        </p>
                      </div>
                      <div className="sm:col-span-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
                          Party Represented
                        </p>
                        <p className="mt-1 text-sm font-medium text-[#111827]">
                          {participant.party_represented || "Not set"}
                        </p>
                      </div>
                      {participantClassificationLabels(participant).length > 0 && (
                        <div className="sm:col-span-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
                            Applicant Classification
                          </p>
                          <p className="mt-1 break-words text-sm font-medium text-[#111827]">
                            {participantClassificationLabels(participant).join("; ")}
                          </p>
                        </div>
                      )}
                    </div>
                    {showInterviewSheets && onInterviewSheet && (
                      <button
                        type="button"
                        onClick={() => onInterviewSheet(record, participant)}
                        className="mt-4 inline-flex w-full items-center justify-center rounded-md border border-[#704389] bg-white px-3 py-2 text-xs font-semibold text-[#704389] transition hover:bg-[#704389] hover:text-white"
                      >
                        INTERVIEW SHEET - {participant.name}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-xl border border-[#E5E7EB] bg-white p-4">
            <h4 className="text-base font-semibold text-[#111827]">
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

          <section className="rounded-xl border border-[#E5E7EB] bg-white p-4">
            <h4 className="text-base font-semibold text-[#111827]">
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
  const updateClassification = (
    field: keyof ClientFormValues["client_classification"],
    value: boolean | string,
  ) => {
    setValues((current) => ({
      ...current,
      client_classification: {
        ...current.client_classification,
        [field]: value,
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
      <div className="jurisguard-modal-surface max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-[#CBD5E1] bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[#E5E7EB] bg-[#F8FAFC] px-5 py-4">
          <h3 className="text-base font-bold text-[#2B3642]">
            Update Client Info
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm font-semibold text-[#4B5563] hover:bg-[#F8FAFC]"
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
              label="Religion"
              value={values.client.religion}
              onChange={(value) => updateClient("religion", value)}
              list="client-update-religion-options"
            />
            <datalist id="client-update-religion-options">
              {religionOptions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
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
              <h4 className="mb-3 text-sm font-semibold text-[#2B3642]">
                Applicant's Classification
              </h4>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {classificationOptions.map(([name, label]) => (
                  <label
                    key={name}
                    className="flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563]"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(values.client_classification[name])}
                      onChange={(event) =>
                        updateClassification(name, event.target.checked)
                      }
                      className="h-4 w-4 rounded border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <div className="md:col-span-2">
              <TextAreaField
                label="Notes"
                value={values.client_classification.classification_notes}
                onChange={(value) =>
                  updateClassification("classification_notes", value)
                }
              />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#E5E7EB] bg-[#F8FAFC] px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-medium text-[#4B5563] hover:bg-[#F8FAFC]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5F3675] disabled:opacity-60"
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
  const filteredBarangays =
    values.cases.location_type === "Urban"
      ? urbanBarangays
      : values.cases.location_type === "Rural"
        ? ruralBarangays
        : panaboBarangays;
  const caseDetained = Boolean(values.cases.detained);
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
  const updateLocationType = (value: "Urban" | "Rural" | "") => {
    const nextBarangays =
      value === "Urban" ? urbanBarangays : value === "Rural" ? ruralBarangays : panaboBarangays;
    setValues((current) => ({
      ...current,
      cases: {
        ...current.cases,
        location_type: value,
        incident_barangay: nextBarangays.includes(current.cases.incident_barangay ?? "")
          ? current.cases.incident_barangay
          : "",
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
          pending_in_court: values.cases.status_of_case === "Pending",
          incident_city: values.cases.incident_city || "Panabo City",
          detained: caseDetained,
          date_of_confinement: caseDetained ? values.cases.date_of_confinement : "",
          place_of_detention: caseDetained ? values.cases.place_of_detention : "",
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
      <div className="jurisguard-modal-surface max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-[#CBD5E1] bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[#E5E7EB] bg-[#F8FAFC] px-5 py-4">
          <h3 className="text-base font-bold text-[#2B3642]">Update Case</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm font-semibold text-[#4B5563] hover:bg-[#F8FAFC]"
          >
            Close
          </button>
        </div>
        <div className="max-h-[calc(90vh-140px)] overflow-y-auto p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              label="Case Number"
              value={values.cases.case_no}
              onChange={(value) => updateCase("case_no", value)}
            />
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
                Court / Body
              </span>
              <select
                value={values.cases.court_body}
                onChange={(event) => updateCase("court_body", event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm text-[#2B3642] outline-none focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
              >
                <option value="">Select court/body</option>
                {courtBodyOptions.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
                Case Status
              </span>
              <select
                value={values.cases.status_of_case}
                onChange={(event) =>
                  updateCase("status_of_case", event.target.value as CaseStatus)
                }
                className="mt-1 h-10 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm text-[#2B3642] outline-none focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
              >
                <option>Pending</option>
                <option>Terminated</option>
              </select>
            </label>
            <label className="flex h-10 items-center gap-3 self-end rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 text-sm font-medium text-[#4B5563]">
              <input
                type="checkbox"
                checked={caseDetained}
                onChange={(event) => updateCase("detained", event.target.checked)}
                className="h-4 w-4 rounded border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
              />
              Detained
            </label>
            {caseDetained && (
              <>
                <TextField
                  label="Date of Detention"
                  type="date"
                  value={values.cases.date_of_confinement}
                  onChange={(value) => updateCase("date_of_confinement", value)}
                />
                <TextField
                  label="Place of Detention"
                  value={values.cases.place_of_detention}
                  onChange={(value) => updateCase("place_of_detention", value)}
                />
              </>
            )}
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
              <span className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
                Location Type
              </span>
              <select
                value={values.cases.location_type ?? ""}
                onChange={(event) =>
                  updateLocationType(event.target.value as "Urban" | "Rural" | "")
                }
                className="mt-1 h-10 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm text-[#2B3642] outline-none focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
              >
                <option value="">Select</option>
                <option>Urban</option>
                <option>Rural</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
                Barangay
              </span>
              <select
                value={values.cases.incident_barangay ?? ""}
                onChange={(event) =>
                  updateCase("incident_barangay", event.target.value)
                }
                className="mt-1 h-10 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm text-[#2B3642] outline-none focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
              >
                <option value="">Select barangay</option>
                {filteredBarangays.map((barangay) => (
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
            <div className="md:col-span-2">
              <TextAreaField
                label="Cause of Action"
                value={values.cases.cause_of_action}
                onChange={(value) => updateCase("cause_of_action", value)}
              />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#E5E7EB] bg-[#F8FAFC] px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-medium text-[#4B5563] hover:bg-[#F8FAFC]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5F3675] disabled:opacity-60"
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
      <div className="jurisguard-modal-surface w-full max-w-2xl overflow-hidden rounded-2xl border border-[#CBD5E1] bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[#E5E7EB] bg-[#F8FAFC] px-5 py-4">
          <h3 className="text-base font-bold text-[#2B3642]">Terminate Case</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm font-semibold text-[#4B5563] hover:bg-[#F8FAFC]"
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
            <span className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
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
              className="mt-1 h-10 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm text-[#2B3642] outline-none focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
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
        </div>
        <div className="flex justify-end gap-2 border-t border-[#E5E7EB] bg-[#F8FAFC] px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-medium text-[#4B5563] hover:bg-[#F8FAFC]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="rounded-md bg-[#DC2626] px-4 py-2 text-sm font-semibold text-white hover:bg-[#B91C1C] disabled:opacity-60"
          >
            {saving ? "Terminating..." : "Confirm Termination"}
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

function AttachClientModal({
  record,
  clients,
  onClose,
  onAttached,
  onCreateClient,
}: {
  record: CriminalCaseRecord;
  clients: ClientRecord[];
  onClose: () => void;
  onAttached: (record: CriminalCaseRecord) => void;
  onCreateClient: () => void;
}) {
  const attachedIds = new Set(record.participants?.map((participant) => participant.client_id) ?? [record.client_id]);
  const availableClients = clients.filter((client) => !attachedIds.has(client.client_id));
  const [clientId, setClientId] = useState(availableClients[0]?.client_id ?? "");
  const [applicantRole, setApplicantRole] = useState("Accused");
  const [applicantRoleOther, setApplicantRoleOther] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!clientId) {
      toast.error("Select a client to attach");
      return;
    }
    setSaving(true);
    try {
      const updated = await attachClientToCase(record.case_id, {
        client_id: clientId,
        applicant_role: applicantRole,
        applicant_role_other: applicantRole === "Others" ? applicantRoleOther : "",
        party_represented: applicantRole === "Others" ? applicantRoleOther : applicantRole,
      });
      onAttached(updated);
      toast.success("Client attached to case");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to attach client");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalPortal>
      <div className="jurisguard-modal-overlay bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true">
        <div className="jurisguard-modal-surface w-full max-w-xl overflow-hidden rounded-2xl border border-[#CBD5E1] bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-[#E5E7EB] bg-[#F8FAFC] px-5 py-4">
            <h3 className="text-base font-bold text-[#2B3642]">Attach Client / Party</h3>
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm font-semibold text-[#4B5563] hover:bg-[#F8FAFC]">
              Close
            </button>
          </div>
          <div className="space-y-4 p-5">
            {availableClients.length === 0 ? (
              <div className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-4 text-sm text-[#4B5563]">
                No unattached clients are available.
              </div>
            ) : (
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
                  Existing Client
                </span>
                <select
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  className="mt-1 h-10 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm text-[#2B3642] outline-none focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
                >
                  {availableClients.map((client) => (
                    <option key={client.client_id} value={client.client_id}>
                      {client.client.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
                Applicant Case Involvement
              </span>
              <select
                value={applicantRole}
                onChange={(event) => setApplicantRole(event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm text-[#2B3642] outline-none focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
              >
                {["Plaintiff", "Defendant", "Oppositor", "Petitioner", "Respondent", "Complainant", "Accused", "Others"].map((role) => (
                  <option key={role}>{role}</option>
                ))}
              </select>
            </label>
            {applicantRole === "Others" && (
              <TextField
                label="Specify Role"
                value={applicantRoleOther}
                onChange={setApplicantRoleOther}
              />
            )}
            <button
              type="button"
              onClick={() => {
                onClose();
                onCreateClient();
              }}
              className="rounded-md border border-[#15803D] bg-white px-3 py-2 text-sm font-semibold text-[#166534] hover:bg-[#ECFDF5]"
            >
              Create New Client First
            </button>
          </div>
          <div className="flex justify-end gap-2 border-t border-[#E5E7EB] bg-[#F8FAFC] px-5 py-4">
            <button type="button" onClick={onClose} className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-medium text-[#4B5563] hover:bg-[#F8FAFC]">
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={saving || !clientId}
              className="rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5F3675] disabled:opacity-60"
            >
              {saving ? "Attaching..." : "Attach Client"}
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
  clients,
  mode,
  caseType,
  onClose,
  onClientUpdated,
  onCaseUpdated,
  onCaseTerminated,
  onCreateClient,
}: {
  client: ClientRecord | null;
  cases: CriminalCaseRecord[];
  clients: ClientRecord[];
  mode: "view" | "update";
  caseType: CaseType;
  onClose: () => void;
  onClientUpdated: (client: ClientRecord) => void;
  onCaseUpdated: (record: CriminalCaseRecord) => void;
  onCaseTerminated: (record: CriminalCaseRecord) => void;
  onCreateClient: () => void;
}) {
  const navigate = useNavigate();
  const [clientUpdateOpen, setClientUpdateOpen] = useState(false);
  const [caseUpdateRecord, setCaseUpdateRecord] =
    useState<CriminalCaseRecord | null>(null);
  const [terminationRecord, setTerminationRecord] =
    useState<CriminalCaseRecord | null>(null);
  const [attachRecord, setAttachRecord] =
    useState<CriminalCaseRecord | null>(null);
  if (!client) return null;
  const terminatedCount = cases.filter(
    (record) =>
      record.cases.is_terminated ||
      record.cases.status_of_case === "Terminated",
  ).length;
  const activeCount = Math.max(cases.length - terminatedCount, 0);
  const titleNames = Array.from(
    new Set(
      cases
        .flatMap((record) => participantNames(record, client))
        .filter(Boolean),
    ),
  );
  const showCombinedParticipantTitle = mode === "view" && cases.length === 1;
  const openInterviewSheet = (
    record: CriminalCaseRecord,
    participant: CaseParticipant,
  ) => {
    const params = new URLSearchParams({ clientId: participant.client_id });
    const formBasePath =
      caseType === "Civil" ? "/civil-cases" : "/criminal-cases";
    navigate(`${formBasePath}/form-view/${record.case_id}?${params.toString()}`);
  };

  return (
    <ModalPortal>
    <div className="jurisguard-modal-overlay bg-black/70 backdrop-blur-sm transition-opacity duration-200" role="dialog" aria-modal="true">
      <div className="jurisguard-modal-surface max-h-[92vh] w-full max-w-5xl animate-[modalIn_200ms_ease-out] overflow-hidden rounded-2xl border border-[#CBD5E1] bg-[#F9FAFB] shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E5E7EB] bg-white px-6 py-5">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#704389]">
              {caseType} Cases
            </p>
            <h2 className="mt-1 break-words text-2xl font-bold text-[#111827]">
              {mode === "view"
                ? showCombinedParticipantTitle && titleNames.length
                  ? titleNames.map((name) => (
                      <span key={name} className="block">
                        {name}
                      </span>
                    ))
                  : client.client.name
                : "Update Record"}
            </h2>
            {mode !== "view" && (
            <p className="mt-2 break-words text-sm text-[#6B7280]">
                {client.client.name}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden gap-2 sm:flex">
              <span className="rounded-full bg-[#F7F0FA] px-3 py-1 text-xs font-bold text-[#704389]">
                {cases.length} case(s)
              </span>
              <span className="rounded-full bg-[#ECFDF5] px-3 py-1 text-xs font-bold text-[#065F46]">
                {activeCount} active
              </span>
              <span className="rounded-full bg-[#FFF1F2] px-3 py-1 text-xs font-bold text-[#9F1239]">
                {terminatedCount} closed
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#D1D5DB] bg-white px-3 py-1.5 text-sm font-semibold text-[#4B5563] transition duration-200 hover:bg-[#F3F4F6] hover:text-[#2B3642]"
            >
              Close
            </button>
          </div>
        </div>

        <div className="max-h-[calc(92vh-90px)] overflow-y-auto bg-[#F9FAFB] px-6 py-5">
          <section className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-[#111827]">
                  Client Information
                </h3>
                <p className="mt-1 text-sm text-[#6B7280]">
                  Personal information for the selected client record.
                </p>
              </div>
              {mode === "view" && cases.length > 1 && (
                <p className="text-sm font-medium text-[#6B7280]">
                  {cases.length} shared case records
                </p>
              )}
              {mode === "update" && (
                <button
                  type="button"
                  onClick={() => setClientUpdateOpen(true)}
                  className="rounded-md bg-[#704389] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#5F3675]"
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
                    : "Pending"
                }
              />
              <InfoTile
                label="Notes"
                value={client.client_classification.classification_notes}
              />
            </div>
          </section>

          <section className="mt-5 rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[#111827]">
                {caseType} Cases
              </h3>
              <p className="text-sm text-[#6B7280]">{cases.length} records</p>
            </div>

            <div className="space-y-3">
              {cases.map((record) => (
                <div
                  key={record.case_id}
                  className="rounded-[10px] border border-[#E5E7EB] bg-white"
                >
                  <CaseAccordion
                    record={record}
                    fallbackClient={client}
                    showInterviewSheets={mode === "view"}
                    onInterviewSheet={openInterviewSheet}
                  />
                  <div className="flex flex-wrap justify-end gap-2 border-t border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3">
                    {mode === "view" &&
                      caseParticipants(record, client).length <= 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            const [participant] = caseParticipants(record, client);
                            if (participant) {
                              openInterviewSheet(record, participant);
                              return;
                            }
                            const formBasePath =
                              caseType === "Civil"
                                ? "/civil-cases"
                                : "/criminal-cases";
                            navigate(
                              `${formBasePath}/form-view/${record.case_id}`,
                            );
                          }}
                          className="rounded-md border border-[#704389] bg-white px-3 py-1.5 text-xs font-semibold text-[#704389] transition hover:bg-[#704389] hover:text-white"
                        >
                          INTERVIEW SHEET
                        </button>
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
                              className="rounded-md bg-[#704389] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#5F3675]"
                            >
                              Update Case
                            </button>
                            <button
                              type="button"
                              onClick={() => setAttachRecord(record)}
                              className="rounded-md border border-[#704389] bg-white px-3 py-1.5 text-xs font-semibold text-[#704389] transition hover:bg-[#704389] hover:text-white"
                            >
                              Attach Client
                            </button>
                            <button
                              type="button"
                              onClick={() => setTerminationRecord(record)}
                              className="rounded-md border border-[#DC2626] bg-white px-3 py-1.5 text-xs font-semibold text-[#B91C1C] transition hover:bg-[#DC2626] hover:text-white"
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
      {attachRecord && (
        <AttachClientModal
          record={attachRecord}
          clients={clients}
          onClose={() => setAttachRecord(null)}
          onAttached={onCaseUpdated}
          onCreateClient={onCreateClient}
        />
      )}
    </div>
    </ModalPortal>
  );
}

interface CasesPageProps {
  caseType?: CaseType;
  pageEyebrow?: string;
  pageTitle?: string;
  pageDescription?: string;
}

export default function CriminalCasesPage({
  caseType = "Criminal",
  pageEyebrow,
  pageTitle,
  pageDescription,
}: CasesPageProps = {}) {
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
  const [courtFilter, setCourtFilter] = useState("All Courts");
  const [dateFilter, setDateFilter] = useState<DateFilterValue>("all");
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
          listCaseRecords(caseType),
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
  }, [caseType, setCases, setClients, user]);

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
    () => {
      const typedCases = cases.filter(
        (record) => (record.case_type ?? "Criminal") === caseType,
      );
      return canCollaborateOnCases
        ? typedCases
        : typedCases.filter(
            (record) =>
              record.created_by_user_id === null ||
              record.created_by_user_id === user?.user_id,
          );
    },
    [canCollaborateOnCases, caseType, cases, user?.user_id],
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
  const tableCases = activeVisibleCases;

  const rows = useMemo<CriminalCaseRow[]>(
    () =>
      tableCases.map((record) => {
        const client = visibleClients.find(
          (item) => item.client_id === record.client_id,
        );
        const names = participantNames(record, client);
        return {
          record,
          client,
          clientName: names.join(" ") || client?.client.name || "Unknown client",
        };
      }),
    [tableCases, visibleClients],
  );

  const filteredRows = useMemo(() => {
    const baseRows = filterCriminalCaseRows(rows, {
      search,
      table_filter: filter,
    });
    return baseRows.filter(({ record }) => {
      const courtMatches =
        courtFilter === "All Courts" || record.cases.court_body === courtFilter;
      if (!courtMatches) return false;
      return matchesDateFilter(
        record.intake_record.form_date ||
          record.cases.filing_date ||
          record.last_updated,
        dateFilter,
      );
    });
  }, [courtFilter, dateFilter, filter, rows, search]);

  const activeClient =
    visibleClients.find((client) => client.client_id === activeClientId) ??
    null;
  const activeCases = visibleCases.filter(
    (record) =>
      record.client_id === activeClientId ||
      record.participants?.some(
        (participant) => participant.client_id === activeClientId,
      ),
  );

  const openRecord = (record: CriminalCaseRecord, mode: "view" | "update") => {
    setActiveClientId(record.client_id);
    setActionMode(mode);
  };

 return (
    <MainLayout>
      {/* 1. Global Height Wrapper: Locks the page to the viewport height */}
      <div className="flex h-[calc(100vh-110px)] max-w-full flex-col gap-4 overflow-hidden">
        
        {/* 2. Header Area: shrink-0 keeps it from compressing */}
        <div className="shrink-0">
          <PageHeader
            eyebrow={pageEyebrow ?? `${caseType} Cases`}
            title={pageTitle ?? `${caseType} Case Records Management`}
            description={
              pageDescription ??
              `Manage PAO Panabo client profiles, active ${caseType.toLowerCase()} case records, printable intake forms, and update workflows.`
            }
            compact
            actions={
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={() => setShowCaseModal(true)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#704389] px-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#5F3675]"
                >
                  <PlusIcon />
                  Add {caseType} Case
                </button>
                <button
                  type="button"
                  onClick={() => setShowClientModal(true)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#15803D] px-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#166534]"
                >
                  <UserPlusIcon />
                  Add Client
                </button>
              </div>
            }
          />
        </div>

        {/* 3. Main Content Card: flex-1 min-h-0 allows it to absorb remaining screen space */}
        <div className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col rounded-xl border border-[#CBD5E1] bg-white p-4 shadow-sm">
          
          {/* 4. Filters Area: shrink-0 preserves its height */}
          <div className="mb-3 grid min-w-0 shrink-0 gap-2 md:grid-cols-2 xl:grid-cols-[minmax(220px,360px)_170px_165px_165px_auto_auto] xl:items-end">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
                Search
              </span>
              <input
                type="text"
                placeholder="Search case..."
                className="mt-1 h-9 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm text-[#2B3642] outline-none transition placeholder:text-[#4B5563] focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <DateFilterSelect value={dateFilter} onChange={setDateFilter} />
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
                Court / Body
              </span>
              <select
                value={courtFilter}
                onChange={(event) => setCourtFilter(event.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm text-[#2B3642] outline-none transition focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
              >
                {courtFilterOptions.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
            <div className="pt-5 xl:pt-4">
              <CaseFilterSelect value={filter} onChange={setFilter} />
            </div>
            <div className="flex h-9 items-center gap-2 rounded-md border border-[#D1D5DB] bg-[#F8FAFC] px-3">
              <span className="font-semibold text-[#4B5563]">Total:</span>
              <span className="rounded-md bg-[#704389] px-2.5 py-1 text-base font-semibold leading-none text-white">
                {filteredRows.length}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowExportModal(true)}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-[#704389] px-3.5 text-sm font-semibold text-white shadow-sm transition duration-200 hover:bg-[#5F3675]"
            >
              Export Excel
            </button>
          </div>

          {/* 5. Scrollable Table Container: Flex-1 fills the rest of the card perfectly */}
          <div className="relative min-h-0 max-w-full flex-1 overflow-y-auto overflow-x-auto rounded-lg border border-[#CBD5E1]">
            <table className="w-full min-w-[1040px] text-sm">
              <thead className="sticky top-0 z-10 border-b border-[#D1D5DB] bg-[#E5E7EB] text-xs uppercase tracking-wide text-[#374151]">
                <tr>
                  <th className="px-3 py-3 text-left font-semibold">Control No.</th>
                  <th className="px-3 py-3 text-left font-semibold">Party Represented</th>
                  <th className="px-3 py-3 text-left font-semibold">Gender / Sex</th>
                  <th className="px-3 py-3 text-left font-semibold">Title</th>
                  <th className="px-3 py-3 text-left font-semibold">Case No.</th>
                  <th className="px-3 py-3 text-left font-semibold">Court / Body</th>
                  <th className="px-3 py-3 text-right font-semibold"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-5 py-10 text-center text-[#2B3642]/50"
                    >
                      No criminal cases found.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map(({ record, client }) => {
                    const names = participantNames(record, client);
                    const sexes = participantSexes(record, client);
                    return (
                    <tr
                      key={record.case_id}
                      className="odd:bg-white even:bg-[#F9FAFB] transition duration-200 hover:bg-[#F3F7FB]"
                    >
                      <td className="px-3 py-4 text-[#2B3642]">
                        {record.intake_record.control_no}
                      </td>
                      <td className="px-3 py-4 text-[#4B5563]">
                        <div className="space-y-1">
                          {names.length ? names.map((name) => <div key={name}>{name}</div>) : "-"}
                        </div>
                      </td>
                      <td className="px-3 py-4 text-[#4B5563]">
                        <div className="space-y-1">
                          {sexes.length ? sexes.map((sex, index) => <div key={`${sex}-${index}`}>{sex}</div>) : "-"}
                        </div>
                      </td>
                      <td className="px-3 py-4 text-[#4B5563]">
                        {record.cases.title_of_case}
                      </td>
                      <td className="px-3 py-4 text-[#4B5563]">
                        {record.cases.case_no}
                      </td>
                      <td className="px-3 py-4 text-[#4B5563]">
                        {record.cases.court_body}
                      </td>
                      <td className="px-3 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openRecord(record, "view")}
                            className="inline-flex items-center gap-1.5 rounded-md border border-[#704389] bg-white px-3 py-1.5 text-xs font-semibold text-[#704389] transition duration-200 hover:-translate-y-px hover:bg-[#704389] hover:text-white"
                          >
                            <EyeIcon />
                            View
                          </button>
                          <button
                            type="button"
                            onClick={() => openRecord(record, "update")}
                            className="rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-semibold text-[#4B5563] transition duration-200 hover:-translate-y-px hover:bg-[#F8FAFC]"
                          >
                            Update
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modals */}
      <AddClientModal
        isOpen={showClientModal}
        onClose={() => setShowClientModal(false)}
      />
      <AddCaseModal
        isOpen={showCaseModal}
        onClose={() => setShowCaseModal(false)}
        caseType={caseType}
      />
      <ExportCsvModal
        isOpen={showExportModal}
        rows={filteredRows}
        caseType={caseType}
        onClose={() => setShowExportModal(false)}
      />
      <ClientRecordModal
        mode={actionMode}
        caseType={caseType}
        client={activeClient}
        cases={activeCases}
        clients={visibleClients}
        onClose={() => setActiveClientId(null)}
        onClientUpdated={upsertClient}
        onCaseUpdated={upsertCase}
        onCaseTerminated={upsertCase}
        onCreateClient={() => setShowClientModal(true)}
      />
    </MainLayout>
  );
}
