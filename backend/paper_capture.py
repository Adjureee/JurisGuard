"""Conservative, local crop preparation for a photographed PAO interview sheet.

The full camera image is always the document of record. Generated section labels
are structural OCR delimiters, never evidence of a handwritten field value.
"""
from __future__ import annotations

import base64
import hashlib
import io
import math
import re
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

from paper_intake import APPLICANT, REPRESENTATIVE, END, HEADINGS


class PaperCropError(ValueError):
    pass


def load_capture(path: str | Path) -> np.ndarray:
    path = Path(path)
    if path.suffix.lower() == '.pdf':
        try:
            import pypdfium2 as pdfium
            with pdfium.PdfDocument(str(path)) as document:
                if len(document) != 1:
                    raise PaperCropError('Crop review supports a single-page PDF. Choose Process the whole page for a multi-page scan.')
                page = document[0]
                try:
                    if page.get_width() * page.get_height() * 4 > 40_000_000:
                        raise PaperCropError('The PDF page exceeds the crop review pixel limit.')
                    bitmap = page.render(scale=2)
                    try:
                        image = bitmap.to_pil().convert('RGB')
                    finally:
                        bitmap.close()
                finally:
                    page.close()
        except PaperCropError:
            raise
        except Exception as exc:
            raise PaperCropError('Could not render the PDF for crop review. Choose Process the whole page or upload an image.') from exc
    else:
        with Image.open(path) as source:
            image = ImageOps.exif_transpose(source).convert('RGB')
    if image.width * image.height > 40_000_000:
        raise PaperCropError('The scan exceeds the crop review pixel limit.')
    return cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)


def _order(points: np.ndarray) -> np.ndarray:
    points = np.asarray(points, dtype=np.float32).reshape(4, 2)
    total = points.sum(axis=1)
    diff = points[:, 0] - points[:, 1]
    return np.array([points[np.argmin(total)], points[np.argmax(diff)],
                     points[np.argmax(total)], points[np.argmin(diff)]], dtype=np.float32)


def detect_document(image: np.ndarray) -> dict:
    """Suggest a page only when all four edges are inside the camera frame."""
    height, width = image.shape[:2]
    default = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]
    scale = min(1.0, 1400 / max(width, height))
    small = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 45, 135)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    candidates = []
    frame_area = gray.shape[0] * gray.shape[1]
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < frame_area * .20 or area > frame_area * .97:
            continue
        perimeter = cv2.arcLength(contour, True)
        polygon = cv2.approxPolyDP(contour, .025 * perimeter, True)
        if len(polygon) != 4 or not cv2.isContourConvex(polygon):
            continue
        corners = _order(polygon[:, 0, :])
        margin = min(gray.shape[:2]) * .012
        if any(x < margin or x > gray.shape[1]-margin or y < margin or y > gray.shape[0]-margin
               for x, y in corners):
            continue
        lengths = [np.linalg.norm(corners[(index+1) % 4] - corners[index]) for index in range(4)]
        ratio = max(lengths[0], lengths[2]) / max(lengths[1], lengths[3])
        if not .45 <= ratio <= 2.2:
            continue
        candidates.append((area, corners))
    if not candidates:
        return {'corners': default, 'confidence': 'uncertain',
                'warning': 'All four paper edges were not found inside the frame. Check the corners, or reposition and retake the sheet.'}
    _, corners = max(candidates, key=lambda item: item[0])
    normalized = [[round(float(x / gray.shape[1]), 5), round(float(y / gray.shape[0]), 5)] for x, y in corners]
    return {'corners': normalized, 'confidence': 'suggested',
            'warning': 'Check all four suggested paper corners before OCR.'}


