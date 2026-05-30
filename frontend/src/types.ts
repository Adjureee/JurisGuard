export type CaseStatus = "Pending" | "Ongoing" | "Active" | "Terminated" | "Archived";
export type IntakeMethod = "manual" | "camera" | "upload";
export type ExtractionStatus = "extracted" | "missing";

export interface Client {
  client_id: string;
  name: string;
  age: number;
  sex: string;
  civil_status: string;
  religion: string;
  educational_attainment: string;
  citizenship: string;
  language_dialect: string;
}

export interface ClientDetails {
  address: string;
  contact_no: string;
  email: string;
  individual_monthly_income: string;
  spouse: string;
  address_of_spouse: string;
  contact_no_of_spouse: string;
  representative_name: string;
  representative_age: number;
  representative_sex: string;
  representative_civil_status: string;
  representative_address: string;
  representative_contact_no: string;
  representative_relationship: string;
  representative_email: string;
  detained: boolean;
  detained_since: string;
  place_of_detention: string;
}

export interface ClientClassification {
  flag_senior: boolean;
  flag_cicl: boolean;
  flag_female: boolean;
  flag_urban: boolean;
  flag_rural: boolean;
  flag_drugs: boolean;
  flag_foreign_national: boolean;
  flag_vawc_victim: boolean;
  flag_refugee_evacuee: boolean;
  flag_law_enforcer: boolean;
  flag_tenant_agrarian: boolean;
  flag_ofw_land_based: boolean;
  flag_ofw_sea_based: boolean;
  flag_arrested_terrorism: boolean;
  flag_indigenous_people: boolean;
  flag_pwd: boolean;
  flag_former_rebel_fve: boolean;
  flag_torture_victim: boolean;
  flag_trafficking_victim: boolean;
  flag_voluntary_rehab_petitioner: boolean;
  classification_notes: string;
}

export interface ClientRecord {
  client_id: string;
  created_by_user_id: number | null;
  client: Client;
  client_details: ClientDetails;
  client_classification: ClientClassification;
}

export interface IntakeRecord {
  control_no: string;
  form_date: string;
  region: string;
  district_office: string;
  party_represented: string;
  applicant_role: string;
  applicant_role_other: string;
  nature_of_request: string;
  nature_of_case: string;
  coi_agree_different_office: boolean;
  coi_agree_same_dept_appeal: boolean;
  coi_waive_right_to_complain: boolean;
  coi_trust_assigned_counsel: boolean;
  proof_submission_deadline: string;
  proof_itr_date: string;
  proof_brgy_date: string;
  proof_dswd_date: string;
  proof_others_details: string;
  proof_others_date: string;
  inv_plaintiff: boolean;
  inv_defendant: boolean;
  inv_oppositor: boolean;
  inv_petitioner: boolean;
  inv_respondent: boolean;
  inv_complainant: boolean;
  inv_accused: boolean;
  inv_others: string;
}

export interface Representative {
  rep_name: string;
  rep_age: number;
  rep_sex: string;
  civil_status: string;
  rep_address: string;
  rep_contact_no: string;
  relationship_to_applicant: string;
}

export interface AdverseParty {
  role: string;
  name: string;
  address: string;
}

export interface CaseDetails {
  title_of_case: string;
  case_no: string;
  court_body: string;
  status_of_case: CaseStatus;
  last_action_taken: string;
  date_of_confinement: string;
  place_of_detention: string;
  location_type: "Urban" | "Rural" | "";
  cause_of_action: string;
  facts_of_case: string;
  pending_in_court: boolean;
  cause_of_termination: string;
  date_of_termination: string;
}

export interface CriminalCaseRecord {
  case_id: string;
  client_id: string;
  created_by_user_id: number | null;
  intake_record: IntakeRecord;
  representative: Representative;
  adverse_party: AdverseParty;
  cases: CaseDetails;
  last_updated: string;
}

export interface ExtractedClientPayload {
  client: Partial<Omit<Client, "client_id">>;
  client_details: Partial<ClientDetails>;
  client_classification: Partial<ClientClassification>;
}

export type ExtractionMap = Record<string, ExtractionStatus>;

export interface TokenResponse {
  access_token: string;
  token_type: string;
}
