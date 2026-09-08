import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np
import pandas as pd


PROJECT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = PROJECT_DIR / "backend"
SCAN_PATH = PROJECT_DIR / "temp_live_scan.jpg"
# Experimental/benchmark output only. This is not the JurisGuard operational database.
EXCEL_PATH = PROJECT_DIR / "benchmark_output" / "JurisGuard_LiveScanner_Experimental.xlsx"

if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import ai_service  # noqa: E402


CAMERA_INDEX = 0
FRAME_WIDTH = 1920
FRAME_HEIGHT = 1080
PROCESS_WIDTH = 960
FALLBACK_RESOLUTIONS = [(1920, 1080), (1280, 720), (640, 480)]
CAMERA_BACKENDS = [
    (cv2.CAP_DSHOW, "DirectShow"),
    (cv2.CAP_MSMF, "Media Foundation"),
    (cv2.CAP_ANY, "Default"),
]


def order_points(points):
    points = np.asarray(points, dtype="float32").reshape(4, 2)
    ordered = np.zeros((4, 2), dtype="float32")

    point_sum = points.sum(axis=1)
    point_diff = np.diff(points, axis=1)

    ordered[0] = points[np.argmin(point_sum)]
    ordered[2] = points[np.argmax(point_sum)]
    ordered[1] = points[np.argmin(point_diff)]
    ordered[3] = points[np.argmax(point_diff)]

    return ordered


def four_point_transform(image, points):
    rect = order_points(points)
    top_left, top_right, bottom_right, bottom_left = rect

    width_a = np.linalg.norm(bottom_right - bottom_left)
    width_b = np.linalg.norm(top_right - top_left)
    max_width = int(max(width_a, width_b))

    height_a = np.linalg.norm(top_right - bottom_right)
    height_b = np.linalg.norm(top_left - bottom_left)
    max_height = int(max(height_a, height_b))

    destination = np.array(
        [
            [0, 0],
            [max_width - 1, 0],
            [max_width - 1, max_height - 1],
            [0, max_height - 1],
        ],
        dtype="float32",
    )

    matrix = cv2.getPerspectiveTransform(rect, destination)
    return cv2.warpPerspective(image, matrix, (max_width, max_height))


def find_document_contour(frame):
    ratio = frame.shape[1] / float(PROCESS_WIDTH)
    resized_height = int(frame.shape[0] / ratio)
    resized = cv2.resize(frame, (PROCESS_WIDTH, resized_height))

    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edged = cv2.Canny(blurred, 50, 150)
    edged = cv2.dilate(edged, None, iterations=1)
    edged = cv2.erode(edged, None, iterations=1)

    contours, _ = cv2.findContours(edged, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:8]

    min_area = resized.shape[0] * resized.shape[1] * 0.12
    best_contour = None
    best_area = 0

    for contour in contours:
        perimeter = cv2.arcLength(contour, True)
        approximation = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
        area = cv2.contourArea(approximation)

        if len(approximation) == 4 and area > min_area and area > best_area:
            best_contour = approximation.reshape(4, 2)
            best_area = area

    if best_contour is None:
        return None

    return (best_contour * ratio).astype("float32")


def draw_scanner_overlay(frame, document_contour):
    display = frame.copy()

    if document_contour is not None:
        contour = document_contour.astype("int32")
        cv2.polylines(display, [contour], True, (0, 255, 0), 5)
        cv2.putText(
            display,
            "Document detected - press SPACE to scan",
            (40, 60),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.0,
            (0, 255, 0),
            3,
            cv2.LINE_AA,
        )
    else:
        cv2.putText(
            display,
            "Align the PAO form inside the camera view",
            (40, 60),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.0,
            (0, 220, 255),
            3,
            cv2.LINE_AA,
        )

    cv2.putText(
        display,
        "SPACE: scan | Q/ESC: quit",
        (40, frame.shape[0] - 40),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.8,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )
    return display


