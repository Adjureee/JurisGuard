import { z } from "zod";

const requiredText = (label: string) => z.string().trim().min(1, `${label} is required`);
const optionalText = z.string().trim();

export const clientFormSchema = z.object({
  client: z.object({
    name: requiredText("Name"),
    age: z.number().int().min(0, "Age must be 0 or higher"),
    sex: requiredText("Sex"),
    civil_status: requiredText("Civil status"),
    religion: requiredText("Religion"),
    educational_attainment: requiredText("Educational attainment"),
    citizenship: requiredText("Citizenship"),
    language_dialect: requiredText("Language / dialect"),
  }),
  client_details: z.object({
    address: requiredText("Address"),
    contact_no: requiredText("Contact number"),
    email: z.string().trim().email("Enter a valid email").or(z.literal("")),
    individual_monthly_income: requiredText("Individual monthly income"),
    spouse: optionalText,
    address_of_spouse: optionalText,
    contact_no_of_spouse: optionalText,
    representative_name: optionalText,
    representative_age: z.number().int().min(0, "Age must be 0 or higher"),
    representative_sex: optionalText,
    representative_civil_status: optionalText,
    representative_address: optionalText,
    representative_contact_no: optionalText,
    representative_relationship: optionalText,
    representative_email: z.string().trim().email("Enter a valid email").or(z.literal("")),
    detained: z.boolean(),
    detained_since: optionalText,
    place_of_detention: optionalText,
  }),
  client_classification: z.object({
    flag_senior: z.boolean(),
    flag_cicl: z.boolean(),
    flag_female: z.boolean(),
    flag_urban: z.boolean(),
    flag_rural: z.boolean(),
    flag_drugs: z.boolean(),
    flag_foreign_national: z.boolean(),
    flag_vawc_victim: z.boolean(),
    flag_refugee_evacuee: z.boolean(),
    flag_law_enforcer: z.boolean(),
    flag_tenant_agrarian: z.boolean(),
    flag_ofw_land_based: z.boolean(),
    flag_ofw_sea_based: z.boolean(),
    flag_arrested_terrorism: z.boolean(),
    flag_indigenous_people: z.boolean(),
    flag_pwd: z.boolean(),
    flag_former_rebel_fve: z.boolean(),
    flag_torture_victim: z.boolean(),
    flag_trafficking_victim: z.boolean(),
    flag_voluntary_rehab_petitioner: z.boolean(),
    classification_notes: optionalText,
  }),
});

export const caseFormSchema = z.object({
  client_id: requiredText("Client"),
  intake_record: z.object({
    control_no: requiredText("Control number"),
    form_date: requiredText("Form date"),
    region: requiredText("Region"),
    district_office: requiredText("District office"),
    party_represented: requiredText("Party represented"),
    applicant_role: requiredText("Applicant case involvement"),
    applicant_role_other: optionalText,
    nature_of_request: requiredText("Nature of request"),
    nature_of_case: requiredText("Nature of case"),
  }),
  representative: z.object({
    rep_name: requiredText("Representative name"),
    rep_age: z.number().int().min(0, "Age must be 0 or higher"),
    rep_sex: requiredText("Representative sex"),
    civil_status: requiredText("Civil status"),
    rep_address: requiredText("Representative address"),
    rep_contact_no: requiredText("Representative contact number"),
    relationship_to_applicant: requiredText("Relationship to applicant"),
  }),
  adverse_party: z.object({
    role: requiredText("Adverse party role"),
    name: requiredText("Adverse party name"),
    address: requiredText("Adverse party address"),
  }),
  cases: z.object({
    title_of_case: optionalText,
    case_no: optionalText,
    court_body: optionalText,
    status_of_case: z.enum(["Pending", "Ongoing", "Active", "Terminated", "Archived"]),
    last_action_taken: requiredText("Last action taken"),
    date_of_confinement: optionalText,
    place_of_detention: optionalText,
    location_type: z.enum(["Urban", "Rural", ""]),
    cause_of_action: requiredText("Cause of action"),
    facts_of_case: requiredText("Facts of case"),
    pending_in_court: z.boolean(),
    cause_of_termination: optionalText,
    date_of_termination: optionalText,
  }),
}).superRefine((data, ctx) => {
  if (data.intake_record.applicant_role === "Others" && !data.intake_record.applicant_role_other.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["intake_record", "applicant_role_other"],
      message: "Specify role is required",
    });
  }
  if (data.cases.pending_in_court) {
    if (!data.cases.title_of_case.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cases", "title_of_case"],
        message: "Title of case is required",
      });
    }
    if (!data.cases.case_no.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cases", "case_no"],
        message: "Docket number is required",
      });
    }
    if (!data.cases.court_body.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cases", "court_body"],
        message: "Court / body / tribunal is required",
      });
    }
  }
});

export type ClientFormValues = z.infer<typeof clientFormSchema>;
export type CaseFormValues = z.infer<typeof caseFormSchema>;
