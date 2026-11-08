import type { KeyboardEvent } from "react";
import type { FieldErrors, UseFormRegister } from "react-hook-form";
import type { CaseType, ClientRecord } from "../../../types";
import {
  displayDate,
  generatedCaseTitle,
  selectedClassificationNames,
} from "../caseWorkflowHelpers";
import {
  civilStatusOptions,
  relationshipOptions,
} from "../clientFieldOptions";
import type { AddCaseFormInput } from "../schemas";
import {
  FieldError,
  ReviewField,
  SelectedClientCard,
  TextInput,
} from "./CaseWorkflowPrimitives";

export function ClientSelectionStep({
  query,
  onQueryChange,
  onKeyDown,
  clientIdError,
  selectedClients,
  selectedClientId,
  selectedClientIdSet,
  activeClientIndex,
  hasSearch,
  visibleClients,
  onSelectClient,
  onViewClient,
  onRemoveClient,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  clientIdError?: string;
  selectedClients: ClientRecord[];
  selectedClientId: string;
  selectedClientIdSet: Set<string>;
  activeClientIndex: number;
  hasSearch: boolean;
  visibleClients: ClientRecord[];
  onSelectClient: (client: ClientRecord) => void;
  onViewClient: (client: ClientRecord) => void;
  onRemoveClient: (clientId: string) => void;
}) {
  return (
    <div className="grid min-h-0 gap-5 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="space-y-4 rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
        <label className="block">
          <span className="text-sm font-medium text-[#4B5563]">
            Search existing client
          </span>
          <input
            type="text"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search by name or client id"
            className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
            aria-label="Search existing clients"
          />
        </label>
        <p className="text-sm text-[#4B5563]">
          Search by client name or client ID to locate an existing client.
        </p>
        <FieldError message={clientIdError} />

        <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB]">
          <div className="border-b border-[#E5E7EB] px-4 py-3 text-sm font-semibold text-[#2B3642]">
            Selected Clients
          </div>
          <div
            className={`space-y-3 p-3 ${
              selectedClients.length > 0 ? "max-h-64 overflow-y-auto" : ""
            }`}
          >
            {selectedClients.length === 0 ? (
              <div className="py-2 text-center text-sm text-[#4B5563]">
                No clients selected.
              </div>
            ) : (
              selectedClients.map((client) => (
                <SelectedClientCard
                  key={client.client_id}
                  client={client}
                  onView={() => onViewClient(client)}
                  onRemove={() => onRemoveClient(client.client_id)}
                />
              ))
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
        <div className="sticky top-0 border-b border-[#E5E7EB] bg-[#F8FAFC] px-4 py-3 text-sm font-semibold text-[#4B5563]">
          Existing Clients
        </div>
        <div className="max-h-96 min-h-0 divide-y divide-[#E5E7EB] overflow-y-auto">
          {!hasSearch ? (
            <div className="px-4 py-8 text-center text-sm text-[#4B5563]">
              Start typing to search clients.
            </div>
          ) : visibleClients.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[#4B5563]">
              No matching clients found.
            </div>
          ) : (
            visibleClients.map((client, index) => {
              const alreadySelected = selectedClientIdSet.has(client.client_id);
              return (
                <button
                  type="button"
                  key={client.client_id}
                  onClick={() => onSelectClient(client)}
                  disabled={alreadySelected}
                  className={`block w-full px-4 py-3 text-left transition duration-200 hover:bg-[#F8FAFC] ${
                    selectedClientId === client.client_id ||
                    alreadySelected ||
                    activeClientIndex === index
                      ? "bg-[#F7F0FA]"
                      : "bg-white"
                  } disabled:cursor-not-allowed disabled:opacity-70`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[#2B3642]">
                        {client.client.name}
                      </p>
                      <p className="mt-1 text-xs text-[#4B5563]">
                        {client.client_id}
                      </p>
                    </div>
                    <span className="text-xs font-medium text-[#4B5563]">
                      {alreadySelected ? "Selected" : client.client.sex}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export function RepresentativeFieldsSection({
  selectedClients,
  clientRepresentativeEntries,
  collapsedRepresentativeIds,
  onToggleCollapse,
  register,
  errors,
}: {
  selectedClients: ClientRecord[];
  clientRepresentativeEntries: AddCaseFormInput["client_representatives"];
  collapsedRepresentativeIds: Set<string>;
  onToggleCollapse: (clientId: string, shouldCollapse: boolean) => void;
  register: UseFormRegister<AddCaseFormInput>;
  errors: FieldErrors<AddCaseFormInput>;
}) {
  return (
    <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <h3 className="text-base font-semibold text-[#1F2937]">
        Representative Information
      </h3>
      <div className="mt-3 space-y-3">
        {selectedClients.map((client) => {
          const representativeIndex = (
            clientRepresentativeEntries ?? []
          ).findIndex((entry) => entry.client_id === client.client_id);
          if (representativeIndex < 0) return null;
          const fieldPrefix =
            `client_representatives.${representativeIndex}.representative` as const;
          const collapsed = collapsedRepresentativeIds.has(client.client_id);
          const representativeErrors =
            errors.client_representatives?.[representativeIndex]
              ?.representative;
          return (
            <article
              key={client.client_id}
              className="rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-[#2B3642]">
                  {client.client.name}
                </h4>
                <label className="flex items-center gap-2 text-sm font-medium text-[#4B5563]">
                  <input
                    type="checkbox"
                    checked={collapsed}
                    onChange={(event) =>
                      onToggleCollapse(client.client_id, event.target.checked)
                    }
                    className="h-4 w-4 rounded border-[#D1D5DB] text-[#704389] focus:ring-[#704389]"
                  />
                  Representative Information
                </label>
              </div>
              {!collapsed && (
                <div className="mt-4 grid gap-4">
                  <div>
                    <TextInput
                      label="Representative Name"
                      registration={register(`${fieldPrefix}.rep_name`)}
                      error={representativeErrors?.rep_name?.message}
                    />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <TextInput
                      label="Representative Age"
                      type="number"
                      registration={register(`${fieldPrefix}.rep_age`, {
                        valueAsNumber: true,
                      })}
                      error={representativeErrors?.rep_age?.message}
                    />
                    <label className="block">
                      <span className="text-sm font-medium text-[#4B5563]">
                        Representative Sex
                      </span>
                      <select
                        {...register(`${fieldPrefix}.rep_sex`)}
                        className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
                      >
                        <option value="">Select</option>
                        <option>Male</option>
                        <option>Female</option>
                      </select>
                      <FieldError
                        message={representativeErrors?.rep_sex?.message}
                      />
                    </label>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="block">
                      <span className="text-sm font-medium text-[#4B5563]">
                        Civil Status
                      </span>
                      <select
                        {...register(`${fieldPrefix}.civil_status`)}
                        className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
                      >
                        <option value="">Select</option>
                        {civilStatusOptions.map((option) => (
                          <option key={option}>{option}</option>
                        ))}
                      </select>
                      <FieldError
                        message={representativeErrors?.civil_status?.message}
                      />
                    </label>
                    <TextInput
                      label="Representative Address"
                      registration={register(`${fieldPrefix}.rep_address`)}
                      error={representativeErrors?.rep_address?.message}
                    />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <TextInput
                      label="Contact Number"
                      registration={register(`${fieldPrefix}.rep_contact_no`)}
                      error={representativeErrors?.rep_contact_no?.message}
                    />
                    <label className="block">
                      <span className="text-sm font-medium text-[#4B5563]">
                        Relationship to Applicant
                      </span>
                      <select
                        {...register(
                          `${fieldPrefix}.relationship_to_applicant`,
                        )}
                        className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
                      >
                        <option value="">Select</option>
                        {relationshipOptions.map((option) => (
                          <option key={option}>{option}</option>
                        ))}
                      </select>
                      <FieldError
                        message={
                          representativeErrors?.relationship_to_applicant
                            ?.message
                        }
                      />
                    </label>
                  </div>
                  <div>
                    <TextInput
                      label="Representative Email"
                      type="email"
                      registration={register(`${fieldPrefix}.rep_email`)}
                      error={representativeErrors?.rep_email?.message}
                    />
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function ClassificationStep({
  selectedClients,
  onViewClient,
}: {
  selectedClients: ClientRecord[];
  onViewClient: (client: ClientRecord) => void;
}) {
  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
        <h3 className="text-base font-semibold text-[#1F2937]">
          Applicant Classification
        </h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {selectedClients.map((client) => {
            const classifications = selectedClassificationNames(client);
            return (
              <div
                key={client.client_id}
                className="rounded-md border border-[#E5E7EB] bg-white p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#2B3642]">
                      {client.client.name}
                    </p>
                    <p className="mt-1 text-xs text-[#6B7280]">
                      {client.client_id}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onViewClient(client)}
                    className="shrink-0 rounded-md border border-[#704389] bg-white px-2.5 py-1 text-xs font-semibold text-[#704389] transition hover:bg-[#704389] hover:text-white"
                  >
                    View
                  </button>
                </div>
                <p className="mt-3 text-sm font-semibold text-[#2B3642]">
                  {classifications.join(", ") || "None selected"}
                </p>
                {client.client_classification.classification_notes && (
                  <p className="mt-2 text-xs leading-5 text-[#4B5563]">
                    {client.client_classification.classification_notes}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export function CaseReviewStep({
  selectedClients,
  caseType,
  reviewValues,
  onViewClient,
}: {
  selectedClients: ClientRecord[];
  caseType: CaseType;
  reviewValues: AddCaseFormInput;
  onViewClient: (client: ClientRecord) => void;
}) {
  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
        <h3 className="text-base font-semibold text-[#1F2937]">
          Selected Clients
        </h3>
        <div className="mt-3 flex max-h-44 flex-wrap content-start gap-2 overflow-y-auto">
          {selectedClients.map((client) => (
            <SelectedClientCard
              key={client.client_id}
              client={client}
              locked
              onView={() => onViewClient(client)}
            />
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
        <h3 className="text-base font-semibold text-[#1F2937]">
          Case Information
        </h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <ReviewField
            label="Control No."
            value={reviewValues.intake_record.control_no}
          />
          <ReviewField
            label="Case Received"
            value={displayDate(reviewValues.intake_record.form_date)}
          />
          <ReviewField
            label="Regional Office"
            value={reviewValues.intake_record.region}
          />
          <ReviewField
            label="District Office"
            value={reviewValues.intake_record.district_office}
          />
          <ReviewField
            label="Case Title"
            value={generatedCaseTitle(selectedClients, caseType)}
          />
          <ReviewField label="Case No." value={reviewValues.cases.case_no} />
          <ReviewField
            label="Court / Body"
            value={reviewValues.cases.court_body}
          />
          <ReviewField
            label="Nature of Case"
            value={reviewValues.intake_record.nature_of_case}
          />
          <ReviewField
            label="Party Represented"
            value={
              reviewValues.intake_record.applicant_role === "Others"
                ? reviewValues.intake_record.applicant_role_other
                : reviewValues.intake_record.applicant_role
            }
          />
          <ReviewField
            label="Status"
            value={reviewValues.cases.status_of_case}
          />
          <ReviewField
            label="Last Action Taken"
            value={reviewValues.cases.last_action_taken}
          />
          <ReviewField
            label="Cause of Action"
            value={reviewValues.cases.cause_of_action}
          />
          <ReviewField
            label="Location Type"
            value={reviewValues.cases.location_type}
          />
          <ReviewField
            label="Barangay"
            value={reviewValues.cases.incident_barangay}
          />
          <ReviewField label="City" value="Panabo City" />
          <ReviewField label="Detained" value={reviewValues.cases.detained} />
          <ReviewField
            label="Date of Confinement"
            value={displayDate(reviewValues.cases.date_of_confinement)}
          />
          <ReviewField
            label="Place of Detention"
            value={reviewValues.cases.place_of_detention}
          />
        </div>
        <div className="mt-3">
          <ReviewField
            label="Facts of Case"
            value={reviewValues.cases.facts_of_case}
          />
        </div>
      </section>

      {selectedClients.map((client) => {
        const representative = reviewValues.client_representatives.find(
          (entry) => entry.client_id === client.client_id,
        )?.representative;
        return (
          <section
            key={client.client_id}
            className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm"
          >
            <h3 className="text-base font-semibold text-[#1F2937]">
              Representative Information — {client.client.name}
            </h3>
            <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <ReviewField
                label="Representative Name"
                value={representative?.rep_name}
              />
              <ReviewField
                label="Representative Age"
                value={
                  typeof representative?.rep_age === "number" ||
                  typeof representative?.rep_age === "string"
                    ? representative.rep_age
                    : undefined
                }
              />
              <ReviewField
                label="Representative Sex"
                value={representative?.rep_sex}
              />
              <ReviewField
                label="Civil Status"
                value={representative?.civil_status}
              />
              <ReviewField
                label="Representative Address"
                value={representative?.rep_address}
              />
              <ReviewField
                label="Contact Number"
                value={representative?.rep_contact_no}
              />
              <ReviewField
                label="Relationship to Applicant"
                value={representative?.relationship_to_applicant}
              />
              <ReviewField
                label="Representative Email"
                value={representative?.rep_email}
              />
            </div>
          </section>
        );
      })}
    </div>
  );
}
