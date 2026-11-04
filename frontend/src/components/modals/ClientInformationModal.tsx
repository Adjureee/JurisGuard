import { useState, type ReactNode } from "react";
import type { ClientRecord } from "../../types";
import { useConfirmation } from "../ConfirmationProvider";
import ModalPortal from "./ModalPortal";
import { PaperIntakeReview } from '../../features/documentExtraction/PaperIntakeReview';

interface ClientInformationModalProps {
  client: ClientRecord | null;
  onClose: () => void;
  onSaved?: (client: ClientRecord) => void;
}

const classificationLabels: Array<[keyof ClientRecord["client_classification"], string]> = [
  ["flag_senior", "Senior Citizen"],
  ["flag_cicl", "Child in Conflict with the Law"],
  ["flag_female", "Female"],
  ["flag_urban", "Urban"],
  ["flag_rural", "Rural"],
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
];

function InfoTile({ label, value }: { label: string; value: string | number | boolean | null }) {
  return (
    <div className="rounded-md border border-[#E5E7EB] bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-[#2B3642]">
        {value === null ? 'Unknown' : typeof value === "boolean" ? (value ? "Yes" : "No") : value || "-"}
      </p>
    </div>
  );
}

function Section({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4">
      <h3 className="text-sm font-semibold text-[#2B3642]">{title}</h3>
      <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {children}
      </div>
    </section>
  );
}

export default function ClientInformationModal({
  client,
  onClose,
  onSaved,
}: ClientInformationModalProps) {
  const confirm = useConfirmation();
  const [dirty, setDirty] = useState(false);

  if (!client) return null;

  async function closePaperReview() {
    if (
      onSaved &&
      dirty &&
      !await confirm({
        title: "Discard unsaved corrections?",
        message: "Cancel to keep reviewing your corrections against the original scan.",
        confirmLabel: "Discard corrections",
      })
    ) return;
    setDirty(false);
    onClose();
  }

  if (client.paper_intake) return <ModalPortal>
    <div className="jurisguard-modal-overlay bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={onSaved ? "Edit scanned PAO intake" : "Reviewed PAO intake"}>
      <div className="flex h-[95dvh] w-full max-w-7xl flex-col overflow-hidden rounded-xl bg-white">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b p-4">
          <div className="min-w-0">
            <h2 className="font-semibold">{onSaved ? "Edit scanned Parts II and II-A" : "Reviewed PAO intake"}</h2>
            {onSaved && <p className="mt-1 text-sm text-slate-600">Compare corrections with the original scan before saving.</p>}
          </div>
          <button type="button" className="min-h-11 shrink-0 rounded border px-3 py-2" onClick={() => void closePaperReview()}>Close</button>
        </div>
        <PaperIntakeReview
          key={client.client_id}
          saved={client.paper_intake}
          clientId={onSaved ? client.client_id : undefined}
          onDirtyChange={onSaved ? setDirty : undefined}
          onSaved={onSaved ? updated => {
            setDirty(false);
            onSaved(updated);
            onClose();
          } : undefined}
        />
      </div>
    </div>
  </ModalPortal>;

  const selectedClassifications = classificationLabels
    .filter(([field]) => Boolean(client.client_classification[field]))
    .map(([, label]) => label);

  return (
    <ModalPortal>
      <div
        className="jurisguard-modal-overlay bg-black/70 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
      >
        <div className="jurisguard-modal-surface flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[#CBD5E1] bg-white shadow-xl">
          <div className="flex items-center justify-between gap-4 border-b border-[#E5E7EB] bg-[#F8FAFC] px-6 py-5">
            <div className="min-w-0">
              <p className="text-sm font-semibold uppercase tracking-wide text-[#704389]">
                Client Information
              </p>
              <h2 className="mt-1 truncate text-xl font-bold text-[#2B3642]">
                {client.client.name}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[#D1D5DB] bg-white px-4 py-2 text-sm font-semibold text-[#4B5563] transition hover:bg-[#F3F4F6]"
            >
              Close
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-white p-6">
            <Section title="Personal Information">
              <InfoTile label="Client ID" value={client.client_id} />
              <InfoTile label="Full Name" value={client.client.name} />
              <InfoTile label="Age" value={client.client.age} />
              <InfoTile label="Sex" value={client.client.sex} />
              <InfoTile label="Civil Status" value={client.client.civil_status} />
              <InfoTile label="Religion" value={client.client.religion} />
              <InfoTile
                label="Educational Attainment"
                value={client.client.educational_attainment}
              />
              <InfoTile label="Citizenship" value={client.client.citizenship} />
              <InfoTile
                label="Language / Dialect"
                value={client.client.language_dialect}
              />
            </Section>

            <Section title="Contact Information">
              <InfoTile label="Address" value={client.client_details.address} />
              <InfoTile label="Contact No." value={client.client_details.contact_no} />
              <InfoTile label="Email" value={client.client_details.email} />
              <InfoTile
                label="Individual Monthly Income"
                value={client.client_details.individual_monthly_income}
              />
              <InfoTile label="Detained" value={client.client_details.detained} />
              <InfoTile
                label="Detained Since"
                value={client.client_details.detained_since}
              />
              <InfoTile
                label="Place of Detention"
                value={client.client_details.place_of_detention}
              />
            </Section>

            <Section title="Spouse Information">
              <InfoTile label="Spouse" value={client.client_details.spouse} />
              <InfoTile
                label="Spouse Address"
                value={client.client_details.address_of_spouse}
              />
              <InfoTile
                label="Contact No. of Spouse"
                value={client.client_details.contact_no_of_spouse}
              />
            </Section>

            <Section title="Representative Information">
              <InfoTile
                label="Representative Name"
                value={client.client_details.representative_name}
              />
              <InfoTile
                label="Representative Age"
                value={client.client_details.representative_age}
              />
              <InfoTile
                label="Representative Sex"
                value={client.client_details.representative_sex}
              />
              <InfoTile
                label="Representative Civil Status"
                value={client.client_details.representative_civil_status}
              />
              <InfoTile
                label="Representative Address"
                value={client.client_details.representative_address}
              />
              <InfoTile
                label="Representative Contact"
                value={client.client_details.representative_contact_no}
              />
              <InfoTile
                label="Relationship to Applicant"
                value={client.client_details.representative_relationship}
              />
              <InfoTile
                label="Representative Email"
                value={client.client_details.representative_email}
              />
            </Section>

            <Section title="Applicant Classification">
              <InfoTile label="Female (reviewed evidence)" value={client.client_classification.flag_female ?? "Unresolved"} />
              <InfoTile label="Senior Citizen (reviewed evidence)" value={client.client_classification.flag_senior ?? "Unresolved"} />
              <InfoTile label="CICL (reviewed evidence)" value={client.client_classification.flag_cicl ?? "Unresolved"} />
              <div className="md:col-span-2 lg:col-span-3">
                <p className="rounded-md border border-[#E5E7EB] bg-white p-3 text-sm font-semibold text-[#2B3642]">
                  {selectedClassifications.join(", ") || "None selected"}
                </p>
              </div>
              <InfoTile
                label="Classification Notes"
                value={client.client_classification.classification_notes}
              />
            </Section>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
