"""Conservative local pixel evidence for the two boxes printed in Part II.

OCR locates the row; it never supplies the checked/unchecked decision. Missing
geometry, faint ink, damaged borders and ambiguous identity remain unknown.
"""
import re
from pathlib import Path
import cv2
import numpy as np

PREFIX = 'applicant_personal_circumstances.detained.'
OPTIONS = ('oo', 'hindi')
STATES = {'checked', 'unchecked', 'unknown'}


def unknown_boxes():
    return {PREFIX + option: 'unknown' for option in OPTIONS}


def answer_from_boxes(states):
    pair = [states[PREFIX + option] for option in OPTIONS]
    return 'Oo' if pair == ['checked', 'unchecked'] else 'Hindi' if pair == ['unchecked', 'checked'] else ''


def reviewed_detained(states):
    answer = answer_from_boxes(states) if states is not None else ''
    return True if answer == 'Oo' else False if answer == 'Hindi' else None


def validate_boxes(states, sections):
    if states is None:
        return  # Existing records without per-box evidence remain untouched.
    if set(states) != set(unknown_boxes()) or any(value not in STATES for value in states.values()):
        raise ValueError('Provide checked, unchecked, or unknown for each Nakakulong box only.')
    if sections['applicant_personal_circumstances']['detained'] != answer_from_boxes(states):
        raise ValueError('Nakakulong summary does not match the reviewed checkbox states.')


def _read_box(image, bbox, quad=None):
    gray = np.asarray(image.convert('L'))
    x1, y1, x2, y2 = map(int, bbox)
    result = {'state': 'unknown', 'frame': False, 'reason': 'incomplete_or_unreadable_border'}
    if x1 <= 0 or y1 <= 0 or x2 >= image.width-1 or y2 >= image.height-1 or min(x2-x1, y2-y1) < 8:
        return result
    box = gray[y1:y2, x1:x2]
    margin = max(4, round(min(box.shape)*.4))
    ry, rx = max(0, y1-margin), max(0, x1-margin)
    region = gray[ry:min(image.height,y2+margin), rx:min(image.width,x2+margin)]
    mask = np.ones(region.shape, dtype=bool)
    mask[y1-ry:y2-ry, x1-rx:x2-rx] = False
    background = float(np.percentile(region[mask],80)) if mask.any() else 0
    if background < 65:
        return result
    paper = region[mask]
    paper = paper[paper > background*.82]
    noise = float(np.median(np.abs(paper.astype(float)-np.median(paper)))*1.4826) if paper.size else 0
    if quad is not None:
        points = np.asarray(quad, dtype=np.float32)
        width = round(max(np.linalg.norm(points[1]-points[0]), np.linalg.norm(points[2]-points[3])))+1
        height = round(max(np.linalg.norm(points[3]-points[0]), np.linalg.norm(points[2]-points[1])))+1
        if min(width,height) < 8:
            return result
        transform = cv2.getPerspectiveTransform(points, np.float32([[0,0],[width-1,0],[width-1,height-1],[0,height-1]]))
        box = cv2.warpPerspective(gray,transform,(width,height),flags=cv2.INTER_LINEAR)
    edge = max(2,round(min(box.shape)*.12))
    dark = box < background*.45
    sides = [dark[:edge].max(0).mean(),dark[-edge:].max(0).mean(),dark[:,:edge].max(1).mean(),dark[:,-edge:].max(1).mean()]
    result['border_coverage'] = [round(float(v),4) for v in sides]
    if sum(v >= .75 for v in sides) < 3:
        return result
    result['frame'] = True
    inset = max(edge+1,round(min(box.shape)*.33))
    interior = box[inset:-inset,inset:-inset]
    if min(interior.shape,default=0) < 3:
        return result
    ink = interior < background*.45
    result['interior_ink_fraction'] = round(float(ink.mean()),4)
    if ink.mean() >= .12 and ink.any(0).mean() >= .45 and ink.any(1).mean() >= .45:
        result.update(state='checked',reason='visible_interior_mark')
    elif min(sides) >= .8 and (interior < background-max(20,background*.08)).mean() <= .01 and interior.mean() >= background*.9 and interior.std() < max(5,background*.06,noise*1.5):
        result.update(state='unchecked',reason='clear_empty_interior')
    else:
        result['reason'] = 'faint_noisy_or_ambiguous_interior'
    return result


def classify_box(image, bbox):
    return _read_box(image,bbox)['state']


def _ordered_quad(points):
    points = sorted(points, key=lambda p: (p[1],p[0]))
    top, bottom = sorted(points[:2],key=lambda p:p[0]), sorted(points[2:],key=lambda p:p[0])
    return np.float32([top[0],top[1],bottom[1],bottom[0]])


