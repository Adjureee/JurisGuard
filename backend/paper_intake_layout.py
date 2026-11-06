"""Label-anchored paper candidates; no template coordinates or guessed answers."""
import re


def positioned_candidates(text, layout, refinements=None):
    from paper_intake import SCHEMA, APPLICANT, REPRESENTATIVE, HEADINGS, END, label_pattern, empty_sections
    if not layout or len(layout) != len(text.splitlines()) or any(not box.get('bbox') for box in layout):
        return None
    entries = [dict(box, text=line, priority=1) for box, line in zip(layout, text.splitlines())]
    boundaries = {key: next((e for e in entries if re.search(pattern, e['text'], re.I)), None)
                  for key, pattern in HEADINGS.items()}
    boundaries['end'] = next((e for e in entries if re.search(END, e['text'], re.I)), None)
    values = empty_sections()
    evidence = {}
    states = {f'{s}.{key}': 'ocr_failed' for s, fields in SCHEMA.items() for key, _ in fields}
    right = {'age', 'sex', 'civil_status', 'educational_attainment', 'language_dialect',
             'contact_no', 'spouse_name', 'spouse_address', 'spouse_contact_no', 'place_of_detention'}
    for section, fields in SCHEMA.items():
        start = boundaries[section]
        end = boundaries[REPRESENTATIVE if section == APPLICANT else 'end']
        if not start or not end or start.get('page', 1) != end.get('page', 1) or start['bbox'][3] >= end['bbox'][1]:
            continue
        top, bottom, page = start['bbox'][3], end['bbox'][1], start.get('page', 1)
        def inside(e):
            return e.get('page', 1) == page and top <= sum(e['bbox'][1::2])/2 <= bottom
        raw = [e for e in entries if inside(e)]
        refined = [dict(e, priority=0) for e in (refinements or []) if inside(e)]
        alternatives = sorted(fields, key=lambda field: len(field[1]), reverse=True)
        pattern = re.compile('|'.join(f'(?P<{key}>(?<!\\w){label_pattern(label)})(?=$|[\\s:.])\\s*[:.]?' for key, label in alternatives), re.I)
        right_keys = right if section == APPLICANT else {'age', 'sex', 'civil_status', 'contact_no', 'email'}
        right_edges = [e['bbox'][0] for e in refined + raw
                       if (m := pattern.match(e['text'])) and m.lastgroup in right_keys]
        left_edges = [e['bbox'][0] for e in refined + raw
                      if (m := pattern.match(e['text'])) and m.lastgroup not in right_keys]
        split = min(right_edges) - 4 if right_edges and left_edges and min(right_edges) > min(left_edges) + 40 else None
        # Without identifiable columns, withhold positioned claims and let the
        # text-only fallback require review rather than partitioning by guess.
        if split is None:
            return None
        for is_right in (False, True):
            allowed = {key for key, _ in fields if (key in right_keys) == is_right}
            def column(e):
                return (e['bbox'][0] >= split) == is_right
            primary = [e for e in refined if column(e)]
            fallback = [e for e in raw if column(e)]
            primary_labels = {m.lastgroup for e in primary for m in pattern.finditer(e['text'])}
            pool = primary + [e for e in fallback if not any(m.lastgroup in primary_labels for m in pattern.finditer(e['text']))]
            anchors, candidates = [], {}
            def candidate(key, value, source):
                value = value.strip()
                path = f'{section}.{key}'
                if not value or re.fullmatch(r'[\s_.\-☐\uf06f]*', value):
                    return
                if key == 'detained':
                    states[path] = 'checkbox_unverified'
                    return
                if key == 'age' and not re.fullmatch(r'\d{1,3}', value):
                    states[path] = 'ocr_failed'
                    evidence[path] = {'reason': 'Age reading needs review.', 'source_text': source['text'],
                                      'candidates': [{'text': value, 'bbox': source['bbox'], 'page': page}]}
                    return
                candidates.setdefault(key, []).append((source['priority'], value, source))
            for entry in pool:
                matches = list(pattern.finditer(entry['text']))
                for index, match in enumerate(matches):
                    key = match.lastgroup
                    if key not in allowed:
                        continue
                    path = f'{section}.{key}'
                    states[path] = 'checkbox_unverified' if key == 'detained' else 'unverified_empty'
                    x1, y1, x2, y2 = entry['bbox']
                    width = x2-x1
                    anchor = dict(entry, key=key, x=x1+width*match.start()/max(1, len(entry['text'])),
                                  label_end=x1+width*match.end()/max(1, len(entry['text'])))
                    anchors.append(anchor)
                    # Never accept a left-column box spanning the right column.
                    if not is_right and x2 > split and not any(m.lastgroup in right_keys for m in matches):
                        states[path] = 'ocr_failed'
                        continue
                    value = entry['text'][match.end():matches[index+1].start() if index+1 < len(matches) else len(entry['text'])]
                    candidate(key, value, entry)
            for entry in pool:
                if pattern.search(entry['text']) or re.search(r'para\s+sa|pupunan|aplikante|representative', entry['text'], re.I):
                    continue
                x1, y1, x2, y2 = entry['bbox']
                nearby = [a for a in anchors if a['x'] < x1 and
                          abs(sum(a['bbox'][1::2])/2-(y1+y2)/2) <= max(y2-y1, a['bbox'][3]-a['bbox'][1])*.8]
                if not nearby:
                    continue
                # For Edad/Sex/Civil Status, use the label immediately to the
                # left on the same row, never another field in the other column.
                anchor = min(nearby, key=lambda a: (abs(sum(a['bbox'][1::2])/2-(y1+y2)/2), -a['x']))
                same_row = [a for a in nearby if abs(sum(a['bbox'][1::2])/2-sum(anchor['bbox'][1::2])/2) < 8]
                anchor = max(same_row, key=lambda a: a['x']) if same_row else anchor
                candidate(anchor['key'], entry['text'], entry)
            for key, options in candidates.items():
                priority = min(option[0] for option in options)
                selected = [option for option in options if option[0] == priority]
                path = f'{section}.{key}'
                if len({option[1] for option in selected}) != 1:
                    states[path] = 'ocr_failed'
                    evidence[path] = {'reason': 'Conflicting OCR candidates; compare with scan.',
                                      'candidates': [{'text': option[1], 'source_text': option[2]['text'],
                                                       'bbox': option[2]['bbox'], 'page': page} for option in selected]}
                    continue
                value, source = selected[0][1:]
                values[section][key] = value
                states[path] = 'uncertain' if source.get('engine_score', 1) < .85 else 'candidate'
                evidence[path] = {'page': page, 'bbox': source['bbox'], 'engine_score': source.get('engine_score'),
                                  'source_text': source['text'],
                                  'source': 'local_ocr_refinement' if priority == 0 else 'local_ocr'}
    return values, states, evidence
