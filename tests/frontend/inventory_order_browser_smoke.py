"""Render the criminal inventory form and verify Excel-aligned field order."""

import json
import base64
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / ".local" / "inventory-order"
OUTPUT.mkdir(parents=True, exist_ok=True)

schema = {
    "applicant_personal_circumstances": [
        ["name", "Pangalan"], ["age", "Edad"], ["sex", "Sex"], ["civil_status", "Civil Status"],
        ["religion", "Relihiyon"], ["educational_attainment", "Naabot na pag-aaral"],
        ["citizenship", "Pagkamamamayan"], ["language_dialect", "Salita/Dialekto"],
        ["address", "Tirahan"], ["contact_no", "Contact No."], ["email", "E-mail"],
        ["spouse_name", "Asawa"], ["individual_monthly_income", "Individual Monthly Income"],
        ["spouse_address", "Tirahan ng asawa"], ["detained", "Nakakulong"],
        ["spouse_contact_no", "Contact No. ng asawa"], ["detained_since", "Petsa ng pagakakulong"],
        ["place_of_detention", "Lugar ng Detention"],
    ],
    "representative_personal_circumstances": [
        ["name", "Pangalan"], ["age", "Edad"], ["sex", "Sex"], ["civil_status", "Civil Status"],
        ["address", "Tirahan"], ["contact_no", "Contact No."],
        ["relationship_to_applicant", "Relasyon sa aplikante"], ["email", "E-mail"],
    ],
}

sections = {
    "applicant_personal_circumstances": {
        key: ({"name": "Diana Sanaysay", "age": "31", "sex": "Female", "address": "Synthetic address, Panabo City", "contact_no": "0900-000-0000"}.get(key, ""))
        for key, _ in schema["applicant_personal_circumstances"]
    },
    "representative_personal_circumstances": {
        key: "" for key, _ in schema["representative_personal_circumstances"]
    },
}

client = {
    "client_id": "SYNTHETIC-CLIENT-001",
    "created_by_user_id": None,
    "client": {
        "name": "Diana Sanaysay",
        "age": 31,
        "sex": "Female",
        "email": "",
    },
    "client_details": {
        "religion": "",
        "citizenship": "Filipino",
        "address": "Synthetic address, Panabo City",
        "contact_no": "0900-000-0000",
        "dialect": "Cebuano",
        "education": "",
        "civil_status": "Single",
        "spouse": "",
        "spouse_address": "",
        "spouse_contact_no": "",
        "monthly_income": "",
        "representative_name": "",
        "representative_age": 0,
        "representative_sex": "",
        "representative_civil_status": "",
        "representative_address": "",
        "representative_contact_no": "",
        "representative_relationship": "",
        "representative_email": "",
        "detained": False,
        "detained_since": "",
        "place_of_detention": "",
    },
    "client_classification": {
        "flag_senior": False,
        "flag_cicl": False,
        "flag_female": True,
        "flag_urban": False,
        "flag_rural": False,
        "flag_drugs": False,
        "flag_foreign_national": False,
        "flag_vawc_victim": False,
        "flag_refugee_evacuee": False,
        "flag_law_enforcer": False,
        "flag_tenant_agrarian": False,
        "flag_ofw_land_based": False,
        "flag_ofw_sea_based": False,
        "flag_arrested_terrorism": False,
        "flag_indigenous_people": False,
        "flag_pwd": False,
        "flag_former_rebel_fve": False,
        "flag_torture_victim": False,
        "flag_trafficking_victim": False,
        "flag_voluntary_rehab_petitioner": False,
        "classification_notes": "",
    },
    "paper_intake": {
        "document_id": 77,
        "sections": sections,
        "checkbox_states": {
            "applicant_personal_circumstances.detained.oo": "unchecked",
            "applicant_personal_circumstances.detained.hindi": "checked",
        },
        "unreadable_fields": [],
        "candidate_snapshot": None,
        "field_reviews": None,
    },
}

mount = """async (client) => {
  const React = await import('/node_modules/.vite/deps/react.js');
  const ReactDOM = await import('/node_modules/.vite/deps/react-dom_client.js');
  const { CaseWorkflow } = await import('/src/components/modals/CaseWorkflow.tsx');
  const { ConfirmationProvider } = await import('/src/components/ConfirmationProvider.tsx');
  document.querySelector('#root').style.display = 'none';
  const container = document.createElement('main');
  container.id = 'inventory-order-smoke';
  container.className = 'mx-auto min-h-screen max-w-6xl bg-[#F8FAFC] p-4';
  document.body.appendChild(container);
  const root = (ReactDOM.createRoot || ReactDOM.default.createRoot)(container);
  const createElement = React.createElement || React.default.createElement;
  let currentClient = client;
  const render = () => root.render(createElement(ConfirmationProvider, null,
    createElement(CaseWorkflow, {
      clients: [currentClient],
      lockedClient: currentClient,
      caseType: 'Criminal',
      submitLabel: 'Save Criminal Case',
      onClientUpdated: updated => { window.__updatedClient = updated; currentClient = updated; render(); },
      onSubmit: values => { window.__inventorySubmission = values; }
    })
  ));
  render();
}"""

