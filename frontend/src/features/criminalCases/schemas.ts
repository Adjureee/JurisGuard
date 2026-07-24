import { z } from "zod";

const requiredText = (label: string) =>
  z.string().trim().min(1, `${label} is required`);
const optionalText = z.string().trim();
const optionalNumber = (label: string) =>
  z.preprocess(
    (value) => {
      if (value === "" || value === null || value === undefined)
        return 0;
      if (typeof value === "number" && Number.isNaN(value)) return 0;
      return value;
    },
    z.number().int().min(0, `${label} must be 0 or higher`),
  );

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
    individual_monthly_income: optionalText,
    spouse: optionalText,
    address_of_spouse: optionalText,
    contact_no_of_spouse: optionalText,
    representative_name: optionalText,
    representative_age: optionalNumber("Representative age"),
    representative_sex: optionalText,
    representative_civil_status: optionalText,
    representative_address: optionalText,
    representative_contact_no: optionalText,
    representative_relationship: optionalText,
    representative_email: z
      .string()
      .trim()
      .email("Enter a valid email")
      .or(z.literal("")),
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

export const caseFormSchema = z
  .object({
    client_id: requiredText("Client"),
    intake_record: z.object({
      control_no: requiredText("Control number"),
      form_date: requiredText("Form date"),
      region: optionalText,
      district_office: requiredText("District office"),
      party_represented: optionalText,
      applicant_role: requiredText("Applicant case involvement"),
      applicant_role_other: optionalText,
      nature_of_request: requiredText("Nature of request"),
      nature_of_case: requiredText("Nature of case"),
      coi_agree_different_office: z.boolean(),
      coi_agree_same_dept_appeal: z.boolean(),
      coi_waive_right_to_complain: z.boolean(),
      coi_trust_assigned_counsel: z.boolean(),
      proof_submission_deadline: optionalText,
      proof_submission_satisfied: z.boolean().optional(),
      proof_itr_satisfied: z.boolean().optional(),
      proof_itr_date: optionalText,
      proof_brgy_satisfied: z.boolean().optional(),
      proof_brgy_date: optionalText,
      proof_dswd_satisfied: z.boolean().optional(),
      proof_dswd_date: optionalText,
      proof_others_satisfied: z.boolean().optional(),
      proof_others_details: optionalText,
      proof_others_date: optionalText,
      inv_plaintiff: z.boolean(),
      inv_defendant: z.boolean(),
      inv_oppositor: z.boolean(),
      inv_petitioner: z.boolean(),
      inv_respondent: z.boolean(),
      inv_complainant: z.boolean(),
      inv_accused: z.boolean(),
      inv_others: optionalText,
    }),
    representative: z.object({
      rep_name: optionalText,
      rep_age: optionalNumber("Representative age"),
      rep_sex: optionalText,
      civil_status: optionalText,
      rep_address: optionalText,
      rep_contact_no: optionalText,
      relationship_to_applicant: optionalText,
    }),
    adverse_party: z.object({
      role: optionalText,
      name: optionalText,
      address: optionalText,
    }),
    cases: z.object({
      title_of_case: optionalText,
      case_no: requiredText("Case number"),
      court_body: requiredText("Court / body"),
      status_of_case: z.enum(["Pending", "Terminated"]),
      case_status: optionalText,
      incident_barangay: optionalText,
      incident_city: optionalText,
      incident_address: optionalText,
      latitude: optionalText,
      longitude: optionalText,
      last_action_taken: requiredText("Last action taken"),
      detained: z.boolean().optional(),
      date_of_confinement: optionalText,
      place_of_detention: optionalText,
      location_type: z.enum(["Urban", "Rural", ""]),
      cause_of_action: requiredText("Cause of action"),
      facts_of_case: requiredText("Facts of case"),
      pending_in_court: z.boolean(),
      cause_of_termination: optionalText,
      date_of_termination: optionalText,
      assigned_pao: optionalText,
      filing_date: optionalText,
      hearing_schedule: optionalText,
      remarks: optionalText,
    }),
  })
  .superRefine((data, ctx) => {
    if (
      data.intake_record.applicant_role === "Others" &&
      !data.intake_record.applicant_role_other.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["intake_record", "applicant_role_other"],
        message: "Specify role is required",
      });
    }
    const representativeNotApplicable =
      data.representative.civil_status.trim().toLowerCase() === "none";
    if (!representativeNotApplicable) {
      (
        [
          ["rep_name", "Representative name is required"],
          ["rep_sex", "Representative sex is required"],
          ["civil_status", "Civil status is required"],
          ["rep_address", "Representative address is required"],
          ["rep_contact_no", "Representative contact number is required"],
          ["relationship_to_applicant", "Relationship to applicant is required"],
        ] as const
      ).forEach(([field, message]) => {
        if (!data.representative[field].trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["representative", field],
            message,
          });
        }
      });
    }
    if (data.cases.detained) {
      if (!data.cases.date_of_confinement.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cases", "date_of_confinement"],
          message: "Date of detention is required",
        });
      }
      if (!data.cases.place_of_detention.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cases", "place_of_detention"],
          message: "Place of detention is required",
        });
      }
    }
  });

export type ClientFormValues = z.infer<typeof clientFormSchema>;
export type CaseFormValues = z.infer<typeof caseFormSchema>;
