import toast from "react-hot-toast";
import { CaseWorkflow } from "./CaseWorkflow";
import ModalPortal from "./ModalPortal";
import { useAuth } from "../../contexts/AuthContext";
import { useAuditLogStore } from "../../features/auditLogs/auditLogStore";
import { useCriminalCasesStore } from "../../features/criminalCases/criminalCasesStore";
import { useNotificationStore } from "../../features/notifications/notificationStore";
import { createCaseRecord, listClientRecords } from "../../services/recordService";
import type { CaseType } from "../../types";

interface AddCaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  caseType?: CaseType;
}

export default function AddCaseModal({
  isOpen,
  onClose,
  caseType = "Criminal",
}: AddCaseModalProps) {
  const { user } = useAuth();
  const clients = useCriminalCasesStore((state) => state.clients);
  const setClients = useCriminalCasesStore((state) => state.setClients);
  const upsertCase = useCriminalCasesStore((state) => state.upsertCase);
  const addLog = useAuditLogStore((state) => state.addLog);
  const addNotification = useNotificationStore((state) => state.addNotification);

  if (!isOpen) return null;

  const visibleClients = clients;
  const caseLabel = `${caseType} Case`;

  return (
    <ModalPortal>
    <div className="jurisguard-modal-overlay bg-black/70 backdrop-blur-sm transition-opacity duration-200" role="dialog" aria-modal="true">
      <div className="jurisguard-modal-surface flex max-h-[92vh] w-full max-w-6xl animate-[modalIn_200ms_ease-out] flex-col overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#F8FAFC] shadow-xl">
        <div className="shrink-0 border-b border-[#E5E7EB] bg-white px-6 py-5">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-[#111827]">
                Add {caseLabel}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-[#4B5563] transition duration-200 hover:bg-[#E5E7EB] hover:text-[#2B3642]"
            >
              Close
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <CaseWorkflow
            clients={visibleClients}
            caseType={caseType}
            requireReviewBeforeSubmit={caseType === "Civil"}
            submitLabel={`Save ${caseLabel}`}
            onSubmit={async (values) => {
              const record = await createCaseRecord(values, caseType);
              upsertCase(record);
              try {
                setClients(await listClientRecords());
              } catch {
                // The case is already saved; the next page load will refresh clients.
              }
              addLog({
                userId: user?.user_id,
                user: user?.full_name || user?.email,
                action: "Create Case",
                module: "Cases",
                description: `${caseLabel} ${record.intake_record.control_no} attached to existing client`,
                entityType: "case",
                entityId: record.case_id,
              });
              addNotification({
                type: "case_created",
                userId: user?.user_id,
                title: "Case Update",
                message: `${caseLabel} attached`,
                redirectTo: `/${caseType === "Civil" ? "civil-cases" : "criminal-cases"}?case=${encodeURIComponent(record.case_id)}`,
                entityType: "case",
                entityId: record.case_id,
              });
              toast.success(`${caseLabel} attached`);
              onClose();
            }}
          />
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

