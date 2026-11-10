import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useForm } from "react-hook-form";
import type { KeyboardEvent } from "react";
import {
  clientRepresentativeValues,
  createDefaultValues,
  emptyRepresentativeValues,
  generatedCaseTitle,
  getFirstValidationMessage,
  hasSavedRepresentative,
  partyFromHistoricalCase,
} from "../../features/criminalCases/caseWorkflowHelpers";
import { applicantRoleOptions } from "../../features/criminalCases/clientFieldOptions";
import {
  FieldError,
  InventorySourceField,
  SelectedClientCard,
  TextArea,
  TextInput,
} from "../../features/criminalCases/components/CaseWorkflowPrimitives";
import {
  CaseReviewStep,
  ClassificationStep,
  ClientSelectionStep,
  RepresentativeFieldsSection,
} from "../../features/criminalCases/components/CaseWorkflowSteps";
import { StepIndicator } from "../../features/criminalCases/components/StepIndicator";
import {
  natureOfCaseOptions,
  panaboBarangays,
  ruralBarangays,
  urbanBarangays,
} from "../../features/criminalCases/locationOptions";
import {
  addCaseFormSchema,
  criminalAddCaseFormSchema,
  type AddCaseFormInput,
  type AddCaseFormValues,
} from "../../features/criminalCases/schemas";
import { ScannedIntakeEditModal } from "../../features/documentExtraction/ScannedIntakeEditModal";
import { getClientCases } from "../../services/recordService";
import type { CaseType, ClientRecord } from "../../types";
import { useConfirmation } from "../ConfirmationProvider";
import ClientInformationModal from "./ClientInformationModal";

interface CaseWorkflowProps {
  clients: ClientRecord[];
  lockedClient?: ClientRecord;
  lockedClients?: ClientRecord[];
  caseType?: CaseType;
  requireReviewBeforeSubmit?: boolean;
  submitLabel?: string;
  stepNumberOffset?: number;
  hideStepIndicator?: boolean;
  onClientUpdated?: (client: ClientRecord) => void;
  onCancel?: () => void;
  onSubmit: (values: AddCaseFormValues) => void | Promise<void>;
}

