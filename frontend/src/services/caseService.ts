import type { CriminalCaseRecord } from "../types";
import { listCaseRecords } from "./recordService";

export async function getCases(): Promise<CriminalCaseRecord[]> {
  return listCaseRecords();
}
