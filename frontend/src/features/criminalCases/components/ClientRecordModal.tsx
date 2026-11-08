import { useState } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { useConfirmation } from "../../../components/ConfirmationProvider";
import ModalPortal from "../../../components/modals/ModalPortal";
import {
  attachClientToCase,
  terminateCaseRecord,
  updateCaseRecord,
  updateClientRecord,
  type TerminationPayload,
} from "../../../services/recordService";
import type {
  CaseParticipant,
  CaseStatus,
  CaseType,
  ClientRecord,
  CriminalCaseRecord,
} from "../../../types";
import { ScannedIntakeEditModal } from "../../documentExtraction/ScannedIntakeEditModal";
import {
  caseParticipants,
  classificationOptions,
  courtBodyOptions,
  participantClassificationLabels,
  participantNames,
  participantPartyRepresented,
  toCaseFormValues,
  toClientFormValues,
} from "../caseRecordHelpers";
import {
  applicantRoleOptions,
  religionOptions,
} from "../clientFieldOptions";
import {
  panaboBarangays,
  ruralBarangays,
  urbanBarangays,
} from "../locationOptions";
import type { CaseFormValues, ClientFormValues } from "../schemas";
import { StatusBadge } from "./StatusBadge";

const accordionBorderClass: Record<CaseStatus, string> = {
  Pending: "border-amber-200",
  Terminated: "border-red-200",
};

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
  const [open, setOpen] = useState(false);

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
              {!isMultiParty && (
                <InfoTile
                  label="Applicant Role"
                  value={
                    participants[0]
                      ? participants[0].applicant_role === "Others"
                        ? participants[0].applicant_role_other
                        : participants[0].applicant_role
                      : record.intake_record.applicant_role
                  }
                />
              )}
              {!isMultiParty && (
                <InfoTile
                  label="Party Represented"
                  value={
                    participants[0]
                      ? participantPartyRepresented(participants[0])
                      : ""
                  }
                />
              )}
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
                          {participantPartyRepresented(participant) ||
                            "Not set"}
                        </p>
                      </div>
                      {participantClassificationLabels(participant).length >
                        0 && (
                        <div className="sm:col-span-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
                            Applicant Classification
                          </p>
                          <p className="mt-1 break-words text-sm font-medium text-[#111827]">
                            {participantClassificationLabels(participant).join(
                              "; ",
                            )}
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
                value={record.cases.incident_city ?? ""}
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
  if (!client.paper_intake) {
    return (
      <LegacyUpdateClientInfoModal
        client={client}
        onClose={onClose}
        onSaved={onSaved}
      />
    );
  }
  return (
    <ScannedIntakeEditModal
      client={client}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function LegacyUpdateClientInfoModal({
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
    value: boolean | string | null,
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
      <div
        className="jurisguard-modal-overlay bg-black/70 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
      >
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
                <p className="mt-4 text-sm text-[#4B5563]">
                  Review the source document before setting these inventory
                  classifications. Age and sex do not set them automatically.
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  {(
                    [
                      ["flag_female", "Female"],
                      ["flag_senior", "Senior Citizen"],
                      ["flag_cicl", "CICL"],
                    ] as const
                  ).map(([name, label]) => (
                    <label
                      key={name}
                      className="text-sm font-medium text-[#4B5563]"
                    >
                      {label}
                      <select
                        className="mt-1 w-full rounded-md border border-[#CBD5E1] bg-white px-3 py-2"
                        value={
                          values.client_classification[name] === null
                            ? ""
                            : String(values.client_classification[name])
                        }
                        onChange={(event) => {
                          updateClassification(
                            name,
                            event.target.value === ""
                              ? null
                              : event.target.value === "true",
                          );
                          updateClassification("flags_reviewed", true);
                        }}
                      >
                        <option value="">Unresolved</option>
                        <option value="true">Yes, explicitly supported</option>
                        <option value="false">No, explicitly negated</option>
                      </select>
                    </label>
                  ))}
                </div>
                <label className="mt-3 flex items-center gap-2 text-sm text-[#4B5563]">
                  <input
                    type="checkbox"
                    checked={values.client_classification.flags_reviewed}
                    onChange={(event) =>
                      updateClassification(
                        "flags_reviewed",
                        event.target.checked,
                      )
                    }
                  />
                  Source evidence reviewed; unresolved values remain unknown
                </label>
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
      value === "Urban"
        ? urbanBarangays
        : value === "Rural"
          ? ruralBarangays
          : panaboBarangays;
    setValues((current) => ({
      ...current,
      cases: {
        ...current.cases,
        location_type: value,
        incident_barangay: nextBarangays.includes(
          current.cases.incident_barangay ?? "",
        )
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
          incident_city: values.cases.incident_city,
          detained: caseDetained,
          date_of_confinement: caseDetained
            ? values.cases.date_of_confinement
            : "",
          place_of_detention: caseDetained
            ? values.cases.place_of_detention
            : "",
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
      <div
        className="jurisguard-modal-overlay bg-black/70 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
      >
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
                  onChange={(event) =>
                    updateCase("court_body", event.target.value)
                  }
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
                    updateCase(
                      "status_of_case",
                      event.target.value as CaseStatus,
                    )
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
                  onChange={(event) =>
                    updateCase("detained", event.target.checked)
                  }
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
                    onChange={(value) =>
                      updateCase("date_of_confinement", value)
                    }
                  />
                  <TextField
                    label="Place of Detention"
                    value={values.cases.place_of_detention}
                    onChange={(value) =>
                      updateCase("place_of_detention", value)
                    }
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
                    intake_record: {
                      ...current.intake_record,
                      form_date: value,
                    },
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
                    updateLocationType(
                      event.target.value as "Urban" | "Rural" | "",
                    )
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
                value={values.cases.incident_city ?? ""}
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
                  value={
                    values.cases.remarks ?? values.cases.last_action_taken
                  }
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
  const confirm = useConfirmation();
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
    if (
      !(await confirm({
        title: "Terminate this case?",
        message:
          "This case will be marked as terminated using the details you entered. Review them before continuing.",
        confirmLabel: "Terminate case",
      }))
    ) {
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
      <div
        className="jurisguard-modal-overlay bg-black/75 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
      >
        <div className="jurisguard-modal-surface w-full max-w-2xl overflow-hidden rounded-2xl border border-[#CBD5E1] bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-[#E5E7EB] bg-[#F8FAFC] px-5 py-4">
            <h3 className="text-base font-bold text-[#2B3642]">
              Terminate Case
            </h3>
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
                setValues((current) => ({
                  ...current,
                  date_terminated: value,
                }))
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
  const attachedIds = new Set(
    record.participants?.map((participant) => participant.client_id) ?? [
      record.client_id,
    ],
  );
  const availableClients = clients.filter(
    (client) => !attachedIds.has(client.client_id),
  );
  const [clientId, setClientId] = useState(
    availableClients[0]?.client_id ?? "",
  );
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
        applicant_role_other:
          applicantRole === "Others" ? applicantRoleOther : "",
        party_represented:
          applicantRole === "Others" ? applicantRoleOther : applicantRole,
      });
      onAttached(updated);
      toast.success("Client attached to case");
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to attach client",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalPortal>
      <div
        className="jurisguard-modal-overlay bg-black/70 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
      >
        <div className="jurisguard-modal-surface w-full max-w-xl overflow-hidden rounded-2xl border border-[#CBD5E1] bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-[#E5E7EB] bg-[#F8FAFC] px-5 py-4">
            <h3 className="text-base font-bold text-[#2B3642]">
              Attach Client / Party
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm font-semibold text-[#4B5563] hover:bg-[#F8FAFC]"
            >
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
                {applicantRoleOptions.map((role) => (
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

export function ClientRecordModal({
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
    navigate(
      `${formBasePath}/form-view/${record.case_id}?${params.toString()}`,
    );
  };

  return (
    <ModalPortal>
      <div
        className="jurisguard-modal-overlay bg-black/70 backdrop-blur-sm transition-opacity duration-200"
        role="dialog"
        aria-modal="true"
      >
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
                <InfoTile
                  label="Address"
                  value={client.client_details.address}
                />
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
                              const [participant] = caseParticipants(
                                record,
                                client,
                              );
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