export function CaseWorkflow({
  clients,
  lockedClient,
  lockedClients,
  caseType = "Criminal",
  requireReviewBeforeSubmit = false,
  submitLabel = "Save Case",
  stepNumberOffset = 0,
  hideStepIndicator = false,
  onClientUpdated,
  onCancel,
  onSubmit,
}: CaseWorkflowProps) {
  const lockedSelectionClients = useMemo(
    () =>
      lockedClients?.length
        ? lockedClients
        : lockedClient
          ? [lockedClient]
          : [],
    [lockedClient, lockedClients],
  );
  const hasLockedSelection = lockedSelectionClients.length > 0;
  const [step, setStep] = useState(0);
  const [query, setQuery] = useState("");
  const [viewingClient, setViewingClient] = useState<ClientRecord | null>(null);
  const [editingClient, setEditingClient] = useState<ClientRecord | null>(null);
  const [
    collapsedRepresentativeClientIds,
    setCollapsedRepresentativeClientIds,
  ] = useState<string[]>(() =>
    lockedSelectionClients
      .filter(hasSavedRepresentative)
      .map((client) => client.client_id),
  );
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>(
    lockedSelectionClients.map((client) => client.client_id),
  );
  const [activeClientIndex, setActiveClientIndex] = useState(0);
  const confirm = useConfirmation();
  const standaloneSteps = requireReviewBeforeSubmit
    ? ["Select Client", "Case Details", "Classification", "Review"]
    : ["Select Client", "Case Details"];
  const lockedSteps = requireReviewBeforeSubmit
    ? ["Case Details", "Classification", "Review"]
    : ["Case Details"];
  const steps = hasLockedSelection ? lockedSteps : standaloneSteps;
  const formSchema =
    caseType === "Criminal" ? criminalAddCaseFormSchema : addCaseFormSchema;
  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    watch,
    trigger,
    formState: { isSubmitting, errors },
  } = useForm<AddCaseFormInput, unknown, AddCaseFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: createDefaultValues(
      lockedSelectionClients[0]?.client_id ?? "",
      caseType,
      lockedSelectionClients,
    ),
    mode: "onBlur",
  });

  const selectedClientId = watch("client_id");
  const selectedClientIdSet = useMemo(
    () => new Set(selectedClientIds),
    [selectedClientIds],
  );
  const selectedClients = useMemo(
    () =>
      hasLockedSelection
        ? lockedSelectionClients
        : selectedClientIds
            .map((clientId) =>
              clients.find((client) => client.client_id === clientId),
            )
            .filter((client): client is ClientRecord => Boolean(client)),
    [clients, hasLockedSelection, lockedSelectionClients, selectedClientIds],
  );
  const selectedClient = selectedClients[0];
  const scannedSelectedClients = selectedClients.filter(
    (client) => client.paper_intake,
  );
  const applicantRole = watch("intake_record.applicant_role");
  const clientRepresentativeEntries = watch("client_representatives") ?? [];
  const caseStatus = watch("cases.status_of_case");
  const caseDetained = Boolean(watch("cases.detained"));
  const locationType = watch("cases.location_type");
  const incidentBarangay = watch("cases.incident_barangay");
  const partyLookupKey = selectedClients
    .map((client) => client.client_id)
    .join("|");
  const partyLookupClientsRef = useRef(selectedClients);
  const partySelectionTouched = useRef(false);
  const submitInProgressRef = useRef(false);
  const hasSearch = query.trim().length > 0;
  const filteredClients = useMemo(() => {
    if (!hasSearch) return [];
    const normalized = query.trim().toLowerCase();
    return clients.filter((client) =>
      `${client.client_id} ${client.client.name}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [clients, hasSearch, query]);
  const visibleClients = filteredClients.slice(0, 8);
  const isCaseFormStep = hasLockedSelection ? step === 0 : step === 1;
  const classificationStep = hasLockedSelection ? 1 : 2;
  const reviewStep = hasLockedSelection ? 2 : 3;
  const isClassificationStep =
    requireReviewBeforeSubmit && step === classificationStep;
  const isReviewStep = requireReviewBeforeSubmit && step === reviewStep;
  const reviewValues = watch();
  const collapsedRepresentativeIds = useMemo(
    () => new Set(collapsedRepresentativeClientIds),
    [collapsedRepresentativeClientIds],
  );
  const filteredBarangays =
    locationType === "Urban"
      ? urbanBarangays
      : locationType === "Rural"
        ? ruralBarangays
        : panaboBarangays;

  useEffect(() => {
    partyLookupClientsRef.current = selectedClients;
  }, [selectedClients]);

  useEffect(() => {
    let isCurrent = true;
    partySelectionTouched.current = false;
    setValue("intake_record.applicant_role", "", { shouldValidate: true });
    setValue("intake_record.applicant_role_other", "", {
      shouldValidate: false,
    });
    const clientsToLookup = partyLookupClientsRef.current;
    if (!partyLookupKey || clientsToLookup.length === 0) {
      return () => {
        isCurrent = false;
      };
    }

    Promise.all(
      clientsToLookup.map(async (client) => {
        const records = await getClientCases(client.client_id, "All");
        return records[0]
          ? partyFromHistoricalCase(records[0], client.client_id)
          : null;
      }),
    )
      .then((values) => {
        if (!isCurrent || partySelectionTouched.current) return;
        const first = values[0];
        const sameForAll =
          Boolean(first) &&
          values.every(
            (value) =>
              value?.role === first?.role && value?.other === first?.other,
          );
        if (!sameForAll || !first) return;
        setValue("intake_record.applicant_role", first.role, {
          shouldDirty: false,
          shouldValidate: true,
        });
        setValue("intake_record.applicant_role_other", first.other, {
          shouldDirty: false,
          shouldValidate: true,
        });
      })
      .catch(() => {
        // Historical values are optional; keep the field blank if lookup fails.
      });

    return () => {
      isCurrent = false;
    };
  }, [partyLookupKey, setValue]);

  useEffect(() => {
    setActiveClientIndex(0);
  }, [query]);

  useEffect(() => {
    if (hasLockedSelection) {
      const clientIds = lockedSelectionClients.map(
        (client) => client.client_id,
      );
      setSelectedClientIds(clientIds);
      setValue("client_id", clientIds[0] ?? "", { shouldValidate: true });
      setValue("client_ids", clientIds, { shouldValidate: true });
    }
  }, [hasLockedSelection, lockedSelectionClients, setValue]);

  useEffect(() => {
    if (hasLockedSelection) return;
    setValue("client_id", selectedClientIds[0] ?? "", {
      shouldDirty: true,
      shouldValidate: true,
    });
    setValue("client_ids", selectedClientIds, {
      shouldDirty: true,
      shouldValidate: true,
    });
  }, [hasLockedSelection, selectedClientIds, setValue]);

  useEffect(() => {
    const current = getValues("client_representatives") ?? [];
    const selectedIds = selectedClients.map((client) => client.client_id);
    if (
      current.length === selectedIds.length &&
      current.every((entry, index) => entry.client_id === selectedIds[index])
    ) {
      return;
    }
    const nextValues = selectedClients.map(
      (client) =>
        current.find((entry) => entry.client_id === client.client_id) ?? {
          client_id: client.client_id,
          representative: clientRepresentativeValues(client),
        },
    );
    setValue("client_representatives", nextValues, { shouldValidate: false });
  }, [getValues, partyLookupKey, selectedClients, setValue]);

  useEffect(() => {
    if (caseType === "Criminal") return;
    const pending = caseStatus !== "Terminated";
    setValue("cases.pending_in_court", pending, { shouldDirty: true });
    setValue("cases.case_status", caseStatus, { shouldDirty: true });
  }, [caseStatus, caseType, setValue]);

  useEffect(() => {
    if (
      !incidentBarangay ||
      (locationType && filteredBarangays.includes(incidentBarangay))
    ) {
      return;
    }
    setValue("cases.incident_barangay", "", {
      shouldDirty: true,
      shouldValidate: true,
    });
  }, [filteredBarangays, incidentBarangay, locationType, setValue]);

  const selectClient = (client: ClientRecord) => {
    setSelectedClientIds((current) => {
      if (current.includes(client.client_id)) {
        toast.error("Client is already selected.");
        return current;
      }
      return [...current, client.client_id];
    });
    setCollapsedRepresentativeClientIds((current) =>
      hasSavedRepresentative(client) && !current.includes(client.client_id)
        ? [...current, client.client_id]
        : current.filter((clientId) => clientId !== client.client_id),
    );
    setQuery("");
  };

  const clearClient = () => {
    setQuery("");
  };

  const removeSelectedClient = async (clientId: string) => {
    const clientToRemove = selectedClients.find(
      (client) => client.client_id === clientId,
    );
    if (!clientToRemove) return;
    const confirmed = await confirm({
      title: "Remove selected client?",
      message: `Are you sure you want to remove ${clientToRemove.client.name} from this case? This only removes the client from the current case selection.`,
      confirmLabel: "Remove Client",
    });
    if (!confirmed) return;
    setSelectedClientIds((current) =>
      current.filter((selectedId) => selectedId !== clientId),
    );
    setValue(
      "client_representatives",
      getValues("client_representatives").filter(
        (entry) => entry.client_id !== clientId,
      ),
      { shouldDirty: true, shouldValidate: false },
    );
    setCollapsedRepresentativeClientIds((current) =>
      current.filter((selectedId) => selectedId !== clientId),
    );
  };

  const handleClientSearchKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveClientIndex((current) =>
        Math.min(current + 1, visibleClients.length - 1),
      );
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveClientIndex((current) => Math.max(current - 1, 0));
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const client = visibleClients[activeClientIndex];
      if (client) selectClient(client);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      clearClient();
    }
  };

  const continueFromClient = async () => {
    if (selectedClientIds.length === 0) {
      toast.error("Select at least one client before continuing.");
      return;
    }
    const valid = await trigger("client_id");
    if (!valid) return;
    setStep(1);
  };

  const continueFromDetails = async () => {
    const valid = await trigger();
    if (!valid) {
      toast.error(
        getFirstValidationMessage(errors) ??
          "Please resolve validation errors before reviewing.",
      );
      return;
    }
    setStep(classificationStep);
  };

  const continueToReview = () => setStep(reviewStep);

  const handleControlNoKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      [
        "Backspace",
        "Delete",
        "Tab",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
        "Enter",
        "Escape",
      ].includes(event.key)
    ) {
      return;
    }
    if (!/^[0-9]$/.test(event.key)) {
      event.preventDefault();
      return;
    }
    const input = event.currentTarget;
    const selectionLength = (input.selectionEnd ?? 0) - (input.selectionStart ?? 0);
    if (input.value.length >= 11 && selectionLength === 0) {
      event.preventDefault();
    }
  };

  const handleControlNoPaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasteData = event.clipboardData.getData("text");
    const digitsOnly = pasteData.replace(/\D/g, "");
    const input = event.currentTarget;
    const currentVal = input.value;
    const start = input.selectionStart ?? currentVal.length;
    const end = input.selectionEnd ?? currentVal.length;
    const nextVal = (currentVal.slice(0, start) + digitsOnly + currentVal.slice(end)).slice(0, 11);
    input.value = nextVal;
    setValue("intake_record.control_no", nextVal, {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const handleControlNoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = event.target.value.replace(/\D/g, "").slice(0, 11);
    event.target.value = sanitized;
    setValue("intake_record.control_no", sanitized, {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const toggleRepresentativeCollapse = (
    clientId: string,
    shouldCollapse: boolean,
  ) => {
    setCollapsedRepresentativeClientIds((current) =>
      shouldCollapse
        ? current.includes(clientId)
          ? current
          : [...current, clientId]
        : current.filter((id) => id !== clientId),
    );
  };

  const submitCase = async (values: AddCaseFormValues) => {
    if (submitInProgressRef.current) return;
    submitInProgressRef.current = true;
    try {
      const generatedTitle = generatedCaseTitle(selectedClients, caseType);
      const normalizedStatus =
        values.cases.status_of_case === "Terminated" ? "Terminated" : "Pending";
      const normalizedDetained = Boolean(values.cases.detained);
      const representedParty =
        values.intake_record.applicant_role === "Others"
          ? values.intake_record.applicant_role_other
          : values.intake_record.applicant_role;
      const caseValues = { ...values.cases };
      delete (caseValues as Partial<AddCaseFormValues["cases"]>)
        .incident_address;
      delete (caseValues as Partial<AddCaseFormValues["cases"]>).latitude;
      delete (caseValues as Partial<AddCaseFormValues["cases"]>).longitude;
      const primaryClientRepresentative =
        values.client_representatives.find(
          (entry) =>
            entry.client_id === (selectedClient?.client_id ?? values.client_id),
        )?.representative ?? emptyRepresentativeValues();
      await onSubmit({
        ...values,
        case_type: caseType,
        client_id: selectedClient?.client_id ?? values.client_id,
        client_ids: selectedClients.map((client) => client.client_id),
        client_representatives: values.client_representatives.filter((entry) =>
          selectedClients.some(
            (client) => client.client_id === entry.client_id,
          ),
        ),
        representative: primaryClientRepresentative,
        intake_record: {
          ...values.intake_record,
          district_office: values.intake_record.district_office,
          party_represented: representedParty,
          inv_plaintiff: values.intake_record.applicant_role === "Plaintiff",
          inv_defendant: values.intake_record.applicant_role === "Defendant",
          inv_oppositor: values.intake_record.applicant_role === "Oppositor",
          inv_petitioner: values.intake_record.applicant_role === "Petitioner",
          inv_respondent: values.intake_record.applicant_role === "Respondent",
          inv_complainant:
            values.intake_record.applicant_role === "Complainant",
          inv_accused: values.intake_record.applicant_role === "Accused",
          inv_others:
            values.intake_record.applicant_role === "Others"
              ? values.intake_record.applicant_role_other
              : "",
        },
        adverse_party: {
          role: "",
          name: "",
          address: "",
        },
        cases: {
          ...caseValues,
          title_of_case: generatedTitle,
          status_of_case: normalizedStatus,
          ...(caseType === "Civil"
            ? {
                case_status: normalizedStatus,
                pending_in_court: normalizedStatus === "Pending",
              }
            : {}),
          incident_city: "Panabo City",
          detained: normalizedDetained,
          date_of_confinement: normalizedDetained
            ? values.cases.date_of_confinement
            : "",
          place_of_detention: normalizedDetained
            ? values.cases.place_of_detention
            : "",
        },
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save case",
      );
    } finally {
      submitInProgressRef.current = false;
    }
  };

  const selectedClientsSection = (
    <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <h3 className="text-base font-semibold text-[#1F2937]">
        {selectedClients.length === 1
          ? "Selected Client"
          : "Selected Clients"}
      </h3>
      <div className="mt-3 flex flex-wrap content-start gap-2">
        {selectedClients.map((client) => (
          <SelectedClientCard
            key={client.client_id}
            client={client}
            locked={hasLockedSelection}
            onView={() => setViewingClient(client)}
            onRemove={
              hasLockedSelection
                ? undefined
                : () => void removeSelectedClient(client.client_id)
            }
          />
        ))}
      </div>
    </section>
  );

  return (
    <form
      onSubmit={handleSubmit(submitCase, () =>
        toast.error(
          getFirstValidationMessage(errors) ??
            "Please resolve validation errors before saving.",
        ),
      )}
      className="flex max-h-[calc(92vh-138px)] flex-col"
    >
      {!hideStepIndicator && steps.length > 1 && (
        <div className="border-b border-[#E5E7EB] bg-white px-6 py-4">
          <StepIndicator steps={steps} currentStep={step} stepNumberOffset={stepNumberOffset} />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto bg-[#F8FAFC] px-6 py-5">
        {!hasLockedSelection && step === 0 && (
          <ClientSelectionStep
            query={query}
            onQueryChange={setQuery}
            onKeyDown={handleClientSearchKeyDown}
            clientIdError={errors.client_id?.message}
            selectedClients={selectedClients}
            selectedClientId={selectedClientId}
            selectedClientIdSet={selectedClientIdSet}
            activeClientIndex={activeClientIndex}
            hasSearch={hasSearch}
            visibleClients={visibleClients}
            onSelectClient={selectClient}
            onViewClient={setViewingClient}
            onRemoveClient={(clientId) => void removeSelectedClient(clientId)}
          />
        )}

        {isCaseFormStep && (
          <div className="space-y-6">
            {hasLockedSelection && selectedClientsSection}

            {caseType === "Criminal" && (
              <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
                <h3 className="text-base font-semibold text-[#1F2937]">
                  Report heading
                </h3>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <TextInput
                    label="Regional Office"
                    registration={register("intake_record.region")}
                    readOnly
                  />
                  <TextInput
                    label="District Office"
                    registration={register("intake_record.district_office")}
                    error={errors.intake_record?.district_office?.message}
                    readOnly
                  />
                </div>
              </section>
            )}

            {!hasLockedSelection && selectedClientsSection}

            {caseType === "Criminal" && (
              <section
                data-testid="criminal-inventory-fields"
                className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-[#1F2937]">
                      Inventory report fields
                    </h3>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-[#4B5563]">
                      Fields follow the same order as the Excel inventory
                      report. Values from Part II are shown as read-only until
                      you open the scanned intake editor.
                    </p>
                  </div>
                  {onClientUpdated && scannedSelectedClients.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {scannedSelectedClients.map((client) => (
                        <button
                          key={client.client_id}
                          type="button"
                          onClick={() => setEditingClient(client)}
                          className="min-h-11 rounded-md border border-[#704389] bg-white px-4 py-2 text-sm font-semibold text-[#704389] transition hover:bg-[#F7F0FA] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#704389]"
                        >
                          {scannedSelectedClients.length === 1
                            ? "Edit scanned Parts II and II-A"
                            : `Edit scan: ${client.client.name}`}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-4 grid gap-5 md:grid-cols-2">
                  <TextInput
                    label="Control Number"
                    registration={register("intake_record.control_no")}
                    error={errors.intake_record?.control_no?.message}
                    maxLength={11}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    onKeyDown={handleControlNoKeyDown}
                    onPaste={handleControlNoPaste}
                    onChange={handleControlNoChange}
                  />
                  <label className="block">
                    <span className="text-sm font-medium text-[#4B5563]">
                      Court / Body
                    </span>
                    <select
                      {...register("cases.court_body")}
                      className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
                    >
                      <option>Branch 4</option>
                      <option>Branch 34</option>
                      <option>MTCC</option>
                    </select>
                    <FieldError message={errors.cases?.court_body?.message} />
                  </label>
                  <InventorySourceField
                    label="Title of the Case"
                    value={generatedCaseTitle(selectedClients, caseType)}
                    source="Generated from the selected client records"
                  />
                  <TextInput
                    label="Case No."
                    registration={register("cases.case_no")}
                    error={errors.cases?.case_no?.message}
                  />

                  <fieldset className="md:col-span-2">
                    <legend className="text-sm font-medium text-[#4B5563]">
                      Party Represented
                    </legend>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {applicantRoleOptions.map((role) => (
                        <label
                          key={role}
                          className="flex min-h-10 items-center gap-2 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563]"
                        >
                          <input
                            type="radio"
                            value={role}
                            {...register("intake_record.applicant_role", {
                              onChange: () => {
                                partySelectionTouched.current = true;
                              },
                            })}
                            className="h-4 w-4 border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
                          />
                          {role}
                        </label>
                      ))}
                    </div>
                    <FieldError
                      message={errors.intake_record?.applicant_role?.message}
                    />
                    {applicantRole === "Others" && (
                      <div className="mt-3 max-w-md">
                        <TextInput
                          label="Specify Party Represented"
                          registration={register(
                            "intake_record.applicant_role_other",
                          )}
                          error={
                            errors.intake_record?.applicant_role_other?.message
                          }
                        />
                      </div>
                    )}
                  </fieldset>

                  <div className="md:col-span-2">
                    <TextArea
                      label="Cause of Action"
                      registration={register("cases.cause_of_action")}
                      error={errors.cases?.cause_of_action?.message}
                    />
                  </div>

                  <label className="block">
                    <span className="text-sm font-medium text-[#4B5563]">
                      Status of Case
                    </span>
                    <select
                      {...register("cases.status_of_case")}
                      className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
                    >
                      <option>Pending</option>
                      <option>Terminated</option>
                    </select>
                  </label>
                  <TextInput
                    label="Last Action Taken"
                    registration={register("cases.last_action_taken")}
                    error={errors.cases?.last_action_taken?.message}
                  />

                  <label className="flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563] md:col-span-2">
                    <input
                      type="checkbox"
                      {...register("cases.detained")}
                      className="h-4 w-4 rounded border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
                    />
                    Client is detained
                  </label>
                  {caseDetained && (
                    <>
                      <TextInput
                        label="Date of Confinement"
                        type="date"
                        registration={register("cases.date_of_confinement")}
                        error={errors.cases?.date_of_confinement?.message}
                      />
                      <TextInput
                        label="Place of Detention"
                        registration={register("cases.place_of_detention")}
                        error={errors.cases?.place_of_detention?.message}
                      />
                    </>
                  )}

                  <TextInput
                    label="Case Received"
                    type="date"
                    registration={register("intake_record.form_date")}
                    error={errors.intake_record?.form_date?.message}
                  />
                </div>
              </section>
            )}

            {caseType === "Civil" && (
              <>
                <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
                  <h3 className="text-base font-semibold text-[#1F2937]">
                    Case Identification
                  </h3>
                  <div className="mt-3 grid gap-4 md:grid-cols-2">
                    <TextInput
                      label="Control No."
                      registration={register("intake_record.control_no")}
                      error={errors.intake_record?.control_no?.message}
                      maxLength={11}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      onKeyDown={handleControlNoKeyDown}
                      onPaste={handleControlNoPaste}
                      onChange={handleControlNoChange}
                    />
                    <label className="block">
                      <span className="text-sm font-medium text-[#4B5563]">
                        Court / Body
                      </span>
                      <select
                        {...register("cases.court_body")}
                        className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
                      >
                        <option>Branch 4</option>
                        <option>Branch 34</option>
                        <option>MTCC</option>
                      </select>
                      <FieldError message={errors.cases?.court_body?.message} />
                    </label>
                    <InventorySourceField
                      label="Title of the Case"
                      value={generatedCaseTitle(selectedClients, caseType)}
                      source="Generated from the selected client records"
                    />
                    <TextInput
                      label="Case No."
                      registration={register("cases.case_no")}
                      error={errors.cases?.case_no?.message}
                    />
                    <TextInput
                      label="Regional Office"
                      registration={register("intake_record.region")}
                      readOnly
                    />
                    <TextInput
                      label="District Office"
                      registration={register("intake_record.district_office")}
                      error={errors.intake_record?.district_office?.message}
                      readOnly
                    />
                  </div>
                </section>

                <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
                  <h3 className="text-base font-semibold text-[#1F2937]">
                    I. Nature of the Case
                  </h3>
                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                    {natureOfCaseOptions.map((option) => (
                      <label
                        key={option}
                        className="flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563]"
                      >
                        <input
                          type="radio"
                          value={option}
                          {...register("intake_record.nature_of_case")}
                          className="h-4 w-4 border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
                        />
                        {option}
                      </label>
                    ))}
                  </div>
                  <FieldError
                    message={errors.intake_record?.nature_of_case?.message}
                  />
                </section>

                <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
                  <h3 className="text-base font-semibold text-[#1F2937]">
                    Applicant Case Involvement (Party Represented)
                  </h3>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {applicantRoleOptions.map((role) => (
                      <label
                        key={role}
                        className="flex min-h-10 items-center gap-2 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563]"
                      >
                        <input
                          type="radio"
                          value={role}
                          {...register("intake_record.applicant_role", {
                            onChange: () => {
                              partySelectionTouched.current = true;
                            },
                          })}
                          className="h-4 w-4 border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
                        />
                        {role}
                      </label>
                    ))}
                  </div>
                  <FieldError
                    message={errors.intake_record?.applicant_role?.message}
                  />
                  {applicantRole === "Others" && (
                    <div className="mt-3 max-w-md">
                      <TextInput
                        label="Specify Party Represented"
                        registration={register(
                          "intake_record.applicant_role_other",
                        )}
                        error={
                          errors.intake_record?.applicant_role_other?.message
                        }
                      />
                    </div>
                  )}
                </section>

                <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
                  <h3 className="text-base font-semibold text-[#1F2937]">
                    Cause of Action
                  </h3>
                  <div className="mt-3">
                    <TextArea
                      label="Cause of Action"
                      registration={register("cases.cause_of_action")}
                      error={errors.cases?.cause_of_action?.message}
                    />
                  </div>
                </section>

                <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
                  <h3 className="text-base font-semibold text-[#1F2937]">
                    Case Status
                  </h3>
                  <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <label className="block">
                      <span className="text-sm font-medium text-[#4B5563]">
                        Status of Case
                      </span>
                      <select
                        {...register("cases.status_of_case")}
                        className="mt-1 w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
                      >
                        <option>Pending</option>
                        <option>Terminated</option>
                      </select>
                    </label>
                    <TextInput
                      label="Last Action Taken"
                      registration={register("cases.last_action_taken")}
                      error={errors.cases?.last_action_taken?.message}
                    />
                    <label className="flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563]">
                      <input
                        type="checkbox"
                        {...register("cases.detained")}
                        className="h-4 w-4 rounded border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
                      />
                      Client is detained
                    </label>
                    {caseDetained && (
                      <>
                        <TextInput
                          label="Date of Confinement"
                          type="date"
                          registration={register("cases.date_of_confinement")}
                          error={errors.cases?.date_of_confinement?.message}
                        />
                        <TextInput
                          label="Place of Detention"
                          registration={register("cases.place_of_detention")}
                          error={errors.cases?.place_of_detention?.message}
                        />
                      </>
                    )}
                    <TextInput
                      label="Case Received"
                      type="date"
                      registration={register("intake_record.form_date")}
                      error={errors.intake_record?.form_date?.message}
                    />
                  </div>
                </section>

                <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
                  <h3 className="text-base font-semibold text-[#1F2937]">
                    Proof of Qualification
                  </h3>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563]">
                      <input
                        type="checkbox"
                        {...register("intake_record.proof_submission_satisfied")}
                        className="h-4 w-4 rounded border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
                      />
                      Will submit proof later
                    </label>
                    <TextInput
                      label="Submission Deadline (optional)"
                      type="date"
                      registration={register(
                        "intake_record.proof_submission_deadline",
                      )}
                      error={
                        errors.intake_record?.proof_submission_deadline?.message
                      }
                    />
                    <label className="flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563]">
                      <input
                        type="checkbox"
                        {...register("intake_record.proof_itr_satisfied")}
                        className="h-4 w-4 rounded border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
                      />
                      Income Tax Return / proof of income satisfied
                    </label>
                    <TextInput
                      label="ITR Date (optional)"
                      type="date"
                      registration={register("intake_record.proof_itr_date")}
                      error={errors.intake_record?.proof_itr_date?.message}
                    />
                    <label className="flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563]">
                      <input
                        type="checkbox"
                        {...register("intake_record.proof_brgy_satisfied")}
                        className="h-4 w-4 rounded border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
                      />
                      Barangay certification / indigency satisfied
                    </label>
                    <TextInput
                      label="Barangay Certification Date (optional)"
                      type="date"
                      registration={register("intake_record.proof_brgy_date")}
                      error={errors.intake_record?.proof_brgy_date?.message}
                    />
                    <label className="flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563]">
                      <input
                        type="checkbox"
                        {...register("intake_record.proof_dswd_satisfied")}
                        className="h-4 w-4 rounded border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
                      />
                      DSWD certification satisfied
                    </label>
                    <TextInput
                      label="DSWD Certification Date (optional)"
                      type="date"
                      registration={register("intake_record.proof_dswd_date")}
                      error={errors.intake_record?.proof_dswd_date?.message}
                    />
                    <label className="flex items-center gap-3 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm font-medium text-[#4B5563]">
                      <input
                        type="checkbox"
                        {...register("intake_record.proof_others_satisfied")}
                        className="h-4 w-4 rounded border-[#E5E7EB] text-[#704389] focus:ring-[#704389]"
                      />
                      Other accepted proof satisfied
                    </label>
                    <TextInput
                      label="Other Proof Date (optional)"
                      type="date"
                      registration={register("intake_record.proof_others_date")}
                      error={errors.intake_record?.proof_others_date?.message}
                    />
                    <div className="md:col-span-2">
                      <TextInput
                        label="Other Proof Details"
                        registration={register(
                          "intake_record.proof_others_details",
                        )}
                        error={
                          errors.intake_record?.proof_others_details?.message
                        }
                      />
                    </div>
                  </div>
                </section>

                <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
                  <h3 className="text-base font-semibold text-[#1F2937]">
                    Case Facts and Cause
                  </h3>
                  <div className="mt-3 grid gap-4">
                    <TextArea
                      label="Fact of the Case"
                      registration={register("cases.facts_of_case")}
                      error={errors.cases?.facts_of_case?.message}
                    />
                  </div>
                </section>
              </>
            )}

            <RepresentativeFieldsSection
              selectedClients={selectedClients}
              clientRepresentativeEntries={clientRepresentativeEntries}
              collapsedRepresentativeIds={collapsedRepresentativeIds}
              onToggleCollapse={toggleRepresentativeCollapse}
              register={register}
              errors={errors}
            />

            <section className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <h3 className="text-base font-semibold text-[#1F2937]">
                Incident Location
              </h3>
              <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <label className="block">
                  <span className="text-sm font-medium text-[#4B5563]">
                    Location Type
                  </span>
                  <select
                    {...register("cases.location_type")}
                    className="mt-1 w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
                  >
                    <option value="">Select location type</option>
                    <option>Urban</option>
                    <option>Rural</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-[#4B5563]">
                    Barangay
                  </span>
                  <select
                    {...register("cases.incident_barangay")}
                    disabled={!locationType}
                    className="mt-1 w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
                  >
                    <option value="">
                      {locationType
                        ? "Select barangay"
                        : "Select location type first"}
                    </option>
                    {filteredBarangays.map((barangay) => (
                      <option key={barangay}>{barangay}</option>
                    ))}
                  </select>
                </label>
                <TextInput
                  label="City"
                  registration={register("cases.incident_city")}
                  readOnly
                />
              </div>
            </section>
          </div>
        )}

        {isClassificationStep && (
          <ClassificationStep
            selectedClients={selectedClients}
            onViewClient={setViewingClient}
          />
        )}

        {isReviewStep && (
          <CaseReviewStep
            selectedClients={selectedClients}
            caseType={caseType}
            reviewValues={reviewValues}
            onViewClient={setViewingClient}
          />
        )}
      </div>

      <div className="sticky bottom-0 flex justify-between border-t border-[#E5E7EB] bg-white px-6 py-4 shadow-[0_-6px_18px_rgba(17,24,39,0.04)]">
        <button
          type="button"
          onClick={() => {
            setStep((current) => Math.max(current - 1, 0));
          }}
          disabled={step === 0}
          className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-medium text-[#4B5563] transition duration-200 hover:bg-[#E5E7EB] hover:text-[#2B3642] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Back
        </button>

        <div className="flex flex-wrap justify-end gap-2">
          {onCancel && (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onCancel}
              className="rounded-md border border-[#D1D5DB] bg-white px-4 py-2 text-sm font-semibold text-[#4B5563] transition duration-200 hover:bg-[#F3F4F6] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          {!lockedClient && step === 0 && (
            <button
              type="button"
              onClick={continueFromClient}
              className="rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white shadow-md transition duration-200 hover:bg-[#5F3675]"
            >
              Continue
            </button>
          )}
          {isCaseFormStep && requireReviewBeforeSubmit && (
            <button
              type="button"
              onClick={continueFromDetails}
              className="rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white shadow-md transition duration-200 hover:bg-[#5F3675]"
            >
              Continue
            </button>
          )}
          {isCaseFormStep && !requireReviewBeforeSubmit && (
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white shadow-md transition duration-200 hover:bg-[#5F3675]"
            >
              {isSubmitting ? "Saving…" : submitLabel}
            </button>
          )}
          {isReviewStep && (
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white shadow-md transition duration-200 hover:bg-[#5F3675]"
            >
              {isSubmitting ? "Saving…" : submitLabel}
            </button>
          )}
          {isClassificationStep && (
            <button
              type="button"
              onClick={continueToReview}
              className="rounded-md bg-[#704389] px-4 py-2 text-sm font-semibold text-white shadow-md transition duration-200 hover:bg-[#5F3675]"
            >
              Continue
            </button>
          )}
        </div>
      </div>
      <ClientInformationModal
        client={viewingClient}
        onClose={() => setViewingClient(null)}
      />
      {editingClient && onClientUpdated && (
        <ScannedIntakeEditModal
          client={editingClient}
          onClose={() => setEditingClient(null)}
          onSaved={onClientUpdated}
        />
      )}
    </form>
  );
}
