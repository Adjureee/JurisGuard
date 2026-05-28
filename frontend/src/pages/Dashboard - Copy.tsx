import MainLayout from "../layouts/MainLayout";
import { StatusBadge } from "../features/criminalCases/components/StatusBadge";
import { useCriminalCasesStore } from "../features/criminalCases/criminalCasesStore";
import { useAuth } from "../contexts/AuthContext";

const isTerminated = (status: string) => status.toLowerCase() === "terminated";

export default function Dashboard() {
  const { user } = useAuth();
  const cases = useCriminalCasesStore((state) => state.cases);
  const visibleCases =
    user?.role === "admin"
      ? cases
      : cases.filter((item) => item.created_by_user_id === user?.user_id);

  const terminatedCases = visibleCases.filter((item) => isTerminated(item.cases.status_of_case)).length;
  const ongoingCases = visibleCases.length - terminatedCases;

  return (
    <MainLayout>
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-[#2F80ED]">Overview</p>
          <h2 className="text-2xl font-bold text-[#111827]">Case Dashboard</h2>
        </div>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-[#E5E7EB] bg-white p-5 shadow-sm shadow-[#111827]/10">
          <p className="text-sm text-[#6B7280]">Total Criminal Cases</p>
          <h3 className="mt-2 text-3xl font-bold text-[#111827]">{visibleCases.length}</h3>
        </div>
        <div className="rounded-lg border border-[#E5E7EB] bg-white p-5 shadow-sm shadow-[#111827]/10">
          <p className="text-sm text-[#6B7280]">Ongoing Cases</p>
          <h3 className="mt-2 text-3xl font-bold text-[#111827]">{ongoingCases}</h3>
        </div>
        <div className="rounded-lg border border-[#E5E7EB] bg-white p-5 shadow-sm shadow-[#111827]/10">
          <p className="text-sm text-[#6B7280]">Terminated Cases</p>
          <h3 className="mt-2 text-3xl font-bold text-[#111827]">{terminatedCases}</h3>
        </div>
      </div>

      <div className="rounded-lg border border-[#E5E7EB] bg-white shadow-sm shadow-[#111827]/10">
        <div className="border-b border-[#E5E7EB] bg-white px-5 py-4">
          <h3 className="font-semibold text-[#111827]">Recent Criminal Cases</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 border-b border-[#E5E7EB] bg-[#F3F4F6] text-[#374151]">
              <tr>
                <th className="px-5 py-3 text-left font-semibold">Control No.</th>
                <th className="px-5 py-3 text-left font-semibold">Title</th>
                <th className="px-5 py-3 text-left font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB]">
              {visibleCases.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-5 py-8 text-center text-[#6B7280]">
                    No criminal cases recorded yet.
                  </td>
                </tr>
              ) : (
                visibleCases.slice(0, 8).map((item) => (
                  <tr key={item.case_id} className="bg-white hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-[#111827]">{item.intake_record.control_no}</td>
                    <td className="px-5 py-3 text-[#111827]">{item.cases.title_of_case}</td>
                    <td className="px-5 py-3">
                      <StatusBadge status={item.cases.status_of_case} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MainLayout>
  );
}
