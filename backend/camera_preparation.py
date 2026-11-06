"""Local, conservative capture preparation. Never synthesizes document content."""
import base64
import io
import os
import shutil
import subprocess
import tempfile
import re
import cv2
import numpy as np
from PIL import Image, ImageOps


def detect_orientation(image):
    """Use an explicitly installed local OSD engine; never download models."""
    executable = os.getenv('TESSERACT_CMD') or shutil.which('tesseract')
    if not executable:
        return 0, 0
    with tempfile.TemporaryDirectory(prefix='jurisguard-orientation-') as folder:
        source = os.path.join(folder, 'capture.png')
        Image.fromarray(image).save(source)
        result = subprocess.run([executable, source, 'stdout', '--psm', '0'], capture_output=True, text=True, timeout=8,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    angle = re.search(r'Rotate:\s*(\d+)', result.stdout)
    confidence = re.search(r'Orientation confidence:\s*([\d.]+)', result.stdout)
    return (int(angle[1]), float(confidence[1])) if angle and confidence and result.returncode == 0 else (0, 0)


def document_corners(image):
    h, w = image.shape[:2]
    scale = min(1, 1200 / max(h, w))
    small = cv2.resize(image, None, fx=scale, fy=scale)
    gray = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)
    contours, _ = cv2.findContours(cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 45, 135), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    candidates = []
    for contour in contours:
        area = cv2.contourArea(contour) / gray.size
        polygon = cv2.approxPolyDP(contour, .02 * cv2.arcLength(contour, True), True)
        if not .35 < area < .94 or len(polygon) != 4 or not cv2.isContourConvex(polygon):
            continue
        points = polygon[:, 0, :].astype(np.float32)
        total, diff = points.sum(axis=1), points[:, 0] - points[:, 1]
        points = np.array([points[total.argmin()], points[diff.argmax()], points[total.argmax()], points[diff.argmin()]])
        if len(np.unique(points, axis=0)) != 4 or not cv2.isContourConvex(points):
            continue
        lengths = [np.linalg.norm(points[(i+1)%4]-points[i]) for i in range(4)]
        if min(lengths) < 20 or not .45 < max(lengths[0], lengths[2])/max(lengths[1], lengths[3]) < 2.2:
            continue
        margin = min(gray.shape) * .025
        if any(x < margin or y < margin or x > gray.shape[1]-margin or y > gray.shape[0]-margin for x, y in points):
            continue
        mask = np.zeros(gray.shape, np.uint8)
        cv2.fillConvexPoly(mask, points.astype(np.int32), 255)
        # Avoid treating a printed table or dark rectangular object as the page.
        inside, outside = gray[mask > 0], gray[mask == 0]
        if not len(outside) or np.median(inside) < 145 or np.median(inside)-np.median(outside) < 25:
            continue
        ring = (cv2.dilate(mask, np.ones((9,9),np.uint8)) > 0) & (mask == 0)
        if not ring.any() or np.median(inside)-np.median(gray[ring]) < 20:
            continue
        candidates.append((area, points/scale))
    if not candidates:
        return None
    points = max(candidates, key=lambda item: item[0])[1]
    # Expand outwards slightly to retain border-adjacent marks.
    center = points.mean(axis=0)
    return np.clip(center+(points-center)*1.015, [0, 0], [w-1, h-1]).astype(np.float32)


def conservative_lighting(image):
    small = cv2.resize(image, (96, 96), interpolation=cv2.INTER_AREA)
    background = cv2.GaussianBlur(cv2.cvtColor(small, cv2.COLOR_RGB2GRAY), (0, 0), 8)
    correction = np.clip((float(np.median(background))-background.astype(np.float32))*.35, -8, 12)
    correction = cv2.resize(correction, (image.shape[1], image.shape[0]), interpolation=cv2.INTER_LINEAR)
    result = (image.astype(np.float32)+correction[:, :, None]-128)*1.02+128
    # Bound changes and avoid washing faint, nonwhite strokes into pure white.
    result = np.clip(result, image.astype(np.float32)-12, image.astype(np.float32)+14)
    result = np.where(image < 250, np.minimum(result, 249), result)
    return np.clip(result, 0, 255).astype(np.uint8)


def prepare_capture(path):
    with Image.open(path) as source:
        if source.width*source.height > 24_000_000:
            raise ValueError('Retake at a resolution below 24 megapixels.')
        image = np.asarray(ImageOps.exif_transpose(source).convert('RGB')).copy()
    warnings = []
    corners = document_corners(image)
    if corners is not None:
        a, b, c, d = corners
        width = round(max(np.linalg.norm(b-a), np.linalg.norm(c-d)))
        height = round(max(np.linalg.norm(d-a), np.linalg.norm(c-b)))
        transform = cv2.getPerspectiveTransform(corners, np.float32([[0,0],[width-1,0],[width-1,height-1],[0,height-1]]))
        image = cv2.warpPerspective(image, transform, (width,height), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    else:
        warnings.append('Paper boundaries are uncertain. Set the crop manually; retake if a page edge or required field is missing.')
    rotation = 0
    try:
        angle, confidence = detect_orientation(image)
        if confidence >= 12:
            rotation = angle
            if rotation in (90,180,270):
                image = np.rot90(image, -(rotation//90)).copy()
        else:
            warnings.append('Orientation could not be confirmed. Retake upright if the text is sideways or upside down.')
    except Exception:
        warnings.append('Orientation could not be confirmed. Retake upright if the text is sideways or upside down.')
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    h, w = gray.shape
    interior = gray[max(0,h//20):max(1,h-h//20), max(0,w//20):max(1,w-w//20)]
    if cv2.Laplacian(interior, cv2.CV_64F).var() < 35:
        warnings.append('The photo may be blurred or lack readable detail. Retake closer, hold the camera steady and check handwriting and checkbox marks.')
    # Saturation alone also describes blank paper; warn only on abrupt bright patches in a dark capture.
    if np.percentile(gray, 50) < 150 and (gray > 252).mean() > .025:
        warnings.append('Possible glare or strong lighting contrast. Retake without reflections if any text or checkbox mark is obscured.')
    image = conservative_lighting(image)
    output = io.BytesIO()
    Image.fromarray(image).save(output, format='PNG')
    if output.tell() > 25*1024*1024:
        raise ValueError('The prepared image exceeds 25 MB. Retake at a lower camera resolution.')
    return {'image_base64': base64.b64encode(output.getvalue()).decode(), 'boundary_confident': corners is not None,
            'rotation': rotation, 'warnings': warnings, 'width': image.shape[1], 'height': image.shape[0]}
