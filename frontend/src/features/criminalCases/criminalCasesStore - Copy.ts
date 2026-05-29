import { create } from "zustand";
import type { ClientRecord, CriminalCaseRecord } from "../../types";
import type { CaseFormValues, ClientFormValues } from "./schemas";

interface CriminalCasesState {
  clients: ClientRecord[];
  cases: CriminalCaseRecord[];
  setClients: (clients: ClientRecord[]) => void;
  setCases: (cases: CriminalCaseRecord[]) => void;
  upsertClient: (client: ClientRecord) => void;
  upsertCase: (record: CriminalCaseRecord) => void;
  addClient: (values: ClientFormValues, createdByUserId?: number | null) => ClientRecord;
  addCase: (values: CaseFormValues, createdByUserId?: number | null) => CriminalCaseRecord;
}

const nextClientId = (count: number) => `CL-2026-${String(count + 1).padStart(3, "0")}`;
const nextCaseId = (count: number) => `CASE-2026-${String(count + 1).padStart(3, "0")}`;

export const useCriminalCasesStore = create<CriminalCasesState>((set, get) => ({
  clients: [],
  cases: [],
  setClients: (clients) => set({ clients }),
  setCases: (cases) => set({ cases }),
  upsertClient: (client) => {
    set((state) => ({
      clients: [client, ...state.clients.filter((item) => item.client_id !== client.client_id)],
    }));
  },
  upsertCase: (record) => {
    set((state) => ({
      cases: [record, ...state.cases.filter((item) => item.case_id !== record.case_id)],
    }));
  },
  addClient: (values, createdByUserId = null) => {
    const client_id = nextClientId(get().clients.length);
    const client: ClientRecord = {
      client_id,
      created_by_user_id: createdByUserId,
      client: {
        client_id,
        ...values.client,
      },
      client_details: values.client_details,
      client_classification: values.client_classification,
    };

    set((state) => ({ clients: [client, ...state.clients] }));
    return client;
  },
  addCase: (values, createdByUserId = null) => {
    const record: CriminalCaseRecord = {
      case_id: nextCaseId(get().cases.length),
      client_id: values.client_id,
      created_by_user_id: createdByUserId,
      intake_record: values.intake_record,
      representative: values.representative,
      adverse_party: values.adverse_party,
      cases: values.cases,
      last_updated: new Date().toISOString().slice(0, 10),
    };

    set((state) => ({ cases: [record, ...state.cases] }));
    return record;
  },
}));

