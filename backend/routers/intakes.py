import asyncio
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import null
from sqlalchemy.orm import Session

import models
from extraction_mapping import public_extraction_payload
from extraction_runtime import (
    ExtractionBusy,
    ExtractionCancelled,
    ExtractionTimeout,
    ExtractionWorkerError,
)
from schemas import PaperIntakePayload, paper_compat_text
from upload_validation import save_bounded_upload, verify_image


def store_paper_draft(db, document_id, extracted):
    from paper_provenance import canonical_digest

    draft_id = canonical_digest({"document_id": document_id, "extraction": extracted})
    if db.get(models.PaperExtractionDraft, draft_id) is None:
        db.add(models.PaperExtractionDraft(draft_id=draft_id, document_id=document_id, extraction_json=extracted))
    return draft_id


def reviewed_candidate_source(db, payload, fallback=None):
    if payload.source_draft_id is None:
        return fallback
    draft = db.get(models.PaperExtractionDraft, payload.source_draft_id)
    if draft is None or draft.document_id != payload.document_id:
        raise HTTPException(422, "The extraction draft does not match this original scan. Re-extract and review again.")
    return draft.extraction_json


def read_archived_document(location: Path) -> bytes:
    from cryptography.exceptions import InvalidTag
    from document_storage import read_document

    try:
        return read_document(location)
    except (InvalidTag, RuntimeError, OSError, ValueError) as exc:
        raise HTTPException(503, "The archived document could not be opened.") from exc


