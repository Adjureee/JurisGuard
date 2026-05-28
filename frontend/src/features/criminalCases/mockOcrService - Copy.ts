import type { ExtractedClientPayload, ExtractionMap } from "../../types";

const extractedPayload: ExtractedClientPayload = {
  client: {
    name: "Elena Reyes",
    age: 29,
    sex: "Female",
    civil_status: "Single",
    religion: "Catholic",
    educational_attainment: "College Level",
    citizenship: "Filipino",
    language_dialect: "Cebuano",
  },
  client_details: {
    address: "Mintal, Davao City",
    contact_no: "09184561234",
    email: "elena.reyes@example.com",
    individual_monthly_income: "15000",
    spouse: "",
    address_of_spouse: "",
    contact_no_of_spouse: "",
    representative_name: "Jose Reyes",
    representative_age: 31,
    representative_sex: "Male",
    representative_civil_status: "Married",
    representative_address: "Mintal, Davao City",
    representative_contact_no: "09184560001",
    representative_relationship: "Brother",
    representative_email: "jose.reyes@example.com",
    detained: false,
    detained_since: "",
    place_of_detention: "",
  },
  client_classification: {
    flag_senior: false,
    flag_cicl: false,
    flag_female: true,
    flag_urban: true,
    flag_rural: false,
    flag_drugs: false,
    flag_foreign_national: false,
    flag_vawc_victim: false,
    flag_refugee_evacuee: false,
    flag_law_enforcer: false,
    flag_tenant_agrarian: false,
    flag_ofw_land_based: false,
    flag_ofw_sea_based: false,
    flag_arrested_terrorism: false,
    flag_indigenous_people: false,
    flag_pwd: false,
    flag_former_rebel_fve: false,
    flag_torture_victim: false,
    flag_trafficking_victim: false,
    flag_voluntary_rehab_petitioner: false,
    classification_notes: "Mock OCR extracted ID and intake sheet values.",
  },
};

const indicatorKeys = [
  "client.name",
  "client.age",
  "client.sex",
  "client.civil_status",
  "client.religion",
  "client.educational_attainment",
  "client.citizenship",
  "client.language_dialect",
  "client_details.address",
  "client_details.contact_no",
  "client_details.email",
  "client_details.individual_monthly_income",
  "client_details.spouse",
  "client_details.address_of_spouse",
  "client_details.contact_no_of_spouse",
  "client_details.representative_name",
  "client_details.representative_age",
  "client_details.representative_sex",
  "client_details.representative_civil_status",
  "client_details.representative_address",
  "client_details.representative_contact_no",
  "client_details.representative_relationship",
  "client_details.representative_email",
  "client_details.detained",
  "client_details.detained_since",
  "client_details.place_of_detention",
  "client_classification.flag_senior",
  "client_classification.flag_cicl",
  "client_classification.flag_female",
  "client_classification.flag_urban",
  "client_classification.flag_rural",
  "client_classification.flag_drugs",
  "client_classification.flag_foreign_national",
  "client_classification.flag_vawc_victim",
  "client_classification.flag_refugee_evacuee",
  "client_classification.flag_law_enforcer",
  "client_classification.flag_tenant_agrarian",
  "client_classification.flag_ofw_land_based",
  "client_classification.flag_ofw_sea_based",
  "client_classification.flag_arrested_terrorism",
  "client_classification.flag_indigenous_people",
  "client_classification.flag_pwd",
  "client_classification.flag_former_rebel_fve",
  "client_classification.flag_torture_victim",
  "client_classification.flag_trafficking_victim",
  "client_classification.flag_voluntary_rehab_petitioner",
  "client_classification.classification_notes",
];

function getNestedValue(source: ExtractedClientPayload, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, source);
}

export async function runMockClientOcr(): Promise<{
  extracted: ExtractedClientPayload;
  indicators: ExtractionMap;
}> {
  await new Promise((resolve) => window.setTimeout(resolve, 550));

  const indicators = indicatorKeys.reduce<ExtractionMap>((result, key) => {
    const value = getNestedValue(extractedPayload, key);
    result[key] =
      value === "" || value === undefined || value === null ? "missing" : "extracted";
    return result;
  }, {});

  return {
    extracted: extractedPayload,
    indicators,
  };
}
