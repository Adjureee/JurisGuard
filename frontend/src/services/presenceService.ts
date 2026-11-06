import { apiClient } from "../api/client";

export type PersonnelPresence = "Online" | "Away" | "Offline";

export async function sendPresenceHeartbeat(interacting: boolean) {
  await apiClient.post("/presence/heartbeat", { interacting });
}
