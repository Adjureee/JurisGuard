"""Fictional demo generator. No real people, house locations, or legal outcomes.

Geographic labels/classifications: PSA PSGC barangay pages, verified 2026-11-06.
Puroks are invented for the demonstration, not verified household locations.
"""
from datetime import datetime, timedelta

BATCH = 'FICTIONAL-XI-20261106-V2'
AS_OF = datetime(2026, 11, 6, 9)
# barangay, locality, province (HUC is independent), classification, PSGC page code
PLACES = [
    ('New Visayas', 'Panabo City', 'Davao del Norte', 'Urban', '1102315000'),
    ('Mabunao', 'Panabo City', 'Davao del Norte', 'Rural', '1102315000'),
    ('Apokon', 'Tagum City', 'Davao del Norte', 'Urban', '1102319000'),
    ('Bincungan', 'Tagum City', 'Davao del Norte', 'Rural', '1102319000'),
    ('Aplaya', 'Digos City', 'Davao del Sur', 'Urban', '1102403000'),
    ('Balabag', 'Digos City', 'Davao del Sur', 'Rural', '1102403000'),
    ('Camanchiles', 'Matanao', 'Davao del Sur', 'Urban', '1102410000'),
    ('Asbang', 'Matanao', 'Davao del Sur', 'Rural', '1102410000'),
    ('Dahican', 'Mati City', 'Davao Oriental', 'Urban', '1102509000'),
    ('Dawan', 'Mati City', 'Davao Oriental', 'Rural', '1102509000'),
    ('Cabinuangan', 'New Bataan', 'Davao de Oro', 'Urban', '1108210000'),
    ('Kahayag', 'New Bataan', 'Davao de Oro', 'Rural', '1108210000'),
    ('Poblacion', 'Santa Maria', 'Davao Occidental', 'Urban', '1108604000'),
    ('Ogpao', 'Santa Maria', 'Davao Occidental', 'Rural', '1108604000'),
    ('Tibungco', 'Davao City', '', 'Urban', '1130700000'),
    ('Tawan-tawan', 'Davao City', '', 'Rural', '1130700000'),
]
SOURCES = {
    'geography': [f'https://psa.gov.ph/classification/psgc/barangays/{code}' for code in dict.fromkeys(p[4] for p in PLACES)],
    'facilities': [
        'https://pia.gov.ph/news/bjmp-xi-records-lower-jail-congestion-rate',
        'https://ntp.doh.gov.ph/view-facility/?id=12498',
        'https://ro11.dole.gov.ph/news/dole-xi-davao-del-sur-strengthens-livelihood-reintegration-for-pdls-through-multi-sectoral-coordination/',
        'https://depeddigoscity.org/storage/wp-content/uploads/2025/10/DM_CID_2025_498.pdf',
        'https://ro11.dole.gov.ph/news/persons-deprived-of-liberty-in-davao-city-launched-kaulian-bakeshop-and-cafe-through-dole-livelihood-program/',
    ],
    'verified_on': '2026-11-06',
}
MALE = 'Adrian Angelo Arnel Benjie Carlo Christian Daniel Dennis Edgar Emmanuel Ernesto Francis Gabriel Hector Ismael Jaime Joel Jonathan Joseph Joshua Julian Kenneth Leandro Lorenzo Manuel Marco Mario Miguel Noel Paolo Rafael Ramon Renato Ricardo Roberto Rogelio Ronald Ruben Salvador Samuel Vicente'.split()
FEMALE = 'Aileen Alma Ana Angela Anita April Bea Camille Carla Cecilia Clarissa Cristina Daisy Danica Diana Elena Elisa Evelyn Faith Felisa Gemma Grace Irene Janet Jasmin Jean Jessica Jocelyn Joanna Julia Karen Lea Leonila Lourdes Lucena Luningning Maribel Maricel Marissa May Mila Monica Nena Patricia Rachel Rebecca Regina Rhea Rosa Rosalie Rowena Teresa Vanessa'.split()
SURNAMES = 'Abad Abella Abesamis Agbayani Aguilar Alcantara Alonzo Amador Andaya Angeles Aquino Aranas Arevalo Arriola Asuncion Atienza Avila Bacalso Balagtas Balbuena Baluyot Bautista Belmonte Benitez Bernardo Borja Briones Caballero Cabral Cabrera Calamba Calderon Camacho Canlas Capistrano Carandang Carpio Castillo Castro Cordero Coronel Cruz Dalisay David Delgado Dimaculangan Domingo Duran Enriquez Escalante Escobar Espinoza Estrella Evangelista Fabella Fajardo Fernandez Flores Francisco Galang Garcia Gatdula Gonzales Guevarra Gutierrez Hernandez Ignacio Ildefonso Jimenez Lacson Lagman Laurel Lazaro Leal Leon Lim Lopez Lucero Macalinao Macapagal Magbanua Malabanan Manalo Manansala Marquez Mendoza Mercado Miranda Molina Montano Morales Navarro Nicolas Nolasco Ocampo Oliva Ong Ortega Pacheco Padilla Palma Panganiban Pascual Perez Pineda Ramos Reyes Rivera'.split()
CRIMINAL = ['Theft', 'Slight physical injuries', 'Malicious mischief', 'Estafa',
    'Reckless imprudence resulting in damage to property', 'Illegal possession of dangerous drugs',
    'Unjust vexation', 'Grave threats']
