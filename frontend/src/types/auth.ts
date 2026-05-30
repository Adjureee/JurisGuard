export type UserRole = "admin" | "staff";
export type ApprovalStatus = "pending" | "under_review" | "approved" | "rejected" | "suspended";

export interface AuthUser {
  user_id: number;
  email: string;
  role: UserRole;
  approval_status: ApprovalStatus;
  full_name: string;
  mfa_enabled: boolean;
  profile_image_path: string | null;
  profile_picture_path: string | null;
  profile_completed: boolean;
}

export interface RegisterPayload {
  full_name: string;
  email: string;
  password: string;
  employee_id_path: string;
}

export interface RegisterResponse {
  message: string;
}

export interface LoginPayload {
  email: string;
  password: string;
  otpCode?: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: "bearer";
}

export interface AdminUserListItem extends AuthUser {
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface UserProfile {
  full_name: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  suffix: string | null;
  mobile_number: string | null;
  address: string | null;
  sex: string | null;
  birth_date: string | null;
  profile_image_path: string | null;
  profile_picture_path: string | null;
  profile_completed: boolean;
}

export interface AdminUserDetails extends AdminUserListItem {
  profile: UserProfile;
}

