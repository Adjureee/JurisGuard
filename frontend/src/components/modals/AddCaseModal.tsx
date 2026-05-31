import toast from "react-hot-toast";
import { CaseWorkflow } from "./CaseWorkflow";
import ModalPortal from "./ModalPortal";
import { useAuth } from "../../contexts/AuthContext";
import { useAuditLogStore } from "../../features/auditLogs/auditLogStore";
import { useCriminalCasesStore } from "../../features/criminalCases/criminalCasesStore";
import { useNotificationStore } from "../../features/notifications/notificationStore";
import { createCaseRecord } from "../../services/recordService";

interface AddCaseModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AddCaseModal({ isOpen, onClose }: AddCaseModalProps) {
  const { user } = useAuth();
  const clients = useCriminalCasesStore((state) => state.clients);
  const upsertCase = useCriminalCasesStore((state) => state.upsertCase);
  const addLog = useAuditLogStore((state) => state.addLog);
  const addNotification = useNotificationStore((state) => state.addNotification);

  if (!isOpen) return null;

  const visibleClients = clients;

  return (
    <ModalPortal>
    <div className="jurisguard-modal-overlay bg-black/70 backdrop-blur-sm transition-opacity duration-200" role="dialog" aria-modal="true">
      <div className="jurisguard-modal-surface flex max-h-[92vh] w-full max-w-6xl animate-[modalIn_200ms_ease-out] flex-col overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-xl">
        <div className="shrink-0 border-b border-[#E5E7EB] bg-[#F8FAFC] px-6 py-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-[#2B3642]">Add Criminal Case</h2>
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
            onSubmit={async (values) => {
              const record = await createCaseRecord(values);
              upsertCase(record);
              addLog({
                userId: user?.user_id,
                user: user?.full_name || user?.email,
                action: "Create Case",
                module: "Cases",
                description: `Case ${record.intake_record.control_no} attached to existing client`,
                entityType: "case",
                entityId: record.case_id,
              });
              addNotification({
                type: "case_created",
                userId: user?.user_id,
                title: "Case Update",
                message: "Case attached",
                redirectTo: `/criminal-cases?case=${encodeURIComponent(record.case_id)}`,
                entityType: "case",
                entityId: record.case_id,
              });
              toast.success("Case attached");
              onClose();
            }}
          />
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}