CIVIL = ['Support', 'Collection of sum of money', 'Ejectment', 'Damages',
    'Recovery of possession', 'Correction of civil registry entry']
EDUCATION = ['Elementary graduate', 'Grade 10', 'Senior high school graduate',
    'Vocational graduate', 'College undergraduate', 'College graduate']


def fixture(index):
    """Return a coherent fictional person and case; index is 1..100."""
    i = index - 1
    barangay, city, province, location, code = PLACES[i % len(PLACES)]
    sex = 'Male' if (i // 3) % 2 == 0 else 'Female'
    firsts = MALE if sex == 'Male' else FEMALE
    surname = SURNAMES[i % len(SURNAMES)]
    name = f'{firsts[(i * 7) % len(firsts)]} {SURNAMES[(i + 31) % len(SURNAMES)]} {surname}'
    criminal = i < 70
    category = CRIMINAL[i % len(CRIMINAL)] if criminal else CIVIL[(i - 70) % len(CIVIL)]
    minor = not criminal and i % 6 == 0
    age = 16 + i % 2 if minor else 19 + (i * 7) % 57
    if minor:
        category = 'Support'
    civil = 'Single' if age < 24 else ['Married', 'Single', 'Married', 'Separated', 'Widowed' if age >= 55 else 'Single'][i % 5]
    address = f'Purok {i // len(PLACES) + 1}, Brgy. {barangay}, {city}' + (f', {province}' if province else '')
    received = AS_OF - timedelta(days=32 + (i * 17) % 600)
    interview = received - timedelta(days=i % 4)
    terminated = i % 5 == 4
    closed = received + timedelta(days=19 + i % 11) if terminated else None
    eligible_facility = city in ('Panabo City', 'Tagum City', 'Digos City', 'Matanao', 'Davao City')
    detained = criminal and not terminated and eligible_facility and i % 3 != 1
    facility = ''
    if detained:
        facility = ('Panabo City Jail' if city == 'Panabo City' else
            'Tagum City District Jail' if city == 'Tagum City' else
            f'Digos City District Jail — {"Male" if sex == "Male" else "Female"} Dormitory' if city in ('Digos City', 'Matanao') else
            'Davao City Jail-Annex, Ma-a, Davao City')
    confined = interview - timedelta(days=2 + i % 9) if detained else None
    represented = detained or minor or i % 7 == 0
    rep = None
    if represented:
        relation = 'Mother' if minor else 'Daughter' if age >= 55 else 'Sister' if sex == 'Male' else 'Brother'
        rep_sex = 'Male' if relation == 'Brother' else 'Female'
        rep_firsts = MALE if rep_sex == 'Male' else FEMALE
        rep = dict(name=f'{rep_firsts[(i + 13) % len(rep_firsts)]} {surname}',
            age=age + 23 if minor else age - 28 if age >= 55 else age + 3,
            sex=rep_sex, civil_status='Married' if minor or i % 2 else 'Single',
            address=address, contact_no=f'000-111-{index:04}', relationship=relation,
            email=f'representative.{index:03}@example.invalid')
    education = 'Grade 10' if minor else EDUCATION[(i * 5) % len(EDUCATION)]
    income = '0' if minor or i % 13 == 0 else str([4500, 6200, 7500, 8500, 9800, 10500, 12000, 14500, 16800][i % 9])
    role = 'Accused' if criminal else 'Plaintiff' if category != 'Correction of civil registry entry' else 'Petitioner'
    title = f'People of the Philippines vs. {name}' if criminal else f'{name} — {category}'
    events = [(interview, f'Interview conducted with {rep["relationship"].lower() + " as representative" if rep else "applicant personally"}; eligibility documents reviewed.')]
    events.append((received, f'{category} matter received; case folder and court reference checked.'))
    actions = ['Prepared request for certified records', 'Reviewed documentary attachments',
        'Conferred with applicant about supporting evidence', 'Prepared draft responsive pleading',
        'Reviewed hearing notice and updated calendar', 'Followed up requested documents',
        'Prepared client for the next scheduled conference', 'Checked service of court notice']
    for step in range(1, 3 + i % 3):
        event_date = received + timedelta(days=step * (3 + i % 4))
        events.append((event_date, actions[(i + step * 3) % len(actions)] + '.'))
    resolution = (['Acquittal', 'Dismissal', 'Dismissal'][i % 3] if criminal else ['Compromise agreement', 'Judgment', 'Dismissal'][i % 3]) if terminated else ''
    if closed:
        events = [(date, action) for date, action in events if date < closed]
        events.append((closed, f'{resolution} recorded; disposition explained and case folder closed.'))
    last_date, last_action = events[-1]
    note = f'FICTIONAL DEMONSTRATION DATA [{BATCH}]. Not a real person, allegation, or court record. Test contacts are non-dialable. Interview: {interview:%Y-%m-%d}; received: {received:%Y-%m-%d}.'
    return dict(index=index, name=name, age=age, sex=sex, civil_status=civil,
        education=education, religion=['Roman Catholic', 'Protestant', 'Islam', 'Iglesia ni Cristo'][i % 4],
        language=['Cebuano; Filipino', 'Cebuano', 'Filipino; English', 'Cebuano; Mandaya'][i % 4],
        address=address, location=location, psgc_url=f'https://psa.gov.ph/classification/psgc/barangays/{code}',
        city=city, province=province, income=income, contact_no='' if i % 19 == 0 else f'000-000-{index:04}',
        email='' if i % 9 == 0 else f'intake.{index:03}@example.invalid', representative=rep,
        spouse=f'{(FEMALE if sex == "Male" else MALE)[(i + 11) % 40]} {surname}' if civil == 'Married' else 'N/A',
        category=category, case_type='Criminal' if criminal else 'Civil', role=role, title=title,
        control_no=f'DXI26-{index:04}', case_no=f'FIC-{"CR" if criminal else "CV"}-26-{index:04}',
        court=f'{"Regional Trial Court" if category in ("Illegal possession of dangerous drugs", "Support", "Correction of civil registry entry") else "Municipal Trial Court"}, {city}',
        interview=interview, received=received, terminated=terminated, closed=closed,
        status='Terminated' if terminated else 'Pending', detained=detained, confined=confined,
        facility=facility, resolution=resolution, events=events, last_date=last_date,
        last_action=f'{last_date:%b. %d, %Y} — {last_action}', note=note)


def validate(fixtures):
    assert len(fixtures) == 100
    for field in ('name', 'address', 'control_no', 'case_no'):
        assert len({row[field] for row in fixtures}) == 100, field
    for row in fixtures:
        assert row['interview'] <= row['received'] <= row['last_date'] <= AS_OF
        assert not row['detained'] or (row['case_type'] == 'Criminal' and not row['terminated'] and row['confined'] <= row['interview'] and row['facility'] and row['representative'])
        assert not row['terminated'] or row['closed'] == row['last_date']
        assert row['age'] >= 18 or (row['case_type'] == 'Civil' and row['representative'])
        assert row['representative'] is None or row['representative']['age'] >= 18
        assert all(date <= row['last_date'] for date, _ in row['events'])
    return True
