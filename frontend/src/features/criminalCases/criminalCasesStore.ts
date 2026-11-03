import { create } from "zustand";
import type { ClientRecord, CriminalCaseRecord } from "../../types";

interface CriminalCasesState {
  clients: ClientRecord[];
  cases: CriminalCaseRecord[];
  clearRecords: () => void;
  setClients: (clients: ClientRecord[]) => void;
  setCases: (cases: CriminalCaseRecord[]) => void;
  upsertClient: (client: ClientRecord) => void;
  upsertCase: (record: CriminalCaseRecord) => void;
}

export const useCriminalCasesStore = create<CriminalCasesState>((set) => ({
  clients: [],
  cases: [],
  clearRecords: () => set({ clients: [], cases: [] }),
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
}));