def register_intake_routes(
    app: FastAPI,
    *,
    current_user,
    get_db,
    is_admin,
    ensure_case_access,
    ensure_client_access,
    get_client_payload,
    commit_or_client_error,
    write_audit,
    upload_dir: Path,
    document_content_types: dict[str, set[str]],
    max_document_bytes: int,
    get_extract_document,
) -> None:
    def authorized_paper_document(document_id: int, user: models.User, db: Session):
        document = db.get(models.Document, document_id)
        if not document:
            raise HTTPException(404, "Document not found")
        saved = db.query(models.ReviewedPaperIntake).filter_by(document_id=document_id).first()
        if document.case_id is not None:
            ensure_case_access(db.get(models.Case, document.case_id), user)
        elif document.intake_id is not None and not is_admin(user):
            intake = db.get(models.IntakeRecord, document.intake_id)
            if not intake or intake.interviewer_id != user.user_id:
                raise HTTPException(403, "Record access denied")
        elif saved:
            ensure_client_access(db.get(models.Client, saved.client_id), user, db)
        elif not is_admin(user) and document.uploaded_by != user.user_id:
            raise HTTPException(403, "Record access denied")
        location = Path(document.encrypted_file_path).resolve()
        if not location.is_relative_to(upload_dir.resolve()) or not location.is_file():
            raise HTTPException(404, "Document not found")
        return location, document.document_type

    @app.get("/api/pao-intakes/schema")
    def paper_intake_schema(user: models.User = Depends(current_user)):
        from paper_intake import SCHEMA

        return SCHEMA

    @app.post("/api/pao-intakes/prepare-camera")
    async def prepare_camera_image(file: UploadFile = File(...), user: models.User = Depends(current_user)):
        from camera_preparation import prepare_capture

        extension = Path(file.filename or "").suffix.lower()
        if (
            extension not in (".jpg", ".jpeg", ".png", ".webp")
            or file.content_type not in document_content_types.get(extension, set())
        ):
            raise HTTPException(400, "Camera review requires a JPG, PNG or WEBP capture.")
        source = upload_dir / f"{uuid.uuid4()}-camera{extension}"
        try:
            save_bounded_upload(file.file, source, max_document_bytes)
            verify_image(source, extension)
            return await asyncio.to_thread(prepare_capture, source)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        finally:
            source.unlink(missing_ok=True)

    @app.get("/api/pao-intakes/documents/{document_id}")
    def paper_intake_scan(
        document_id: int,
        request: Request,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        location, media_type = authorized_paper_document(document_id, user, db)
        headers = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"}
        response = (
            Response(read_archived_document(location), media_type=media_type, headers=headers)
            if location.suffix == ".enc"
            else FileResponse(location, media_type=media_type, headers=headers)
        )
        write_audit(db, user.user_id, "Read Document", "document", entity_id=str(document_id), request=request)
        db.commit()
        return response

    @app.get("/api/pao-intakes/documents/{document_id}/pages/{page_number}")
    def paper_intake_page(
        document_id: int,
        page_number: int,
        request: Request,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        """Render at the same scale as local OCR so evidence boxes share coordinates."""
        location, media_type = authorized_paper_document(document_id, user, db)
        if page_number < 1:
            raise HTTPException(404, "Page not found")
        import io
        import pypdfium2 as pdfium

        if media_type != "application/pdf":
            raise HTTPException(400, "Page preview requires a PDF")
        source = read_archived_document(location) if location.suffix == ".enc" else str(location)
        with pdfium.PdfDocument(source) as document:
            page_count = len(document)
            if page_number > len(document):
                raise HTTPException(404, "Page not found")
            page = document[page_number - 1]
            try:
                if page.get_width() * page.get_height() * 4 > 40_000_000:
                    raise HTTPException(413, "Page is too large to preview. Open the original scan.")
                bitmap = page.render(scale=2)
                try:
                    image = bitmap.to_pil()
                    output = io.BytesIO()
                    image.save(output, format="PNG")
                finally:
                    bitmap.close()
            finally:
                page.close()
        write_audit(
            db,
            user.user_id,
            "Read Document Page",
            "document",
            f"Rendered page {page_number}",
            str(document_id),
            request,
        )
        db.commit()
        return Response(
            output.getvalue(),
            media_type="image/png",
            headers={
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
                "X-Page-Count": str(page_count),
                "Access-Control-Expose-Headers": "X-Page-Count",
            },
        )

    @app.post("/api/pao-intakes/")
    def save_paper_intake(
        payload: PaperIntakePayload,
        request: Request,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        from paper_intake import APPLICANT, REPRESENTATIVE, validate_review

        try:
            validate_review(payload.sections, payload.unreadable_fields or [], payload.field_reviews)
            from paper_checkboxes import reviewed_detained, validate_boxes

            validate_boxes(payload.checkbox_states, payload.sections)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        # Lock the source to serialize double clicks and concurrent save attempts.
        document = db.query(models.Document).filter_by(document_id=payload.document_id).with_for_update().first()
        if not document:
            raise HTTPException(404, "Document not found")
        if not is_admin(user) and document.uploaded_by != user.user_id:
            raise HTTPException(403, "Record access denied")
        metadata = db.query(models.ExtractedMetadata).filter_by(document_id=payload.document_id).first()
        if not metadata or metadata.extracted_json.get("intake_scope") != "pao_parts_ii_iia":
            raise HTTPException(422, "Scan the PAO sheet in the intake workflow first.")
        if db.query(models.ReviewedPaperIntake).filter_by(document_id=payload.document_id).first():
            raise HTTPException(409, "This reviewed sheet is already saved.")
        candidate_snapshot = reviewed_candidate_source(db, payload, metadata.extracted_json)
        applicant, representative = payload.sections[APPLICANT], payload.sections[REPRESENTATIVE]

        def age(value):
            return int(value) if value.isascii() and value.isdigit() and len(value) <= 3 else None

        client = models.Client(
            created_by_user_id=user.user_id,
            **{
                key: paper_compat_text(models.Client, key, applicant[key])
                for key in (
                    "name",
                    "sex",
                    "civil_status",
                    "religion",
                    "educational_attainment",
                    "citizenship",
                    "language_dialect",
                )
            },
            age=age(applicant["age"]),
        )
        db.add(client)
        db.flush()
        db.add(
            models.ClientDetails(
                client_id=client.client_id,
                address=applicant["address"],
                contact_no=applicant["contact_no"],
                email=applicant["email"],
                individual_monthly_income=applicant["individual_monthly_income"],
                spouse=applicant["spouse_name"],
                address_of_spouse=applicant["spouse_address"],
                contact_no_of_spouse=applicant["spouse_contact_no"],
                representative_name=representative["name"],
                representative_age=age(representative["age"]),
                representative_sex=paper_compat_text(models.ClientDetails, "representative_sex", representative["sex"]),
                representative_civil_status=paper_compat_text(
                    models.ClientDetails,
                    "representative_civil_status",
                    representative["civil_status"],
                ),
                representative_address=representative["address"],
                representative_contact_no=representative["contact_no"],
                representative_relationship=paper_compat_text(
                    models.ClientDetails,
                    "representative_relationship",
                    representative["relationship_to_applicant"],
                ),
                representative_email=representative["email"],
                detained=reviewed_detained(payload.checkbox_states)
                if reviewed_detained(payload.checkbox_states) is not None
                else null(),
                detained_since=None,
                place_of_detention=paper_compat_text(
                    models.ClientDetails,
                    "place_of_detention",
                    applicant["place_of_detention"],
                ),
            )
        )
        db.add(
            models.ReviewedPaperIntake(
                client_id=client.client_id,
                document_id=document.document_id,
                reviewed_by=user.user_id,
                sections=payload.sections,
                unreadable_fields=payload.unreadable_fields or [],
                field_reviews=payload.field_reviews,
                checkbox_states=payload.checkbox_states,
                source_draft_id=payload.source_draft_id,
                candidate_snapshot=candidate_snapshot,
            )
        )
        metadata.verified_by = user.user_id
        metadata.verified_at = datetime.now(timezone.utc)
        metadata.verification_status = "REVIEWED"
        write_audit(
            db,
            user.user_id,
            "Review Intake",
            "client",
            "Reviewed PAO Parts II and II-A",
            str(client.client_id),
            request,
        )
        commit_or_client_error(db, "create")
        db.refresh(client)
        return get_client_payload(client)

    @app.patch("/api/pao-intakes/{client_id}")
    def update_paper_intake(
        client_id: int,
        payload: PaperIntakePayload,
        request: Request,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        from paper_intake import APPLICANT, REPRESENTATIVE, validate_review

        client = ensure_client_access(db.get(models.Client, client_id), user, db)
        saved = db.query(models.ReviewedPaperIntake).filter_by(client_id=client_id).with_for_update().first()
        if not saved or saved.document_id != payload.document_id:
            raise HTTPException(422, "Reviewed intake source does not match.")
        try:
            validate_review(payload.sections, payload.unreadable_fields or [], payload.field_reviews)
            from paper_checkboxes import reviewed_detained, validate_boxes

            validate_boxes(payload.checkbox_states, payload.sections)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        if payload.checkbox_states is None and saved.checkbox_states is not None:
            try:
                validate_boxes(saved.checkbox_states, payload.sections)
            except ValueError as exc:
                raise HTTPException(422, "Review the stored checkbox states before changing Nakakulong.") from exc
        if payload.source_draft_id is not None:
            saved.candidate_snapshot = reviewed_candidate_source(db, payload)
            saved.source_draft_id = payload.source_draft_id
        saved.sections = payload.sections
        if payload.checkbox_states is not None:
            saved.checkbox_states = payload.checkbox_states
        if payload.unreadable_fields is not None:
            saved.unreadable_fields = payload.unreadable_fields
        if payload.field_reviews is not None:
            saved.field_reviews = payload.field_reviews
        saved.reviewed_by, saved.reviewed_at = user.user_id, datetime.now(timezone.utc)
        applicant, representative = payload.sections[APPLICANT], payload.sections[REPRESENTATIVE]
        for key in (
            "name",
            "sex",
            "civil_status",
            "religion",
            "educational_attainment",
            "citizenship",
            "language_dialect",
        ):
            setattr(client, key, paper_compat_text(models.Client, key, applicant[key]))

        def age(value):
            return int(value) if value.isascii() and value.isdigit() and len(value) <= 3 else None

        client.age = age(applicant["age"])
        details = client.details
        if details is None:
            details = models.ClientDetails(client_id=client_id, detained=null())
            db.add(details)
        for source, target in [
            ("address", "address"),
            ("contact_no", "contact_no"),
            ("email", "email"),
            ("individual_monthly_income", "individual_monthly_income"),
            ("spouse_name", "spouse"),
            ("spouse_address", "address_of_spouse"),
            ("spouse_contact_no", "contact_no_of_spouse"),
            ("place_of_detention", "place_of_detention"),
        ]:
            setattr(details, target, paper_compat_text(models.ClientDetails, target, applicant[source]))
        for source, target in [
            ("name", "name"),
            ("sex", "sex"),
            ("civil_status", "civil_status"),
            ("address", "address"),
            ("contact_no", "contact_no"),
            ("email", "email"),
            ("relationship_to_applicant", "relationship"),
        ]:
            setattr(
                details,
                f"representative_{target}",
                paper_compat_text(models.ClientDetails, f"representative_{target}", representative[source]),
            )
        if payload.checkbox_states is not None:
            projected = reviewed_detained(payload.checkbox_states)
            details.detained = projected if projected is not None else null()
        details.representative_age = age(representative["age"])
        write_audit(
            db,
            user.user_id,
            "Review Intake",
            "client",
            "Corrected reviewed PAO Parts II and II-A",
            str(client_id),
            request,
        )
        commit_or_client_error(db, "update")
        db.refresh(client)
        return get_client_payload(client)

    @app.post("/api/pao-intakes/documents/{document_id}/extract")
    async def reread_paper_intake(
        document_id: int,
        request: Request,
        extraction_mode: Literal["auto", "offline", "cloud"] = Query(default="auto"),
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        location, media_type = authorized_paper_document(document_id, user, db)
        metadata = db.query(models.ExtractedMetadata).filter_by(document_id=document_id).first()
        if not metadata or metadata.extracted_json.get("intake_scope") != "pao_parts_ii_iia":
            raise HTTPException(422, "This document is not a PAO paper intake.")
        if media_type == "application/pdf" and extraction_mode == "cloud":
            raise HTTPException(400, "Cloud mode does not support PDFs. Select offline mode.")
        from tempfile import TemporaryDirectory

        extract_fn = get_extract_document()
        try:
            if location.suffix == ".enc":
                with TemporaryDirectory(prefix="jurisguard-reread-") as directory:
                    source = Path(directory) / location.stem
                    source.write_bytes(read_archived_document(location))
                    extracted = await extract_fn(
                        str(source),
                        extraction_mode,
                        "paper_intake",
                        is_disconnected=request.is_disconnected,
                    )
            else:
                extracted = await extract_fn(
                    str(location),
                    extraction_mode,
                    "paper_intake",
                    is_disconnected=request.is_disconnected,
                )
        except ExtractionBusy as exc:
            raise HTTPException(503, "OCR is busy. Retry after the current scan finishes.", headers={"Retry-After": "5"}) from exc
        except ExtractionTimeout as exc:
            raise HTTPException(504, "OCR timed out. Review the source or retry.") from exc
        except ExtractionCancelled as exc:
            raise HTTPException(499, "Document extraction cancelled.") from exc
        except ExtractionWorkerError as exc:
            raise HTTPException(503, "OCR worker failed. Retry or review the scan manually.") from exc
        public = public_extraction_payload(extracted)
        draft_id = store_paper_draft(db, document_id, public)
        write_audit(db, user.user_id, "Re-extract Document", "document", entity_id=str(document_id), request=request)
        db.commit()
        return {"document_id": document_id, "source_draft_id": draft_id, "extracted_data": public}

    @app.post("/api/pao-intakes/capture-analyze")
    async def analyze_paper_capture(
        request: Request,
        file: UploadFile = File(...),
        corners_json: str | None = Form(default=None),
        rotation: int = Form(default=0),
        user: models.User = Depends(current_user),
    ):
        """Return local crop suggestions; the uploaded image is not a saved record."""
        from paper_capture import (
            PaperCropError,
            detect_document,
            load_capture,
            preview_data_url,
            rectify,
            suggest_sections,
            validate_plan,
        )

        original_name = Path(file.filename or "camera.jpg").name
        extension = Path(original_name).suffix.lower()
        if extension not in document_content_types or file.content_type not in document_content_types[extension]:
            raise HTTPException(400, "Crop review requires a JPG, PNG, WEBP, or single-page PDF scan.")
        if rotation not in (0, 90, 180, 270):
            raise HTTPException(422, "Choose a quarter-turn rotation.")
        source = upload_dir / f"{uuid.uuid4()}{extension}"
        page_file = upload_dir / f"{uuid.uuid4()}-crop-preview.jpg"
        extract_fn = get_extract_document()
        try:
            save_bounded_upload(file.file, source, max_document_bytes)
            if extension != ".pdf":
                verify_image(source, extension)
            image = await asyncio.to_thread(load_capture, source)
            detected = await asyncio.to_thread(detect_document, image)
            corners = detected["corners"]
            if corners_json:
                try:
                    raw_corners = json.loads(corners_json)
                    corners = validate_plan(
                        {
                            "corners": raw_corners,
                            "rotation": rotation,
                            "sections": {"part_ii": [0.2, 0.6], "part_iia": [0.6, 0.9]},
                            "document_reviewed": True,
                            "sections_reviewed": True,
                        }
                    )["corners"]
                except (json.JSONDecodeError, PaperCropError) as exc:
                    raise HTTPException(422, str(exc)) from exc
            page, _ = await asyncio.to_thread(rectify, image, corners, rotation)
            import cv2

            if not cv2.imwrite(str(page_file), page, [cv2.IMWRITE_JPEG_QUALITY, 93]):
                raise PaperCropError("Could not prepare the preview.")
            warnings = []
            try:
                headings = await extract_fn(
                    str(page_file),
                    "offline",
                    "paper_boundaries",
                    is_disconnected=request.is_disconnected,
                )
                positions = headings.get("headings", {})
                warnings.extend(headings.get("warnings") or [])
            except (ExtractionBusy, ExtractionTimeout, ExtractionWorkerError, ExtractionCancelled):
                positions = {}
                warnings.append("Automatic heading detection was unavailable. Set both section boundaries manually.")
            sections = suggest_sections(positions, page.shape[0])
            if detected["confidence"] == "uncertain" and not corners_json:
                warnings.append(detected["warning"])
            if sections["confidence"] == "uncertain":
                warnings.append(sections["warning"])
            return {
                "document": {
                    "corners": corners,
                    "confidence": "manual" if corners_json else detected["confidence"],
                    "warning": detected["warning"] if not corners_json else "Check the adjusted page before OCR.",
                },
                "rotation": rotation,
                "original_size": [image.shape[1], image.shape[0]],
                "page": {"width": page.shape[1], "height": page.shape[0], "preview": preview_data_url(page)},
                "original_preview": preview_data_url(image) if extension == ".pdf" else None,
                "sections": sections,
                "headings_found": {
                    key: key in positions
                    for key in ("applicant_personal_circumstances", "representative_personal_circumstances", "end")
                },
                "warnings": warnings,
            }
        except HTTPException:
            raise
        except PaperCropError as exc:
            raise HTTPException(422, str(exc)) from exc
        finally:
            source.unlink(missing_ok=True)
            page_file.unlink(missing_ok=True)
