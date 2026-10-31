"""Conservative, positional reading of the printed PAO applicant block.

OCR candidates remain evidence, not verified facts. Never repair names or places
using dictionaries or previous cases.
"""
import re


FIELDS = {
    'applicant_name': r'Pangalan\s*:',
    'applicant_religion': r'Reli\w+\s*:',
    'applicant_citizenship': r'Pagkamamamayan\s*:',
    'applicant_address': r'Tirahan\s*:',
    'applicant_email': r'E[ -]?mail\w*\s*:',
    'individual_monthly_income': r'Individual Monthly Income\s*:',
    'detained_since': r'Petsa ng pag\w+\s*:',
    'applicant_age': r'Edad\s*:',
    'applicant_sex': r'Sex\s*:',
    'applicant_civil_status': r'Civil Status\s*:',
    'applicant_educational_attainment': r'Naabot na pag[ -]?aaral\s*:',
    'applicant_language_dialect': r'Salita\s*[/ ]\s*Dialekto\s*:',
    'applicant_contact': r'Contact\s*No\.?\s*:',
    'spouse_name': r'Asawa\s*:',
    'spouse_address': r'Tirahan ng asawa\s*:',
    'spouse_contact': r'Contact No\.? ng asawa\s*:',
    'place_of_detention': r'Lugar ng Detention\s*:',
}
LABEL = re.compile('|'.join(f'(?P<{key}>{pattern})' for key, pattern in FIELDS.items()), re.I)
INVENTORY = {
    'applicant_name': 'Party Represented', 'applicant_sex': 'Gender/Sex',
    'applicant_address': 'Address', 'applicant_contact': 'Contact Number',
    'place_of_detention': 'Place of Detention', 'detained_since': 'Date of Confinement',
}


def applicant_bounds(entries):
    """Require both printed section boundaries; never assume photo proportions."""
    start = next((e for e in entries if re.search(r'II\.?\s*IMPORMASYON', e['text'], re.I)), None)
    end = next((e for e in entries if re.search(r'II[ .-]*A\.', e['text'], re.I)), None)
    if not start or not end or start['page'] != end['page']:
        return None
    if start['bbox'][3] >= end['bbox'][1]:
        return None
    return start['page'], start['bbox'][3], end['bbox'][1]


def read_applicant(entries, bounds):
    page, top, bottom = bounds
    block = [e for e in entries if e['page'] == page and top <= (e['bbox'][1]+e['bbox'][3])/2 <= bottom]
    values = dict.fromkeys(FIELDS)
    evidence = {}
    for entry in block:
        matches = list(LABEL.finditer(entry['text']))
        for index, match in enumerate(matches):
            key = match.lastgroup
            stop = matches[index+1].start() if index+1 < len(matches) else len(entry['text'])
            value = entry['text'][match.end():stop].strip()
            sources = [entry]
            if not value and index == len(matches)-1:
                x1, y1, x2, y2 = entry['bbox']
                height = max(1, y2-y1)
                row = sorted((e for e in block if e is not entry and e['bbox'][0] >= x2-2
                              and abs((e['bbox'][1]+e['bbox'][3]-y1-y2)/2) <= height*.6),
                             key=lambda e: e['bbox'][0])
                for candidate in row:
                    if LABEL.search(candidate['text']) or ':' in candidate['text']:
                        break
                    # Values must be adjacent, not a distant column's contents.
                    if candidate['bbox'][0] - sources[-1]['bbox'][2] > height*12:
                        break
                    sources.append(candidate)
                value = ' '.join(e['text'] for e in sources[1:]).strip()
            if not value:
                continue
            valid = True
            if key in {'applicant_contact', 'spouse_contact'}:
                valid = bool(re.fullmatch(r'[+\d][\d ()-]{5,}', value))
            elif key == 'applicant_email':
                valid = bool(re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value))
            elif key == 'individual_monthly_income':
                valid = bool(re.fullmatch(r'(?:PHP\s*|₱\s*)?\d[\d,]*(?:\.\d{2})?', value, re.I))
            elif key == 'applicant_age':
                valid = bool(re.fullmatch(r'\d{1,3}', value))
            elif key == 'applicant_sex':
                valid = value.lower() in {'m', 'f', 'male', 'female'}
            elif key == 'detained_since':
                # Leave interpretation of ambiguous dates to the reviewer.
                valid = bool(re.fullmatch(r'\d{1,2}\s*/\s*\d{1,2}\s*/\s*\d{4}', value))
            evidence[key] = {'candidate': value, 'accepted': valid,
                             'sources': sources, 'requires_review': True}
            values[key] = value if valid else None
    return values, evidence