def append_json_to_excel(extracted_json):
    """Write opt-in experimental output; it may contain sensitive information."""
    EXCEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    row = pd.json_normalize(extracted_json)

    if EXCEL_PATH.exists():
        existing = pd.read_excel(EXCEL_PATH)
        combined = pd.concat([existing, row], ignore_index=True)
    else:
        combined = row

    combined.to_excel(EXCEL_PATH, index=False)
    print(f"[Excel] Saved extraction row to {EXCEL_PATH}")


def scan_current_frame(frame, document_contour, write_benchmark_excel=False):
    if document_contour is None:
        print("[Scanner] No document detected. Align the paper and try again.")
        return

    warped = four_point_transform(frame, document_contour)
    cv2.imwrite(str(SCAN_PATH), warped, [int(cv2.IMWRITE_JPEG_QUALITY), 100])
    print(
        f"[Scanner] Saved flattened scan to {SCAN_PATH} "
        f"({warped.shape[1]}x{warped.shape[0]})"
    )

    print("[AI] Running JurisGuard extraction...")
    extracted_json = ai_service.process_document(str(SCAN_PATH))

    print("\n===== JURISGUARD EXTRACTION JSON =====")
    print(json.dumps(extracted_json, indent=2, ensure_ascii=False))
    print("======================================\n")

    if write_benchmark_excel:
        print("[Warning] Experimental Excel output may contain sensitive information.")
        append_json_to_excel(extracted_json)
    else:
        print("[Scanner] No Excel output written. Use the authenticated API for operational records.")


def is_solid_green_frame(frame):
    if frame is None or frame.size == 0:
        return True

    blue, green, red = cv2.mean(frame)[:3]
    return green > 120 and red < 40 and blue < 40


def configure_capture(capture, width, height):
    capture.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
    capture.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    capture.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    capture.set(cv2.CAP_PROP_FPS, 30)


def read_warm_frame(capture, attempts=12):
    frame = None
    for _ in range(attempts):
        ok, candidate = capture.read()
        if ok:
            frame = candidate
    return frame


def open_camera():
    last_error = "Unable to open webcam. Check the camera index or webcam permissions."

    for backend, backend_name in CAMERA_BACKENDS:
        for width, height in FALLBACK_RESOLUTIONS:
            capture = cv2.VideoCapture(CAMERA_INDEX, backend)
            if not capture.isOpened():
                capture.release()
                continue

            configure_capture(capture, width, height)
            frame = read_warm_frame(capture)
            actual_width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
            actual_height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
            print(
                f"[Camera] {backend_name}: requested {width}x{height}, "
                f"using {actual_width}x{actual_height}"
            )

            if frame is not None and not is_solid_green_frame(frame):
                return capture

            last_error = (
                "Camera opened but returned a solid green frame. "
                "Trying another camera mode..."
            )
            print(f"[Camera] {last_error}")
            capture.release()

    raise RuntimeError(last_error)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Experimental JurisGuard webcam/benchmark scanner")
    parser.add_argument(
        "--write-benchmark-excel",
        action="store_true",
        help="Explicitly write experimental Excel output (may contain sensitive information).",
    )
    args = parser.parse_args(argv)
    print("[JurisGuard Live Scanner] Experimental utility; not an operational database client.")
    print("[JurisGuard Live Scanner] Prefer the authenticated API for real-system document submission.")
    print("[JurisGuard Live Scanner] Press SPACE to capture, Q or ESC to quit.")

    capture = open_camera()
    last_document_contour = None

    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                print("[Camera] Failed to read frame.")
                break

            document_contour = find_document_contour(frame)
            if document_contour is not None:
                last_document_contour = document_contour

            display = draw_scanner_overlay(frame, document_contour)
            cv2.imshow("JurisVault Live PAO Scanner", display)

            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), 27):
                break
            if key == 32:
                contour_to_scan = document_contour if document_contour is not None else last_document_contour
                scan_current_frame(frame, contour_to_scan, write_benchmark_excel=args.write_benchmark_excel)

    finally:
        capture.release()
        cv2.destroyAllWindows()
        print("[JurisGuard Live Scanner] Closed.")


if __name__ == "__main__":
    main()