def validate_plan(plan: dict) -> dict:
    if not isinstance(plan, dict) or plan.get('rotation') not in (0, 90, 180, 270):
        raise PaperCropError('Choose a valid document rotation.')
    if plan.get('document_reviewed') is not True or plan.get('sections_reviewed') is not True:
        raise PaperCropError('Review the page corners and both section boundaries before OCR.')
    raw = plan.get('corners')
    if not isinstance(raw, list) or len(raw) != 4 or any(not isinstance(point, list) or len(point) != 2 for point in raw):
        raise PaperCropError('Four document corners are required.')
    try:
        corners = np.array(raw, dtype=np.float32)
    except (TypeError, ValueError) as exc:
        raise PaperCropError('Document corners must be numeric.') from exc
    if not np.isfinite(corners).all() or (corners < 0).any() or (corners > 1).any():
        raise PaperCropError('Document corners must stay inside the capture.')
    if cv2.contourArea(corners) < .1 or not cv2.isContourConvex(corners):
        raise PaperCropError('Document corners must outline a single visible page area.')
    sections = plan.get('sections')
    if not isinstance(sections, dict) or set(sections) != {'part_ii', 'part_iia'}:
        raise PaperCropError('Both Part II and Part II-A crop boundaries are required.')
    clean = {}
    for key in ('part_ii', 'part_iia'):
        bounds = sections[key]
        if not isinstance(bounds, list) or len(bounds) != 2:
            raise PaperCropError('Each section needs top and bottom boundaries.')
        try:
            top, bottom = float(bounds[0]), float(bounds[1])
        except (TypeError, ValueError) as exc:
            raise PaperCropError('Section boundaries must be numeric.') from exc
        if not math.isfinite(top) or not math.isfinite(bottom) or top < 0 or bottom > 1 or bottom-top < .025:
            raise PaperCropError('Each section needs a visible area inside the page.')
        clean[key] = [round(top, 5), round(bottom, 5)]
    if clean['part_ii'][0] >= clean['part_iia'][0] or clean['part_ii'][1] > clean['part_iia'][0] + .015:
        raise PaperCropError('Part II must appear before Part II-A without covering its fields.')
    return {'corners': [[round(float(value), 5) for value in point] for point in corners],
            'rotation': plan['rotation'], 'sections': clean,
            'document_reviewed': True, 'sections_reviewed': True}


def rectify(image: np.ndarray, corners: list[list[float]], rotation: int = 0) -> tuple[np.ndarray, np.ndarray]:
    height, width = image.shape[:2]
    source = np.array([[x * (width-1), y * (height-1)] for x, y in corners], dtype=np.float32)
    source = _order(source)
    page_width = max(1, round(max(np.linalg.norm(source[1]-source[0]), np.linalg.norm(source[2]-source[3])) + 1))
    page_height = max(1, round(max(np.linalg.norm(source[3]-source[0]), np.linalg.norm(source[2]-source[1])) + 1))
    if page_width * page_height > 40_000_000 or min(page_width, page_height) < 250:
        raise PaperCropError('Selected page is too small or too large to process safely.')
    destination = np.array([[0, 0], [page_width-1, 0], [page_width-1, page_height-1], [0, page_height-1]], dtype=np.float32)
    transform = cv2.getPerspectiveTransform(source, destination)
    page = cv2.warpPerspective(image, transform, (page_width, page_height), borderValue=(255, 255, 255))
    if rotation == 90:
        page = cv2.rotate(page, cv2.ROTATE_90_CLOCKWISE)
        turn = np.array([[0, -1, page_height-1], [1, 0, 0], [0, 0, 1]], dtype=np.float64)
    elif rotation == 180:
        page = cv2.rotate(page, cv2.ROTATE_180)
        turn = np.array([[-1, 0, page_width-1], [0, -1, page_height-1], [0, 0, 1]], dtype=np.float64)
    elif rotation == 270:
        page = cv2.rotate(page, cv2.ROTATE_90_COUNTERCLOCKWISE)
        turn = np.array([[0, 1, 0], [-1, 0, page_width-1], [0, 0, 1]], dtype=np.float64)
    else:
        turn = np.eye(3)
    return page, turn @ transform


def preview_data_url(page: np.ndarray) -> str:
    height, width = page.shape[:2]
    scale = min(1.0, 1400 / max(width, height))
    preview = cv2.resize(page, (round(width*scale), round(height*scale)), interpolation=cv2.INTER_AREA) if scale < 1 else page
    success, encoded = cv2.imencode('.jpg', preview, [cv2.IMWRITE_JPEG_QUALITY, 83])
    if not success:
        raise PaperCropError('Could not create the crop preview.')
    return 'data:image/jpeg;base64,' + base64.b64encode(encoded).decode('ascii')


def heading_positions(raw_text: str, layout: list[dict]) -> dict:
    positions = {}
    for line, box in zip(raw_text.splitlines(), layout):
        for key, pattern in ((APPLICANT, HEADINGS[APPLICANT]), (REPRESENTATIVE, HEADINGS[REPRESENTATIVE]), ('end', END)):
            if key not in positions and re.search(pattern, line, re.I):
                positions[key] = {'bbox': box['bbox'], 'score': box.get('engine_score', 0)}
    return positions


def suggest_sections(positions: dict, height: int) -> dict:
    applicant = positions.get(APPLICANT)
    representative = positions.get(REPRESENTATIVE)
    end = positions.get('end')
    ordered = (applicant and representative and end and
               applicant['bbox'][1] < representative['bbox'][1] < end['bbox'][1] and
               end['bbox'][1] - applicant['bbox'][1] > height * .08)
    if ordered:
        a_top = max(0, (applicant['bbox'][1] - height*.006) / height)
        r_top = max(0, (representative['bbox'][1] - height*.006) / height)
        e_top = max(0, (end['bbox'][1] - height*.006) / height)
        return {'part_ii': [round(a_top, 5), round(r_top, 5)],
                'part_iia': [round(r_top, 5), round(e_top, 5)],
                'confidence': 'suggested', 'warning': 'Compare both section boundaries with the printed headings and all field rows.'}
    return {'part_ii': [.20, .68], 'part_iia': [.68, .92], 'confidence': 'uncertain',
            'warning': 'The Part II, Part II-A, and Part III headings were not all confirmed in order. Adjust both sections manually before OCR.'}