expected_labels = [
    "Control Number",
    "Party Represented",
    "Gender / Sex",
    "Title of the Case",
    "Court / Body",
    "Case No.",
    "Cause of Action",
    "Status of Case",
    "Last Action Taken",
    "Cause of Termination",
    "Date of Termination",
    "Urban / Rural",
    "Date of Confinement",
    "Place of Detention",
    "Case Received",
    "Address",
    "Contact Number",
]

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(
        headless=True,
        executable_path=r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    )
    page = browser.new_page(viewport={"width": 1400, "height": 1000})
    page.route("**/api/pao-intakes/schema", lambda route: route.fulfill(status=200, json=schema))
    page.route(
        "**/api/pao-intakes/documents/77",
        lambda route: route.fulfill(
            status=200,
            content_type="image/png",
            body=base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n2IAAAAASUVORK5CYII="),
        ),
    )

    def save_review(route):
        payload = route.request.post_data_json
        updated = json.loads(json.dumps(client))
        updated["paper_intake"]["sections"] = payload["sections"]
        updated["client_details"]["address"] = payload["sections"]["applicant_personal_circumstances"]["address"]
        updated["client_details"]["contact_no"] = payload["sections"]["applicant_personal_circumstances"]["contact_no"]
        route.fulfill(status=200, json=updated)

    page.route("**/api/pao-intakes/SYNTHETIC-CLIENT-001", save_review)
    page.goto("http://127.0.0.1:5173/login")
    page.wait_for_load_state("networkidle")
    page.evaluate(mount, client)

    section = page.get_by_test_id("criminal-inventory-fields")
    section.wait_for()
    rendered_labels = section.locator("span, legend, p").all_text_contents()
    rendered_labels = [text.strip() for text in rendered_labels]
    cursor = -1
    for label in expected_labels:
        cursor = rendered_labels.index(label, cursor + 1)

    assert section.get_by_text("Female", exact=True).count() == 1
    assert section.get_by_text("Synthetic address, Panabo City", exact=True).count() == 1
    assert section.get_by_text("0900-000-0000", exact=True).count() == 1
    assert page.get_by_text("Report heading", exact=True).count() == 1
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")
    page.screenshot(path=str(OUTPUT / "desktop.png"), full_page=True)

    page.get_by_role("button", name="Edit scanned Parts II and II-A").click()
    edit_dialog = page.get_by_role("dialog", name="Edit scanned PAO intake")
    edit_dialog.wait_for()
    address_input = edit_dialog.locator("#paper-applicant_personal_circumstances-address")
    address_input.fill("Corrected address from scan")
    page.screenshot(path=str(OUTPUT / "scan-edit-modal.png"), full_page=True)
    edit_dialog.get_by_role("button", name="Close").click()
    page.get_by_role("heading", name="Discard unsaved corrections?").wait_for()
    page.get_by_role("button", name="Cancel", exact=True).click()
    assert address_input.input_value() == "Corrected address from scan"
    edit_dialog.get_by_role("button", name="Save reviewed record").click()
    page.wait_for_function("Boolean(window.__updatedClient)")
    assert page.evaluate("window.__updatedClient.client_details.address") == "Corrected address from scan"
    edit_dialog.wait_for(state="detached")
    section.get_by_text("Corrected address from scan", exact=True).wait_for()
    section.get_by_text("Contact Number", exact=True).scroll_into_view_if_needed()
    page.screenshot(path=str(OUTPUT / "desktop-lower.png"), full_page=True)

    page.set_viewport_size({"width": 720, "height": 1000})
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1")
    section.get_by_text("Control Number", exact=True).scroll_into_view_if_needed()
    page.screenshot(path=str(OUTPUT / "narrow.png"), full_page=True)
    section.get_by_text("Contact Number", exact=True).scroll_into_view_if_needed()
    page.screenshot(path=str(OUTPUT / "narrow-lower.png"), full_page=True)

    page.get_by_label("Control Number").fill("SYNTHETIC-CONTROL-001")
    page.get_by_label("Accused", exact=True).check()
    page.get_by_label("Court / Body").fill("RTC Branch 34")
    page.get_by_label("Case No.").fill("SYNTHETIC-CASE-001")
    page.get_by_label("Cause of Action").fill("Synthetic cause for UI verification")
    page.get_by_label("Urban", exact=True).check()
    page.get_by_role("button", name="Save Criminal Case").click()
    page.wait_for_function("Boolean(window.__inventorySubmission)")
    submission = page.evaluate("window.__inventorySubmission")
    assert submission["intake_record"]["party_represented"] == "Accused"
    assert submission["cases"]["location_type"] == "Urban"
    assert submission["cases"]["detained"] is False

    print(json.dumps({
        "ordered_labels": expected_labels,
        "part_ii_values_visible": True,
        "desktop_no_horizontal_clipping": True,
        "narrow_no_horizontal_clipping": True,
        "scan_edit_saved_to_client": True,
        "discard_cancel_preserved_edit": True,
        "save_completed": True,
        "screenshots": [
            str(OUTPUT / "desktop.png"),
            str(OUTPUT / "desktop-lower.png"),
            str(OUTPUT / "narrow.png"),
            str(OUTPUT / "narrow-lower.png"),
            str(OUTPUT / "scan-edit-modal.png"),
        ],
    }))
    browser.close()
