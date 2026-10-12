import { apiClient } from "../api/client";
import type { AdminUserDetails, AdminUserListItem, ApprovalStatus } from "../types/auth";

export interface UnresolvedClientOwner {
  client_id: number;
  name: string;
  created_at: string | null;
  interviewers: Array<{ user_id: number; full_name: string }>;
  case_ids: number[];
}

export interface OwnerCandidate {
  user_id: number;
  full_name: string;
  email: string;
}

export async function listUnresolvedClientOwners(): Promise<UnresolvedClientOwner[]> {
  const response = await apiClient.get<UnresolvedClientOwner[]>("/admin/clients/unresolved-owners");
  return response.data;
}

export async function listOwnerCandidates(): Promise<OwnerCandidate[]> {
  const response = await apiClient.get<OwnerCandidate[]>("/admin/clients/owner-candidates");
  return response.data;
}

export async function resolveClientOwner(clientId: number, ownerUserId: number, reason: string, evidenceReference: string) {
  const response = await apiClient.post(`/admin/clients/${clientId}/resolve-owner`, {
    owner_user_id: ownerUserId,
    reason,
    evidence_reference: evidenceReference,
  });
  return response.data;
}

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