def build_ocr_image(source_path: str | Path, plan: dict, output_path: str | Path) -> dict:
    plan = validate_plan(plan)
    image = load_capture(source_path)
    page, transform = rectify(image, plan['corners'], plan['rotation'])
    page_height, page_width = page.shape[:2]
    regions = []
    for key, title in (('part_ii', 'II. IMPORMASYON UKOL SA APLIKANTE'),
                       ('part_iia', 'II-A. IMPORMASYON UKOL SA REPRESENTATIVE')):
        top, bottom = plan['sections'][key]
        y1, y2 = round(top*page_height), round(bottom*page_height)
        regions.append((key, title, y1, y2, page[y1:y2]))
    band_height = max(70, round(page_width * .022))
    total_height = sum(region[4].shape[0] for region in regions) + band_height*3
    canvas = np.full((total_height, page_width, 3), 255, dtype=np.uint8)
    segments = []
    cursor = 0
    try:
        font = ImageFont.truetype('arial.ttf', max(30, round(band_height*.57)))
    except OSError:
        font = ImageFont.load_default()
    for key, title, y1, y2, crop in regions:
        band = Image.new('RGB', (page_width, band_height), 'white')
        ImageDraw.Draw(band).text((20, 5), title, fill='black', font=font)
        canvas[cursor:cursor+band_height] = cv2.cvtColor(np.asarray(band), cv2.COLOR_RGB2BGR)
        cursor += band_height
        canvas[cursor:cursor+crop.shape[0]] = crop
        segments.append({'section': key, 'ocr_top': cursor, 'ocr_bottom': cursor+crop.shape[0], 'page_top': y1})
        cursor += crop.shape[0]
    band = Image.new('RGB', (page_width, band_height), 'white')
    ImageDraw.Draw(band).text((20, 5), 'III. URI NG KASO', fill='black', font=font)
    canvas[cursor:cursor+band_height] = cv2.cvtColor(np.asarray(band), cv2.COLOR_RGB2BGR)
    success = cv2.imwrite(str(output_path), canvas, [cv2.IMWRITE_JPEG_QUALITY, 96])
    if not success:
        raise PaperCropError('Could not prepare the selected regions for OCR.')
    return {'plan': plan, 'segments': segments, 'original_size': [image.shape[1], image.shape[0]],
            'page_size': [page_width, page_height], 'ocr_size': [page_width, total_height],
            'original_sha256': hashlib.sha256(Path(source_path).read_bytes()).hexdigest(),
            'inverse_transform': np.linalg.inv(transform).tolist(),
            'generated_section_markers': ['II', 'II-A', 'III']}


def remap_field_evidence(result: dict, processing: dict) -> None:
    evidence = result.get('diagnostics', {}).get('field_evidence') or {}
    inverse = np.array(processing['inverse_transform'], dtype=np.float64)
    width, height = processing['original_size']
    for item in evidence.values():
        bbox = item.get('bbox')
        if not isinstance(bbox, list) or len(bbox) != 4:
            continue
        center = (bbox[1]+bbox[3])/2
        segment = next((part for part in processing['segments'] if part['ocr_top'] <= center <= part['ocr_bottom']), None)
        if not segment:
            item.pop('bbox', None)
            continue
        top = segment['page_top'] - segment['ocr_top']
        points = np.array([[[bbox[0], bbox[1]+top]], [[bbox[2], bbox[1]+top]],
                           [[bbox[2], bbox[3]+top]], [[bbox[0], bbox[3]+top]]], dtype=np.float64)
        original = cv2.perspectiveTransform(points, inverse).reshape(4, 2)
        item['processed_bbox'] = bbox
        item['bbox'] = [max(0, round(float(original[:, 0].min()))), max(0, round(float(original[:, 1].min()))),
                        min(width, round(float(original[:, 0].max()))), min(height, round(float(original[:, 1].max())))]
    result.setdefault('diagnostics', {})['capture_processing'] = {
        key: processing[key] for key in ('plan', 'original_size', 'page_size', 'ocr_size',
                                        'original_sha256', 'generated_section_markers')}
    result['diagnostics']['warnings'].append('OCR used the reviewed Part II and Part II-A crops. Generated headings only separate the regions; compare every value with the complete original capture.')
