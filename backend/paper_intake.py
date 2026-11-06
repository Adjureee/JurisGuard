"""Part II/II-A contract. Original documents remain separate evidence."""
import re

APPLICANT = 'applicant_personal_circumstances'
REPRESENTATIVE = 'representative_personal_circumstances'
# Rows and columns follow FOSS.F.003/REV.3, effective 14 April 2023.
SCHEMA = {
    APPLICANT: [
        ('name', 'Pangalan'), ('age', 'Edad'), ('sex', 'Sex'), ('civil_status', 'Civil Status'),
        ('religion', 'Relihiyon'), ('educational_attainment', 'Naabot na pag-aaral'),
        ('citizenship', 'Pagkamamamayan'), ('language_dialect', 'Salita/Dialekto'),
        ('address', 'Tirahan'), ('contact_no', 'Contact No.'), ('email', 'E-mail'),
        ('spouse_name', 'Asawa'), ('individual_monthly_income', 'Individual Monthly Income'),
        ('spouse_address', 'Tirahan ng asawa'), ('detained', 'Nakakulong'),
        ('spouse_contact_no', 'Contact No. ng asawa'), ('detained_since', 'Petsa ng pagakakulong'),
        ('place_of_detention', 'Lugar ng Detention'),
    ],
    REPRESENTATIVE: [('name', 'Pangalan'), ('age', 'Edad'), ('sex', 'Sex'),
        ('civil_status', 'Civil Status'), ('address', 'Tirahan'), ('contact_no', 'Contact No.'),
        ('relationship_to_applicant', 'Relasyon sa aplikante'), ('email', 'E-mail')],
}
HEADINGS = {
    APPLICANT: r'\bII[.\s]+(?:I[M N]PORMASYON|IMPORMASYON|INFORMATION|APPLICANT)|\bIMPORMASYON\s+UKOL\s+SA\s+APLIKANTE\b',
    REPRESENTATIVE: r'\bII\s*[-. ]\s*A[.\s]+|\bIMPORMASYON\s+UKOL\s+SA\s+REPRESENTATIVE\b',
}
END = r'\bIII[.\s]+(?:URI|NATURE)'

def empty_sections():
    return {section: {key: '' for key, _ in fields} for section, fields in SCHEMA.items()}

def section_blocks(text):
    """Require explicit boundaries; missing headings never expand into other parts."""
    starts = {key: re.search(pattern, text, re.I) for key, pattern in HEADINGS.items()}
    end = re.search(END, text, re.I)
    a, r = starts[APPLICANT], starts[REPRESENTATIVE]
    return {
        APPLICANT: text[a.end():r.start()] if a and r and a.end() < r.start() else '',
        REPRESENTATIVE: text[r.end():end.start()] if r and end and r.end() < end.start() else '',
    }

def label_pattern(label):
    if label == 'Pagkamamamayan':
        # Observed OCR insertion in the printed label, not an answer repair.
        return r'(?:Pagkamamamayan|Pagkamamnamayan)'
    if label == 'Lugar ng Detention':
        # The printed final n is sometimes recognized as r. This is a label
        # alias, not a replacement for any handwritten detention location.
        return r'Lugar\s+ng\s+Detentio[nr]'
    if label == 'Contact No.':
        # OCR confusion in the printed label only; never repair answer digits.
        return r'Contact\s+N[o0]\.?'
    if label == 'Relihiyon':
        return r'Relih\w+'
    if label == 'E-mail':
        return r'E[-\s]?ma[iIl][lIt]\w*'
    if label == 'Petsa ng pagakakulong':
        return r'Petsa\s+ng\s+pag\w+kulong'
    return re.escape(label).replace(r'\ ', r'\s+').replace(r'\.', r'\.?')


def field_label_pattern(key, label, *, require_colon=False):
    """Printed-label boundaries; underscores are blank rules, not word letters."""
    normal = rf'(?<![^\W_]){label_pattern(label)}'
    if key == 'civil_status':
        # The answer F/M can touch the following printed label in an OCR box.
        # Require its explicit colon in this joined spelling; never expand F/M.
        normal = rf'(?:{normal}|(?<=[FMfm])Civil\s+Status(?=\s*:))'
    suffix = r'\s*:' if require_colon else r'(?=$|[\s:._])\s*[:.]?'
    return rf'(?P<{key}>{normal}){suffix}'

