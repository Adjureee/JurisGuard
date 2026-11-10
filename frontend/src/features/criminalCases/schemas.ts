import { z } from "zod";

const requiredText = (label: string) =>
  z.string().trim().min(1, `${label} is required`);
const optionalText = z.string().trim();
const isValidIsoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
};
const optionalDate = z.string().trim().refine(
  (value) => value === "" || isValidIsoDate(value),
  "Enter a valid date",
);
const requiredDate = (label: string) => z.string().trim()
  .min(1, `${label} is required`)
  .refine(isValidIsoDate, "Enter a valid date");
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
const representativeDetailsSchema = z.object({
  rep_name: optionalText,
  rep_age: optionalNumber("Representative age"),
  rep_sex: z.enum(["", "Male", "Female"]),
  civil_status: z.enum([
    "", "Single", "Married", "Widowed", "Separated", "Annulled", "Divorced", "None",
  ]),
  rep_address: optionalText,
  rep_contact_no: z.string().trim().regex(/^\d{0,11}$/, "Enter up to 11 digits, or leave it empty."),
  relationship_to_applicant: optionalText,
  rep_email: z.string().trim().email("Enter a valid email").or(z.literal("")),
}).superRefine((representative, ctx) => {
  const provided = Boolean(
    representative.rep_name.trim() || representative.rep_age > 0 ||
    representative.rep_sex || representative.civil_status || representative.rep_address.trim() ||
    representative.rep_contact_no.trim() ||
    representative.relationship_to_applicant.trim() || representative.rep_email.trim(),
  );
  if (!provided || representative.civil_status === "None") return;
  if (!representative.rep_name.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rep_name"], message: "Representative name is required" });
  }
  if (!representative.civil_status) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["civil_status"], message: "Civil status is required" });
  }
});
const monthlyIncome = z
  .string()
  .trim()
  .regex(/^\d*$/, "Monthly income must contain numbers only")
  .max(9, "Monthly income is too large")
  .refine(
    (value) => value === "" || Number(value) <= 999999999,
    "Monthly income is too large",
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
    contact_no: requiredText("Contact number").regex(
      /^[0-9]{1,11}$/,
      "Contact number must contain up to 11 digits",
    ),
    email: z.string().trim().email("Enter a valid email").or(z.literal("")),
    individual_monthly_income: monthlyIncome,
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
    // Legacy client-level detention fields remain optional for existing records.
    // New detention data is collected and validated on the case instead.
    detained: z.boolean().optional(),
    detained_since: optionalText.optional(),
    place_of_detention: optionalText.optional(),
  }),
  client_classification: z.object({
    // These values require source evidence reviewed by a staff member.
    flag_senior: z.boolean().nullable(),
    flag_cicl: z.boolean().nullable(),
    flag_female: z.boolean().nullable(),
    flags_reviewed: z.boolean(),
    flag_urban: z.boolean().optional(),
    flag_rural: z.boolean().optional(),
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

const caseFormShape = {
    client_id: requiredText("Client"),
    client_ids: z.array(optionalText).optional(),
    case_type: z.enum(["Criminal", "Civil"]).optional(),
    intake_record: z.object({
      control_no: z
        .string()
        .trim()
        .min(1, "Control number is required")
        .regex(/^\d+$/, "Control number must contain numbers only")
        .max(11, "Control number must be at most 11 digits"),
      form_date: requiredDate("Form date"),
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
      rep_email: z.string().trim().email("Enter a valid email").or(z.literal("")),
    }),
    client_representatives: z.array(z.object({
      client_id: requiredText("Client"),
      representative: representativeDetailsSchema,
    })),
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
      date_of_confinement: optionalDate,
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
  };

const addCaseFormShape = {
  ...caseFormShape,
  intake_record: caseFormShape.intake_record
    .omit({ nature_of_request: true })
    .extend({ nature_of_case: optionalText }),
};

const criminalAddCaseFormShape = {
  ...addCaseFormShape,
  intake_record: addCaseFormShape.intake_record.omit({
    nature_of_case: true,
    party_represented: true,
    coi_agree_different_office: true,
    coi_agree_same_dept_appeal: true,
    coi_waive_right_to_complain: true,
    coi_trust_assigned_counsel: true,
    proof_submission_deadline: true,
    proof_submission_satisfied: true,
    proof_itr_satisfied: true,
    proof_itr_date: true,
    proof_brgy_satisfied: true,
    proof_brgy_date: true,
    proof_dswd_satisfied: true,
    proof_dswd_date: true,
    proof_others_satisfied: true,
    proof_others_details: true,
    proof_others_date: true,
    inv_plaintiff: true,
    inv_defendant: true,
    inv_oppositor: true,
    inv_petitioner: true,
    inv_respondent: true,
    inv_complainant: true,
    inv_accused: true,
    inv_others: true,
  }),
  cases: addCaseFormShape.cases.omit({
    case_status: true,
    incident_address: true,
    latitude: true,
    longitude: true,
    facts_of_case: true,
    pending_in_court: true,
    cause_of_termination: true,
    date_of_termination: true,
    assigned_pao: true,
    filing_date: true,
    hearing_schedule: true,
    remarks: true,
  }),
};

const refineCaseForm = (data: {
  intake_record: { applicant_role: string; applicant_role_other: string };
  cases: { detained?: boolean; date_of_confinement: string; place_of_detention: string };
}, ctx: z.RefinementCtx) => {
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
  };

export const caseFormSchema = z.object(caseFormShape).superRefine(refineCaseForm);
export const addCaseFormSchema = z.object(addCaseFormShape).superRefine((data, ctx) => {
  refineCaseForm(data, ctx);
  if (data.case_type === "Civil" && !data.intake_record.nature_of_case.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["intake_record", "nature_of_case"],
      message: "Nature of case is required",
    });
  }
});
export const criminalAddCaseFormSchema = z
  .object(criminalAddCaseFormShape)
  .superRefine(refineCaseForm);

export type ClientFormValues = z.infer<typeof clientFormSchema>;
export type CaseFormValues = z.infer<typeof caseFormSchema>;
export type CriminalAddCaseFormValues = z.infer<typeof criminalAddCaseFormSchema>;
type CivilAddCaseFormValues = z.infer<typeof addCaseFormSchema>;
// Civil-only fields are optional in shared state; the criminal resolver omits them.
export type AddCaseFormValues = Omit<CivilAddCaseFormValues, 'intake_record' | 'cases'> & {
  intake_record: CriminalAddCaseFormValues['intake_record'] & Partial<CivilAddCaseFormValues['intake_record']>;
  cases: CriminalAddCaseFormValues['cases'] & Partial<CivilAddCaseFormValues['cases']>;
};
type CivilAddCaseFormInput = z.input<typeof addCaseFormSchema>;
type CriminalAddCaseFormInput = z.input<typeof criminalAddCaseFormSchema>;
export type AddCaseFormInput = Omit<CivilAddCaseFormInput, 'intake_record' | 'cases'> & {
  intake_record: CriminalAddCaseFormInput['intake_record'] & Partial<CivilAddCaseFormInput['intake_record']>;
  cases: CriminalAddCaseFormInput['cases'] & Partial<CivilAddCaseFormInput['cases']>;
};
