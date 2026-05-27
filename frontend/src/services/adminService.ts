import { apiClient } from "../api/client";
import type { AdminUserDetails, AdminUserListItem, ApprovalStatus } from "../types/auth";

export async function listApplicants(
  approvalStatus?: ApprovalStatus
): Promise<AdminUserListItem[]> {
  const response = await apiClient.get<AdminUserListItem[]>("/admin/verification", {
    params: approvalStatus ? { approval_status: approvalStatus } : undefined,
  });
  return response.data;
}

export async function getApplicant(userId: number): Promise<AdminUserDetails> {
  const response = await apiClient.get<AdminUserDetails>(`/admin/users/${userId}`);
  return response.data;
}

export async function updateApplicantApproval(
  userId: number,
  approvalStatus: ApprovalStatus
): Promise<AdminUserDetails> {
  const response = await apiClient.patch<AdminUserDetails>(`/admin/users/${userId}/approval`, {
    approval_status: approvalStatus,
  });
  return response.data;
}
