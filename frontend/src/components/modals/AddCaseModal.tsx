import { useEffect } from "react";
import toast from "react-hot-toast";
import { useConfirmation } from "../ConfirmationProvider";
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
  const confirm = useConfirmation();
  const { user } = useAuth();
  const clients = useCriminalCasesStore((state) => state.clients);
  const setClients = useCriminalCasesStore((state) => state.setClients);
  const upsertCase = useCriminalCasesStore((state) => state.upsertCase);
  const addLog = useAuditLogStore((state) => state.addLog);
  const addNotification = useNotificationStore((state) => state.addNotification);

  useEffect(() => {
    if (!isOpen) return;
    let isCancelled = false;
    listClientRecords()
      .then((records) => {
        if (!isCancelled) {
          setClients(records);
        }
      })
      .catch(() => {
        // Fall back to existing cached clients in store
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, setClients]);

  if (!isOpen) return null;

  const visibleClients = clients;
  const caseLabel = `${caseType} Case`;

  const handleCancel = async () => {
    if (
      !(await confirm({
        title: "Discard unsaved entry?",
        message: `Your ${caseLabel.toLowerCase()} entry has not been saved. Cancel to keep working.`,
        confirmLabel: "Discard entry",
      }))
    ) {
      return;
    }
    onClose();
  };

  return (
    <ModalPortal>
    <div className="jurisguard-modal-overlay bg-black/70 backdrop-blur-sm transition-opacity duration-200" role="dialog" aria-modal="true" aria-label={`Add ${caseLabel}`}>
      <div className="jurisguard-modal-surface flex max-h-[92vh] w-full max-w-6xl animate-[modalIn_200ms_ease-out] flex-col overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#F8FAFC] shadow-xl">
        <header className="shrink-0 border-b border-[#5F3675] bg-[#704389] px-6 py-4 text-white">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-white/80">
                Manual Input
              </p>
              <h2 className="text-xl font-bold text-white">
                Add {caseLabel}
              </h2>
              <p className="mt-1 text-sm text-white/85">
                Manually enter a new {caseType.toLowerCase()} case and its associated client information.
              </p>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1">
          <CaseWorkflow
            clients={visibleClients}
            caseType={caseType}
            requireReviewBeforeSubmit={caseType === "Civil"}
            submitLabel={`Save ${caseLabel}`}
            onCancel={() => void handleCancel()}
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

