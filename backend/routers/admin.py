import json

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from sqlalchemy.orm import Session

import models
from schemas import ApprovalUpdatePayload, ResolveClientOwnerPayload


def register_admin_routes(
    app: FastAPI,
    *,
    admin_user,
    get_db,
    is_admin,
    user_to_admin,
    user_to_details,
    write_audit,
) -> None:
    @app.get("/api/admin/clients/unresolved-owners")
    def list_unresolved_client_owners(
        response: Response,
        _: models.User = Depends(admin_user),
        db: Session = Depends(get_db),
    ):
        response.headers["Cache-Control"] = "private, no-store"
        return [
            {
                "client_id": client.client_id,
                "name": client.name,
                "created_at": client.created_at,
                "interviewers": [
                    {"user_id": person.user_id, "full_name": person.full_name}
                    for person in db.query(models.User)
                    .filter(
                        models.User.user_id.in_(
                            {i.interviewer_id for i in client.intakes if i.interviewer_id is not None}
                        )
                    )
                    .order_by(models.User.user_id)
                    .all()
                ],
                "case_ids": sorted(case.case_id for case in client.cases),
            }
            for client in db.query(models.Client)
            .filter(models.Client.created_by_user_id.is_(None), models.Client.deleted_at.is_(None))
            .order_by(models.Client.client_id)
            .all()
        ]

    @app.get("/api/admin/clients/owner-candidates")
    def list_client_owner_candidates(
        response: Response,
        _: models.User = Depends(admin_user),
        db: Session = Depends(get_db),
    ):
        response.headers["Cache-Control"] = "private, no-store"
        return [
            {"user_id": person.user_id, "full_name": person.full_name, "email": person.email}
            for person in db.query(models.User)
            .join(models.Role)
            .filter(
                models.User.is_active.is_(True),
                models.User.approval_status == "approved",
            )
            .order_by(models.User.user_id)
            .all()
            if not is_admin(person)
        ]

    @app.post("/api/admin/clients/{client_id}/resolve-owner")
    def resolve_client_owner(
        client_id: int,
        payload: ResolveClientOwnerPayload,
        request: Request,
        admin: models.User = Depends(admin_user),
        db: Session = Depends(get_db),
    ):
        reason = payload.reason.strip()
        evidence = payload.evidence_reference.strip()
        if not (10 <= len(reason) <= 1000) or not (3 <= len(evidence) <= 500):
            raise HTTPException(
                status_code=422,
                detail="Provide a reason (10–1000 characters) and trusted evidence reference (3–500 characters)",
            )
        # PostgreSQL row lock serializes competing resolutions. Audit and owner change
        # commit together; a stale second request returns 409 without an audit entry.
        try:
            client = (
                db.query(models.Client)
                .filter(models.Client.client_id == client_id)
                .with_for_update()
                .first()
            )
            if not client or client.deleted_at is not None:
                raise HTTPException(status_code=404, detail="Client not found")
            if client.created_by_user_id is not None:
                raise HTTPException(status_code=409, detail="Owner already resolved; reload the investigation")
            owner = db.get(models.User, payload.owner_user_id)
            if not owner or not owner.is_active or owner.approval_status != "approved" or is_admin(owner):
                raise HTTPException(status_code=422, detail="Select an active approved staff owner")
            previous_owner = client.created_by_user_id
            client.created_by_user_id = owner.user_id
            write_audit(
                db,
                admin.user_id,
                "Resolve Client Owner",
                "client",
                json.dumps(
                    {
                        "previous_owner_user_id": previous_owner,
                        "new_owner_user_id": owner.user_id,
                        "reason": reason,
                        "evidence_reference": evidence,
                    },
                    ensure_ascii=False,
                ),
                str(client_id),
                request,
            )
            db.commit()
        except Exception:
            db.rollback()
            raise
        return {
            "client_id": client_id,
            "previous_owner_user_id": previous_owner,
            "owner_user_id": owner.user_id,
        }

    @app.get("/api/admin/verification")
    def list_applicants(
        approval_status: str | None = None,
        _: models.User = Depends(admin_user),
        db: Session = Depends(get_db),
    ):
        query = db.query(models.User).order_by(models.User.created_at.desc())
        if approval_status:
            query = query.filter(models.User.approval_status == approval_status)
        return [user_to_admin(user) for user in query.all()]

    @app.get("/api/admin/users/{user_id}")
    def get_applicant(user_id: int, _: models.User = Depends(admin_user), db: Session = Depends(get_db)):
        user = db.get(models.User, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        return user_to_details(user)

    @app.patch("/api/admin/users/{user_id}/approval")
    def update_applicant_approval(
        user_id: int,
        payload: ApprovalUpdatePayload,
        request: Request,
        current: models.User = Depends(admin_user),
        db: Session = Depends(get_db),
    ):
        user = db.get(models.User, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        user.approval_status = payload.approval_status
        action = "Update Approval"
        if payload.approval_status == "approved":
            action = "Approved Registration"
        elif payload.approval_status == "rejected":
            action = "Rejected Registration"
        write_audit(
            db,
            current.user_id,
            action,
            "user",
            f"{current.full_name or current.email or current.username} {payload.approval_status} registration for {user.full_name or user.email or user.username}",
            str(user.user_id),
            request,
        )
        db.commit()
        db.refresh(user)
        return user_to_details(user)