def checkbox_candidate(value):
    """Text evidence only. Missing box glyphs never establish either state."""
    suffix = list(re.finditer(r'\b(Oo|Hindi)\s*(\[[xX]\]|☒|☑|\[\s*\]|☐)', value, re.I))
    prefix = list(re.finditer(r'(\[[xX]\]|☒|☑|\[\s*\]|☐)\s*(Oo|Hindi)\b', value, re.I))
    # Require both printed options in one consistent convention. A single X
    # between options ("Oo [X] Hindi") is ambiguous about which box it belongs to.
    for matches, option_group, mark_group in ((suffix, 1, 2), (prefix, 2, 1)):
        if {m.group(option_group).lower() for m in matches} != {'oo', 'hindi'}:
            continue
        marked = [m.group(option_group).lower() for m in matches if re.search(r'[xX☒☑]', m.group(mark_group))]
        return {'oo': 'Oo', 'hindi': 'Hindi'}.get(marked[0], '') if len(marked) == 1 else ''
    return ''


def extract_paper_intake(text, layout=None, refinements=None):
    from paper_checkboxes import unknown_boxes
    from paper_intake_layout import positioned_candidates
    positioned = positioned_candidates(text, layout, refinements)
    if positioned is not None:
        values, states, evidence = positioned
        blocks = section_blocks(text)
        return {'intake_scope': 'pao_parts_ii_iia', 'sections': values, 'checkbox_states': unknown_boxes(),
                'raw_text': '\n'.join(blocks.values()), 'document_type': 'intake_form', 'needs_review': True,
                'diagnostics': {'warnings': ['Compare every field with the original scan. No candidate is verified automatically.'],
                    'field_states': states, 'field_evidence': evidence,
                    'rejected_candidates': {path: [item['text'] for item in data.get('candidates', [])]
                                            for path, data in evidence.items() if states.get(path) == 'ocr_failed'},
                    'uncertain_fields': [path for path, state in states.items() if state == 'uncertain'],
                    'field_review_required': {s: list(fields) for s, fields in values.items()}}}
    uncertain_lines = []
    if layout and len(layout) == len(text.splitlines()):
        uncertain_lines = [line for box, line in zip(layout, text.splitlines())
                           if isinstance(box.get('engine_score'), (int, float)) and box['engine_score'] < .85]
    if layout and len(layout) == len(text.splitlines()):
        rows = []
        for box, line in zip(layout, text.splitlines()):
            if not box.get('bbox'):
                continue
            x1, y1, x2, y2 = box['bbox']
            page = box.get('page', 1)
            row = next((r for r in rows if r['page'] == page and
                        abs(r['y'] - (y1+y2)/2) < min(r['height'], max(1, y2-y1))*.45), None)
            if row is None:
                row = {'page': page, 'y': (y1+y2)/2, 'height': max(1, y2-y1), 'entries': []}
                rows.append(row)
            row['entries'].append((x1, line))
        if rows:
            text = '\n'.join(' '.join(line for _, line in sorted(r['entries']))
                             for r in sorted(rows, key=lambda r: (r['page'], r['y'])))
    sections = empty_sections()
    blocks = section_blocks(text)
    issues = []
    rejected_candidates = {}
    uncertain_fields = []
    seen_fields, rejected_fields = set(), set()
    for section, fields in SCHEMA.items():
        if not blocks[section]:
            issues.append(f'{section}: section boundaries unreadable or missing; compare with scan.')
            continue
        # Longest labels first prevents spouse/address/contact labels being
        # mistaken for the applicant's shorter labels.
        alternatives = sorted(fields, key=lambda field: len(field[1]), reverse=True)
        pattern = re.compile('|'.join(field_label_pattern(key, label, require_colon=True) for key, label in alternatives), re.I)
        candidates = {}
        for line in blocks[section].splitlines():
            matches = list(pattern.finditer(line))
            for index, match in enumerate(matches):
                path = f'{section}.{match.lastgroup}'
                seen_fields.add(path)
                value = line[match.end():matches[index+1].start() if index+1 < len(matches) else len(line)]
                value = value.strip()
                if not value or re.fullmatch(r'[_ .\-\u2610\uf06f]*', value):
                    continue
                # A damaged/missing colon must not turn a neighbouring printed
                # label into somebody's name or address.
                if re.match(r'^[_ .\-]+\s*(?:Edad|Sex|Civil\s+Status|Contact|Tirahan)\b', value, re.I):
                    rejected_fields.add(path)
                    issues.append(f'{section}.{match.lastgroup}: damaged label boundary; compare with scan.')
                    continue
                if match.lastgroup == 'detained':
                    # Only an explicit readable mark adjacent to its own option
                    # supplies a candidate; printed empty boxes never imply No.
                    issues.append(f'{section}.detained: inspect scan pixels; OCR text cannot establish box states.')
                    continue
                if match.lastgroup == 'age' and not re.fullmatch(r'\d{1,3}', value):
                    rejected_fields.add(path)
                    rejected_candidates.setdefault(path, []).append(value)
                    issues.append(f'{section}.age: OCR did not identify a readable age; compare with scan.')
                    continue
                candidates.setdefault(match.lastgroup, []).append(value)
        for key, values in candidates.items():
            if len(set(values)) == 1:
                sections[section][key] = values[0]
                if any(values[0] in line for line in uncertain_lines):
                    uncertain_fields.append(f'{section}.{key}')
            else:
                rejected_fields.add(f'{section}.{key}')
                rejected_candidates[f'{section}.{key}'] = values
                issues.append(f'{section}.{key}: conflicting OCR entries; compare with scan.')
    return {
        'intake_scope': 'pao_parts_ii_iia', 'sections': sections, 'checkbox_states': unknown_boxes(),
        'raw_text': '\n'.join(blocks.values()), 'document_type': 'intake_form',
        'needs_review': True,
        'diagnostics': {'warnings': issues + ['Verify every field against the scan. Empty OCR may mean blank or unreadable handwriting.'],
                        'rejected_candidates': rejected_candidates,
                        'field_states': {f'{s}.{key}': ('uncertain' if f'{s}.{key}' in uncertain_fields else 'candidate') if value else
                                         ('ocr_failed' if not blocks[s] or f'{s}.{key}' not in seen_fields or f'{s}.{key}' in rejected_fields else
                                          'checkbox_unverified' if key == 'detained' else 'unverified_empty')
                                         for s, fields in sections.items() for key, value in fields.items()},
                        'uncertain_fields': uncertain_fields,
                        'field_review_required': {s: list(v) for s, v in sections.items()}},
    }

