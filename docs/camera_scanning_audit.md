# Camera scanning audit — 2026-11-04

## Cause

The normal PAO intake screen showed an unnamed `Camera 1` before permission, while its separate **Detect cameras** action opened and immediately released a temporary stream. On the existing Edge tab, that request waited and timed out without showing a usable preview. A camera name and stable device ID can be hidden by the browser until permission is granted, so that initial listing alone cannot identify hardware. The old camera selector also stopped the current stream without opening the newly selected device. Finally, `video.play()` could resolve before a drawable frame existed, enabling capture prematurely. The intake panel's 35dvh height clipped most of the preview.

The existing Edge profile's permission prompt/state could not be inspected conclusively. An isolated Edge session with camera permission granted opened both physical cameras, so device availability and the local camera API work on this machine.

## Changes

- Enumerate cameras on opening and on **Refresh camera list**. Show a count; list unnamed devices as requiring permission to identify; label the selected stream **Active camera** with its actual track name and preview dimensions.
- Make selecting another camera release the prior stream and immediately open the new preview. Handle disconnects and release streams on capture, stop, switch, and component close.
- Wait for a video frame with nonzero dimensions before enabling **Capture photo**. Report browser/Windows permission denial, no device, busy camera, unavailable selection, and timeouts with recovery steps.
- Give the camera area 70dvh while open so the preview and controls remain visible in the intake modal.

## Verification

| Test | Result |
| --- | --- |
| Existing Edge intake tab before the fix | Generic `Camera 1`; Detect cameras timed out. |
| Physical integrated camera, separate permission-granted Edge session | Live 1280×720 preview; JPEG capture succeeded. |
| Physical NETUM camera | Switched from integrated camera; live 3264×2160 preview succeeded. Previous track ended. |
| Capture, retake, and close on hardware | Captured JPEG; prior track ended on capture; retake reopened; previous track ended on switch; current track ended on close. This initial camera-access test did not send a hardware photo to OCR; the NETUM crop follow-up below did. |
| Two synthetic cameras in rendered component | Active name, preview readiness, device switch, old-stream release, JPEG callback, retake, reopen, close, unnamed device listing, and denial/busy/no-device messages passed. |
| Synthetic PAO sheet captured through the camera component | JPEG proceeded through local PaddleOCR into the actual Part II/II-A review screen. Both synthetic names were extracted; a corrected applicant name saved and reopened; original scan was retained. Temporary test database was removed. |

The browser smoke test uses a synthetic sheet and an installed local Edge binary. Run `backend/venv/Scripts/python.exe -m pip install playwright` once for the test environment, then run `backend/venv/Scripts/python.exe tests/frontend/camera_browser_smoke.py` with Vite on port 5173. The captured synthetic image and screenshot stay in ignored `.local/camera-audit/`.

The existing browser profile may still need camera permission granted for `http://127.0.0.1:5173`; Windows camera privacy access and other apps can also affect it. Device-busy and denial messages were verified with simulated browser errors, not by locking or denying the physical camera.

## NETUM document crop follow-up

The [NETUM document camera support page](https://www.netum.net/pages/document-camera-support) lists NetumScan Pro and an SDK separately from the UVC camera stream. The browser exposes device selection, camera resolution, and some capture controls through [MediaStreamTrack capabilities](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getCapabilities). The connected NETUM reported no document-edge, deskew, or perspective control through that API. Browser `crop-and-scale` describes video-frame resizing for constraints, not paper-boundary detection. NetumScan Pro may crop in its own application; JurisGuard now implements its own browser capture and local crop preparation.

- NETUM preview now requests `resizeMode: none`, yielding the camera's full 3264×2448 frame on this machine instead of the earlier 3264×2160 crop. The interface displays the active camera and preview dimensions. Capture produced a 1.47 MB JPEG; switching to the integrated camera ended the NETUM track; closing and reopening started a new NETUM preview.
- Before OCR, a local analysis suggests four page corners only when all edges are inside the photo, straightens the selected quadrilateral, and looks for the Part II, Part II-A, and Part III printed headings. The attorney reviews and can drag or numerically change corners, rotate in quarter turns, and adjust both section boundaries. Uncertain headings require boundary adjustment and confirmation.
- OCR receives only the two attorney-reviewed section regions. Structural section headings are generated as OCR separators; they are not field evidence. The complete original JPEG is stored, and field coordinates from the processed image are mapped back to the original for scan highlighting. Re-reading uses the saved crop plan.
- A private capture of the sheet under the connected NETUM had all retained rows visible, but the page ran beyond the top and bottom of the 3264×2448 frame. Full-page auto crop correctly returned **uncertain** rather than claiming the cut edges were found. Local heading OCR found the three headings in order and suggested both section ranges. Focused local OCR returned only Part II and II-A, and the blank representative section stayed blank. Initial checkbox detection returned **unknown** because generated structural headings and printed headings appeared twice, so the detector stopped before reading pixels. The focused fix accepts only adjacent heading pairs; on the same photograph it then located one physical Oo/Hindi pair and read **Oo unchecked, Hindi checked**. No real image, text, or generated output was committed.
- A synthetic camera image completed capture → crop review → local OCR → Part II/II-A correction → save → reopen in a disposable database. The original JPEG remained available. A second synthetic run obscured all three section headings; extraction stayed disabled until the attorney adjusted both section ranges, then review and save succeeded. Five geometry/evidence tests cover a tilted page, clipped-page fallback, ordered/missing headings, review validation, selected-region OCR preparation, original-coordinate mapping, and quarter-turn rotation.

Remaining limits: the whole page cannot be recovered when it extends outside the camera frame. The attorney must reposition the sheet or use the visible retained-section crop knowingly. Rotation is a reviewed quarter turn, with perspective correction from four corners; automatic arbitrary-angle orientation is not inferred. Weak handwriting and small checkbox marks still require comparison with the original. Auto crop and checkbox detection are suggestions, not attorney-approved field values.
