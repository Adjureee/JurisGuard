import toast from "react-hot-toast";
import { CaseWorkflow } from "./CaseWorkflow";
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

  const visibleClients =
    user?.role === "admin"
      ? clients
      : clients.filter(
          (client) =>
            client.created_by_user_id === null || client.created_by_user_id === user?.user_id
        );

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#111827]/30 px-4 py-6 backdrop-blur-sm transition-opacity duration-200">
      <div className="max-h-[92vh] w-full max-w-6xl animate-[modalIn_200ms_ease-out] overflow-hidden rounded-lg border border-[#E5E7EB] bg-white shadow-2xl shadow-[#111827]/10">
        <div className="border-b border-[#E5E7EB] bg-[#F3F4F6] px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-[#111827]">Add Criminal Case</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-[#6B7280] transition duration-200 hover:bg-white hover:text-[#111827]"
            >
              Close
            </button>
          </div>
        </div>

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
  );
}
