import { apiClient } from "../api/client";

export type PersonnelPresence = "Online" | "Away" | "Offline";

export interface OfficePersonnelMember {
  user_id: number;
  full_name: string;
  profile_image_path: string | null;
  designation: "Attorney" | "Administrator" | "Admin Staff";
  presence: PersonnelPresence;
}

export interface PersonnelRoleSummary {
  active: number;
  online: number;
}

export interface OfficePersonnelOverview {
  summary: {
    attorneys: PersonnelRoleSummary;
    administrators: PersonnelRoleSummary;
    admin_staff?: PersonnelRoleSummary;
  };
  personnel: OfficePersonnelMember[];
}

export async function sendPresenceHeartbeat(interacting: boolean) {
  await apiClient.post("/presence/heartbeat", { interacting });
}

export async function getOfficePersonnelOverview() {
  const response = await apiClient.get<OfficePersonnelOverview>("/admin/personnel-overview");
  return response.data;
}