REVIEW_STATES = {'confirmed', 'blank', 'unreadable', 'ocr_failed', 'unmarked', 'unclear'}


def validate_review(sections, unreadable, field_reviews=None):
    """Reject extra sections/fields and preserve reviewed strings verbatim."""
    if set(sections) != set(SCHEMA):
        raise ValueError('Only Parts II and II-A may be saved.')
    for section, fields in SCHEMA.items():
        if not isinstance(sections[section], dict) or set(sections[section]) != {key for key, _ in fields}:
            raise ValueError('Unexpected or missing intake fields.')
        if any(not isinstance(value, str) or len(value) > 10000 for value in sections[section].values()):
            raise ValueError('Intake values must be text of at most 10000 characters.')
    allowed = {f'{s}.{key}' for s, fields in SCHEMA.items() for key, _ in fields}
    if sections[APPLICANT]['detained'] not in ('', 'Oo', 'Hindi'):
        raise ValueError('Nakakulong must be Oo, Hindi, or empty after reviewing the actual marks.')
    if any(key not in allowed for key in unreadable):
        raise ValueError('Invalid unreadable field.')
    if any(sections[key.split('.')[0]][key.split('.')[1]] for key in unreadable):
        raise ValueError('Unreadable fields must remain empty.')
    if field_reviews is not None:
        # Optional legacy metadata, not a prerequisite for reviewing/saving text.
        if not set(field_reviews).issubset(allowed) or any(state not in REVIEW_STATES for state in field_reviews.values()):
            raise ValueError('Invalid optional field status metadata.')
    return sections
