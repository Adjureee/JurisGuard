"""Label-anchored paper candidates; no template coordinates or guessed answers."""
import re


def positioned_candidates(text, layout, refinements=None):
    from paper_intake import SCHEMA, APPLICANT, REPRESENTATIVE, HEADINGS, END, field_label_pattern, empty_sections
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
        pattern = re.compile('|'.join(field_label_pattern(key, label) for key, label in alternatives), re.I)
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
            # A refinement that only re-detects the printed label is not evidence
            # that the original answer was blank. Keep both passes available.
            pool = primary + fallback
            anchors, candidates = [], {}
            rejected_refinements = set()
            def candidate(key, value, source):
                value = value.strip()
                path = f'{section}.{key}'
                if not value or re.fullmatch(r'[\s_.\-☐\uf06f]*', value):
                    return
                if key == 'detained':
                    states[path] = 'checkbox_unverified'
                    return
                if key == 'age' and not re.fullmatch(r'\d{1,3}', value):
                    if source['priority'] == 0:
                        rejected_refinements.add(key)
                    states[path] = 'ocr_failed'
                    evidence[path] = {'reason': 'Age reading needs review.', 'source_text': source['text'],
                                      'candidates': [{'text': value, 'bbox': source['bbox'], 'page': page}]}
                    return
                # Preserve the complete OCR box as evidence, but never draw its
                # printed label as though it were handwritten answer pixels.
                source = dict(source, highlight_bbox=None if pattern.search(source['text']) else source['bbox'])
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
                          abs(sum(a['bbox'][1::2])/2-(y1+y2)/2) <= min(y2-y1, a['bbox'][3]-a['bbox'][1])*.6
                          and min(y2, a['bbox'][3])-max(y1, a['bbox'][1]) >= min(y2-y1, a['bbox'][3]-a['bbox'][1])*.25]
                if not nearby:
                    continue
                # For Edad/Sex/Civil Status, use the label immediately to the
                # left on the same row, never another field in the other column.
                anchor = min(nearby, key=lambda a: (abs(sum(a['bbox'][1::2])/2-(y1+y2)/2), -a['x']))
                same_row = [a for a in nearby if abs(sum(a['bbox'][1::2])/2-sum(anchor['bbox'][1::2])/2) < 8]
                anchor = max(same_row, key=lambda a: a['x']) if same_row else anchor
                candidate(anchor['key'], entry['text'], entry)
            for key, options in candidates.items():
                if key in rejected_refinements:
                    # A visible but invalid refinement is an unresolved reading,
                    # unlike a label-only pass. Do not hide it with a raw default.
                    continue
                priority = min(option[0] for option in options)
                selected = [option for option in options if option[0] == priority]
                path = f'{section}.{key}'
                # OCR can split a handwritten answer into adjacent word boxes.
                # Join only disjoint fragments on one row, never competing reads
                # of the same pixels or repeated labels on different rows.
                ordered = sorted(selected, key=lambda option: option[2]['bbox'][0])
                if len({option[1] for option in selected}) > 1 and sum(bool(pattern.search(option[2]['text'])) for option in selected) <= 1:
                    adjacent = all(
                        0 <= b[2]['bbox'][0]-a[2]['bbox'][2] <= max(a[2]['bbox'][3]-a[2]['bbox'][1], b[2]['bbox'][3]-b[2]['bbox'][1])*3
                        and abs(sum(a[2]['bbox'][1::2])/2-sum(b[2]['bbox'][1::2])/2) <= min(a[2]['bbox'][3]-a[2]['bbox'][1], b[2]['bbox'][3]-b[2]['bbox'][1])*.5
                        for a, b in zip(ordered, ordered[1:]))
                    if adjacent:
                        combined = dict(ordered[0][2])
                        combined['bbox'] = [min(o[2]['bbox'][0] for o in ordered), min(o[2]['bbox'][1] for o in ordered), max(o[2]['bbox'][2] for o in ordered), max(o[2]['bbox'][3] for o in ordered)]
                        combined['text'] = ' '.join(o[2]['text'] for o in ordered)
                        combined['engine_score'] = min(o[2].get('engine_score', 1) for o in ordered)
                        combined['highlight_bbox'] = combined['bbox'] if all(o[2].get('highlight_bbox') for o in ordered) else None
                        selected = [(priority, ' '.join(o[1] for o in ordered), combined)]
                if len({option[1] for option in selected}) != 1:
                    states[path] = 'ocr_failed'
                    evidence[path] = {'reason': 'Conflicting OCR candidates; compare with scan.',
                                      'candidates': [{'text': option[1], 'source_text': option[2]['text'],
                                                       'bbox': option[2]['bbox'], 'page': page} for option in selected]}
                    continue
                value, source = selected[0][1:]
                values[section][key] = value
                pass_disagreement = any(o[0] != priority and o[1] != value for o in options)
                states[path] = 'uncertain' if pass_disagreement or source.get('engine_score', 1) < .85 else 'candidate'
                evidence[path] = {'page': page, 'bbox': source['bbox'], 'engine_score': source.get('engine_score'),
                                  'highlight_bbox': source.get('highlight_bbox'),
                                  'source_text': source['text'],
                                  'pass_disagreement': pass_disagreement,
                                  'candidates': [{'text': o[1], 'source_text': o[2]['text'], 'bbox': o[2]['bbox'], 'page': page,
                                                  'source': 'local_ocr_refinement' if o[0] == 0 else 'local_ocr'} for o in options],
                                  'source': 'local_ocr_refinement' if priority == 0 else 'local_ocr'}
            # Empty readings still need a review location. Use detected printed
            # labels and the next label/column edge, never invent an answer or
            # treat the resulting region as proof that the paper is blank.
            for key in allowed:
                if values[section][key] or key == 'detained':
                    continue
                matches = [a for a in anchors if a['key'] == key]
                if not matches:
                    continue
                anchor = min(matches, key=lambda a: a['priority'])
                label_matches = list(pattern.finditer(anchor['text']))
                if len(label_matches) != 1 or anchor['text'][:label_matches[0].start()].strip() or not re.fullmatch(r'[\s_.\-]*', anchor['text'][label_matches[0].end():]):
                    # Character proportions inside a merged OCR line are not
                    # reliable enough to locate an individual blank answer.
                    evidence.setdefault(f'{section}.{key}', {})['highlight_bbox'] = None
                    continue
                y1, y2 = anchor['bbox'][1], anchor['bbox'][3]
                following = [a['x'] for a in anchors if a['key'] != key and a['x'] > anchor['label_end']
                             and abs(sum(a['bbox'][1::2])/2-(y1+y2)/2) <= (y2-y1)*.6]
                edge = split if not is_right else max(start['bbox'][2], end['bbox'][2])
                x1, x2 = anchor['label_end']+2, min(following, default=edge)-2
                if x2 <= x1:
                    continue
                path = f'{section}.{key}'
                area = [round(x1), y1-2, round(x2), y2+2]
                evidence.setdefault(path, {}).update(page=page, bbox=area, highlight_bbox=area,
                    location_kind='label_answer_area', source_text=anchor['text'],
                    location_note='Approximate answer area from printed labels; check for blank or unreadable handwriting.')
    return values, states, evidence