def _box_candidates(image, roi, row_height):
    left,upper,right,lower = roi
    gray = np.asarray(image.convert('L'))[upper:lower,left:right]
    # A relative threshold keeps underexposed paper out of the ink mask.
    ink = (gray < np.percentile(gray,85)*.5).astype('uint8')*255
    # Find the end of the printed Nakakulong word from actual ink gaps. This
    # excludes letter counters inside the label from being mistaken for boxes.
    band = ink[max(0,round((lower-upper-row_height)/2)):min(lower-upper,round((lower-upper+row_height)/2))]
    projection = (band.any(axis=0).astype('uint8')*255)[None,:]
    joined = cv2.morphologyEx(projection,cv2.MORPH_CLOSE,np.ones((1,max(3,round(row_height*.12))),np.uint8))
    _,_,word_stats,_ = cv2.connectedComponentsWithStats(joined)
    labels = [v for v in word_stats[1:] if v[0] <= row_height*.5 and v[2] >= row_height*1.5]
    if len(labels)!=1:return []
    label_end = left+int(labels[0][0]+labels[0][2])
    proposed = []
    contours,_ = cv2.findContours(ink,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    for contour in contours:
        x,y,w,h = cv2.boundingRect(contour)
        if .3*row_height <= w <= 1.8*row_height and .42*row_height <= h <= 1.8*row_height and .3 <= w/h <= 1.8:
            quad = _ordered_quad(cv2.boxPoints(cv2.minAreaRect(contour))) + np.float32([left,upper])
            proposed.append(([x+left,y+upper,x+w+left,y+h+upper],quad))
    # Long border strokes survive even when a tick joins the box to printed Oo.
    # Opening/connected components are fixed operations, not random line sampling.
    vertical = cv2.morphologyEx(ink,cv2.MORPH_OPEN,np.ones((max(6,round(row_height*.34)),1),np.uint8))
    _,_,stats,_ = cv2.connectedComponentsWithStats(vertical)
    strokes = sorted([tuple(map(int,v[:4])) for v in stats[1:] if v[3] >= row_height*.42 and v[2] <= max(5,row_height*.35)])
    for index,(x,y,w,h) in enumerate(strokes):
        for bx,by,bw,bh in strokes[index+1:]:
            width, height = bx+bw-x, max(y+h,by+bh)-min(y,by)
            if not (.3*height <= width <= 1.5*height and .55 <= h/bh <= 1.8 and abs(y-by) <= min(h,bh)*.4):
                continue
            proposed.append(([x+left,min(y,by)+upper,bx+bw+left,max(y+h,by+bh)+upper],None))
    candidates = []
    for bbox,quad in proposed:
        if bbox[0] < label_end:continue
        reading = _read_box(image,bbox,quad)
        if reading['frame']:
            candidates.append({'bbox':bbox,'quad':quad,'reading':reading})
    # Deduplicate inner/outer edges of the same physical rectangle. Prefer the
    # strongest border evidence, never a preferred checked/unchecked answer.
    candidates.sort(key=lambda c:(-sum(c['reading']['border_coverage']),c['bbox']))
    selected=[]
    for item in candidates:
        a=item['bbox']
        def duplicate(existing):
            b=existing['bbox']; intersection=max(0,min(a[2],b[2])-max(a[0],b[0]))*max(0,min(a[3],b[3])-max(a[1],b[1]))
            return intersection/max(1,min((a[2]-a[0])*(a[3]-a[1]),(b[2]-b[0])*(b[3]-b[1]))) > .65
        if not any(duplicate(other) for other in selected):selected.append(item)
    return sorted(selected,key=lambda c:c['bbox'])


def detect_page_boxes(image, entries, page=1, diagnostics=None):
    from paper_intake import HEADINGS,APPLICANT,REPRESENTATIVE
    states,evidence=unknown_boxes(),{}
    def unknown(reason):
        if diagnostics is not None:diagnostics.update(reason=reason,detector='border_geometry_v2')
        return states,evidence
    def boundary(pattern):
        matches=sorted((e for e in entries if re.search(pattern,e['text'],re.I)),key=lambda e:e['bbox'][1])
        if len(matches)==1:return matches[0]
        # A reviewed focused crop can contain our structural marker followed
        # immediately by the photographed printed heading. Collapse only this
        # adjacent pair; distant repeated blocks remain ambiguous and cannot
        # establish checkbox identity. Printed form instructions may sit between
        # the two headings.
        if len(matches)!=2:return None
        first,second=matches
        gap=second['bbox'][1]-first['bbox'][3]
        if gap < -10 or gap > min(140,max(60,image.height*.12)):
            return None
        if diagnostics is not None:diagnostics.setdefault('adjacent_heading_pairs',0);diagnostics['adjacent_heading_pairs']+=1
        return first
    start,end=boundary(HEADINGS[APPLICANT]),boundary(HEADINGS[REPRESENTATIVE])
    if start is None or end is None:return unknown('section_boundaries_not_unique')
    top,bottom=start['bbox'][3],end['bbox'][1]
    rows=[e for e in entries if re.search(r'\bNakakulong\b',e['text'],re.I) and top < e['bbox'][1] < bottom]
    if len(rows)!=1:return unknown('checkbox_row_not_unique')
    row=rows[0];x1,y1,x2,y2=row['bbox'];height=max(10,y2-y1)
    if not (0<=x1<x2<=image.width and 0<=y1<y2<=image.height) or row.get('engine_score',1)<.85:
        return unknown('checkbox_row_unreliable')
    row_entries=[e for e in entries if abs((e['bbox'][1]+e['bbox'][3]-y1-y2)/2)<height*.8]
    row_text=' '.join(e['text'] for e in sorted(row_entries,key=lambda e:e['bbox'][0]))
    row_text=re.sub(r'\bOo(?=Hindi\b)','Oo ',row_text,flags=re.I)
    oo,hindi=re.search(r'\bOo\b',row_text,re.I),re.search(r'\bHindi\b',row_text,re.I)
    if (not oo and not hindi) or (oo and hindi and oo.start()>hindi.start()):
        return unknown('printed_choices_unreliable')
    # The actual PAO form prints Oo then Hindi. One label may be absent from
    # OCR because a tick touches it; require both physical box frames instead.
    contacts=[e['bbox'][0] for e in row_entries if re.search(r'Contact',e['text'],re.I) and e['bbox'][0]>x2]
    right=min(image.width,int(x2+height*1.5),int(min(contacts)) if contacts else image.width)
    roi=(max(0,int(x1)),max(0,int(y1-height*.35)),right,min(image.height,int(y2+height*.35)))
    if roi[0]>=roi[2] or roi[1]>=roi[3]:return unknown('cropped_checkbox_row')
    candidates=_box_candidates(image,roi,height)
    pairs=[]
    tail = candidates[-1] if candidates else None
    for index,a in enumerate(candidates):
        for b in candidates[index+1:]:
            if b is not tail:continue
            aa,bb=a['bbox'],b['bbox'];wa,wb=aa[2]-aa[0],bb[2]-bb[0];ha,hb=aa[3]-aa[1],bb[3]-bb[1]
            if (bb[0]-aa[0] >= max(wa,wb)*1.8 and .75<=ha/hb<=1.33 and abs(bb[2]-x2)<=height and abs((aa[1]+aa[3]-bb[1]-bb[3])/2)<=max(ha,hb)*.4):
                pairs.append((a,b))
    if diagnostics is not None:diagnostics.update(candidate_count=len(candidates),pair_count=len(pairs),ocr_choice_labels=[label for label,m in [('Oo',oo),('Hindi',hindi)] if m])
    if len(pairs)!=1:return unknown('box_pair_missing_or_ambiguous')
    for option,item in zip(OPTIONS,pairs[0]):
        path=PREFIX+option;reading=item['reading'];states[path]=reading['state']
        evidence[path]={'page':page,'bbox':item['bbox'],'source':'scan_pixels','state':states[path],
                        'reason':reading['reason'],'border_coverage':reading['border_coverage'],
                        'interior_ink_fraction':reading.get('interior_ink_fraction')}
    if diagnostics is not None:diagnostics.update(reason='box_pair_located',detector='border_geometry_v2')
    return states,evidence


def checkbox_review_warnings(states):
    warnings=[f'Nakakulong {option.title()}: box remains unknown; inspect the original scan.' for option in OPTIONS if states[PREFIX+option]=='unknown']
    if all(states[PREFIX+option]=='checked' for option in OPTIONS):
        warnings.append('Nakakulong: both boxes are checked; conflicting marks require review.')
    return warnings


def extract_visual_boxes(path, text, layout, diagnostics=None):
    from local_ocr import LocalOCR
    if not layout or len(text.splitlines()) != len(layout):
        return unknown_boxes(), {}
    entries = [dict(box, text=line) for line, box in zip(text.splitlines(), layout)]
    found = []
    for page, image in LocalOCR()._pages(Path(path)):
        on_page = [e for e in entries if e.get('page', 1) == page and e.get('bbox')]
        if any(re.search(r'\bNakakulong\b', e['text'], re.I) for e in on_page):
            found.append(detect_page_boxes(image, on_page, page, diagnostics))
    # Repeated applicant blocks are ambiguous; never merge people's choices.
    return found[0] if len(found) == 1 else (unknown_boxes(), {})
