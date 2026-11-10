from datetime import datetime, timedelta
from typing import Any

from fastapi import Depends, FastAPI, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

import models


def apply_termination_date_filters(query, parse_date, date_from: str | None = None, date_to: str | None = None):
    termination_date = func.coalesce(
        models.Case.terminated_at,
        models.Case.date_of_termination,
        models.Case.last_updated,
    )
    from_date = parse_date(date_from)
    if from_date:
        query = query.filter(termination_date >= from_date)
    to_date = parse_date(date_to)
    if to_date:
        query = query.filter(termination_date < to_date + timedelta(days=1))
    return query


def trend_bucket_format(parse_date, date_from: str | None = None, date_to: str | None = None) -> str:
    from_date = parse_date(date_from)
    to_date = parse_date(date_to)
    if from_date and to_date and (to_date - from_date).days <= 45:
        return "YYYY-MM-DD"
    return "YYYY-MM"


def register_dashboard_routes(
    app: FastAPI,
    *,
    current_user,
    get_db,
    is_admin,
    scoped_client_query,
    scoped_case_query,
    case_date_column,
    apply_case_date_filters,
    analytics_client_query,
    parse_date,
    normalize_case_status,
    get_case_payload,
    get_client_payload,
    barangay_centroids: dict[str, tuple[float, float]],
    panabo_center: dict[str, float],
) -> None:
    @app.get("/api/dashboard/overview")
    def dashboard_overview(
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
        date_from: str | None = Query(None),
        date_to: str | None = Query(None),
    ):
        now = datetime.now()
        month_start = datetime(now.year, now.month, 1)
        total_clients = scoped_client_query(db, user).count()
        case_query = scoped_case_query(db, user)
        total_cases = case_query.count()
        terminated_cases = (
            scoped_case_query(db, user)
            .filter((models.Case.is_terminated.is_(True)) | (models.Case.status_of_case == "Terminated"))
            .count()
        )
        cases_this_month = (
            scoped_case_query(db, user)
            .filter(func.coalesce(models.IntakeRecord.form_date, models.Case.last_updated) >= month_start)
            .count()
        )
        cases_in_range = apply_case_date_filters(scoped_case_query(db, user), date_from, date_to).count()
        client_range_query = scoped_client_query(db, user)
        client_from = parse_date(date_from)
        if client_from:
            client_range_query = client_range_query.filter(models.Client.created_at >= client_from)
        client_to = parse_date(date_to)
        if client_to:
            client_range_query = client_range_query.filter(models.Client.created_at < client_to + timedelta(days=1))
        clients_in_range = client_range_query.count()
        range_query = apply_case_date_filters(scoped_case_query(db, user), date_from, date_to)
        range_terminated = range_query.filter(
            (models.Case.is_terminated.is_(True)) | (models.Case.status_of_case == "Terminated")
        ).count()
        ocr_query = db.query(models.Document).filter(models.Document.ocr_status == "COMPLETED")
        if not is_admin(user):
            ocr_query = ocr_query.filter(models.Document.uploaded_by == user.user_id)
        ocr_scanned_documents = ocr_query.count()
        return {
            "total_clients": total_clients,
            "total_cases": total_cases,
            "active_cases": max(total_cases - terminated_cases, 0),
            "terminated_cases": terminated_cases,
            "cases_this_month": cases_this_month,
            "cases_in_range": cases_in_range,
            "clients_in_range": clients_in_range,
            "range_active_cases": max(cases_in_range - range_terminated, 0),
            "range_terminated_cases": range_terminated,
            "ocr_scanned_documents": ocr_scanned_documents,
        }

    @app.get("/api/dashboard/monthly-trends")
    def dashboard_monthly_trends(
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
        date_from: str | None = Query(None),
        date_to: str | None = Query(None),
    ):
        bucket_format = trend_bucket_format(parse_date, date_from, date_to)
        rows = (
            apply_case_date_filters(scoped_case_query(db, user), date_from, date_to)
            .with_entities(
                func.to_char(case_date_column(), bucket_format).label("month"),
                func.count(models.Case.case_id).label("total_cases"),
            )
            .group_by("month")
            .order_by("month")
            .all()
        )
        return [{"month": row.month or "Unscheduled", "total_cases": row.total_cases} for row in rows]

    @app.get("/api/dashboard/intake-load")
    def dashboard_intake_load(
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
        date_from: str | None = Query(None),
        date_to: str | None = Query(None),
    ):
        weekday_rows = (
            apply_case_date_filters(scoped_case_query(db, user), date_from, date_to)
            .with_entities(
                func.extract("dow", case_date_column()).label("weekday"),
                func.count(models.Case.case_id).label("total_cases"),
            )
            .group_by("weekday")
            .all()
        )
        hour_rows = (
            apply_case_date_filters(scoped_case_query(db, user), date_from, date_to)
            .with_entities(
                func.extract("hour", case_date_column()).label("hour"),
                func.count(models.Case.case_id).label("total_cases"),
            )
            .group_by("hour")
            .all()
        )
        weekday_names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
        weekly = [{"day": weekday_names[index], "total_cases": 0} for index in range(7)]
        for row in weekday_rows:
            if row.weekday is not None:
                weekly[int(row.weekday)]["total_cases"] = row.total_cases
        hourly = [
            {"hour": f"{int(row.hour):02d}:00", "total_cases": row.total_cases}
            for row in sorted(hour_rows, key=lambda item: item.hour or 0)
            if row.hour is not None
        ]
        busiest_day = max(weekly, key=lambda item: item["total_cases"]) if weekly else None
        busiest_hour = max(hourly, key=lambda item: item["total_cases"]) if hourly else None
        total_weekly = sum(item["total_cases"] for item in weekly)
        return {
            "weekly": weekly,
            "hourly": hourly,
            "busiest_day": busiest_day,
            "busiest_hour": busiest_hour,
            "average_daily_intake": round(total_weekly / 7, 2),
            "total_weekly_cases": total_weekly,
        }

    @app.get("/api/dashboard/barangay-stats")
    def dashboard_barangay_stats(
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
        date_from: str | None = Query(None),
        date_to: str | None = Query(None),
    ):
        from client_hotspots import client_hotspots

        return client_hotspots(analytics_client_query(db, user, date_from, date_to).all(), barangay_centroids)[0]

    @app.get("/api/dashboard/heatmap")
    def dashboard_heatmap(
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
        date_from: str | None = Query(None),
        date_to: str | None = Query(None),
    ):
        from client_hotspots import client_hotspots

        stats, points = client_hotspots(analytics_client_query(db, user, date_from, date_to).all(), barangay_centroids)
        return {"center": panabo_center, "points": points, "barangays": stats}

    @app.get("/api/dashboard/terminated-cases")
    def dashboard_terminated_cases(
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
        date_from: str | None = Query(None),
        date_to: str | None = Query(None),
    ):
        records = (
            apply_termination_date_filters(scoped_case_query(db, user), parse_date, date_from, date_to)
            .filter((models.Case.is_terminated.is_(True)) | (models.Case.status_of_case == "Terminated"))
            .all()
        )
        reason_counts: dict[str, int] = {}
        monthly_counts: dict[str, int] = {}
        for record in records:
            reason = record.termination_reason or record.cause_of_termination or "Unspecified"
            reason_counts[reason] = reason_counts.get(reason, 0) + 1
            date_value = record.terminated_at or record.date_of_termination or record.last_updated
            month = date_value.strftime("%Y-%m") if date_value else "Unscheduled"
            monthly_counts[month] = monthly_counts.get(month, 0) + 1
        total_in_range = apply_case_date_filters(scoped_case_query(db, user), date_from, date_to).count()
        most_common_reason = max(reason_counts.items(), key=lambda item: item[1])[0] if reason_counts else None
        return {
            "total": len(records),
            "closure_rate": round((len(records) / total_in_range) * 100, 2) if total_in_range else 0,
            "most_common_reason": most_common_reason,
            "by_reason": [
                {"reason": reason, "total_cases": total}
                for reason, total in sorted(reason_counts.items(), key=lambda item: item[1], reverse=True)
            ],
            "monthly": [{"month": month, "total_cases": total} for month, total in sorted(monthly_counts.items())],
        }

    @app.get("/api/dashboard/recent-activities")
    def dashboard_recent_activities(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
        query = db.query(models.AuditLog).options(joinedload(models.AuditLog.user))
        if not is_admin(user):
            query = query.filter(models.AuditLog.user_id == user.user_id)
        rows = query.order_by(models.AuditLog.timestamp.desc(), models.AuditLog.log_id.desc()).limit(12).all()
        return [
            {
                "id": str(row.log_id),
                "timestamp": row.timestamp.isoformat() if row.timestamp else "",
                "user": row.user.full_name or row.user.email or row.user.username if row.user else "System",
                "action": row.action,
                "description": row.description or "",
                "entity_type": row.target_entity,
                "entity_id": row.entity_id,
            }
            for row in rows
        ]

    @app.get("/api/dashboard/ocr-analytics")
    def dashboard_ocr_analytics(
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
        date_from: str | None = Query(None),
        date_to: str | None = Query(None),
    ):
        query = db.query(models.Document)
        if not is_admin(user):
            query = query.filter(models.Document.uploaded_by == user.user_id)
        start, end = parse_date(date_from), parse_date(date_to)
        if start:
            query = query.filter(models.Document.uploaded_at >= start)
        if end:
            query = query.filter(models.Document.uploaded_at < end + timedelta(days=1))
        rows = query.order_by(models.Document.uploaded_at.desc()).all()
        total = len(rows)
        successful = len([row for row in rows if row.ocr_status == "COMPLETED"])
        failed = len([row for row in rows if row.ocr_status == "FAILED"])
        type_counts: dict[str, int] = {}
        trend_counts: dict[str, int] = {}
        for row in rows:
            doc_type = row.document_type or "Unknown"
            type_counts[doc_type] = type_counts.get(doc_type, 0) + 1
            month = row.uploaded_at.strftime("%Y-%m") if row.uploaded_at else "Unscheduled"
            trend_counts[month] = trend_counts.get(month, 0) + 1
        return {
            "total_scans": total,
            "successful_extractions": successful,
            "failed_scans": failed,
            "document_types": [
                {"document_type": key, "total_scans": value}
                for key, value in sorted(type_counts.items(), key=lambda item: item[1], reverse=True)
            ],
            "trends": [{"month": key, "total_scans": value} for key, value in sorted(trend_counts.items())],
            "recent": [
                {
                    "document_id": row.document_id,
                    "document_type": row.document_type or "Unknown",
                    "ocr_status": row.ocr_status,
                    "uploaded_at": row.uploaded_at.isoformat() if row.uploaded_at else "",
                    "uploaded_by": row.uploaded_by,
                }
                for row in rows[:10]
            ],
        }

    @app.get("/api/dashboard/staff-workload")
    def dashboard_staff_workload(user: models.User = Depends(current_user), db: Session = Depends(get_db)):
        cases = scoped_case_query(db, user).order_by(models.Case.last_updated.desc()).all()
        today = datetime.now().date()
        created_today = [
            record
            for record in cases
            if record.intake and record.intake.form_date and record.intake.form_date.date() == today
        ]
        pending = [
            record
            for record in cases
            if (record.status_of_case or "").lower() in {"pending", "ongoing", "active"}
        ]
        ocr_rows = (
            db.query(models.Document)
            .filter(models.Document.uploaded_by == user.user_id)
            .order_by(models.Document.uploaded_at.desc())
            .all()
        )
        logs = (
            db.query(models.AuditLog)
            .filter(models.AuditLog.user_id == user.user_id)
            .order_by(models.AuditLog.timestamp.desc(), models.AuditLog.log_id.desc())
            .limit(10)
            .all()
        )
        status_counts: dict[str, int] = {}
        client_ids = []
        for record in cases:
            status = normalize_case_status(record.status_of_case)
            status_counts[status] = status_counts.get(status, 0) + 1
            participant_ids = [participant.client_id for participant in record.participants if participant.client_id]
            if participant_ids:
                client_ids.extend(participant_ids)
            elif record.client_id:
                client_ids.append(record.client_id)
        client_ids = list(dict.fromkeys(client_ids))
        clients = db.query(models.Client).filter(models.Client.client_id.in_(client_ids[:20])).all() if client_ids else []
        return {
            "assigned_cases": len(cases),
            "cases_created_today": len(created_today),
            "pending_case_work": len(pending),
            "my_ocr_usage": len(ocr_rows),
            "status_breakdown": [
                {"status": key, "total_cases": value} for key, value in sorted(status_counts.items())
            ],
            "recent_cases": [get_case_payload(record) for record in cases[:8]],
            "recent_clients": [get_client_payload(client) for client in clients[:8]],
            "recent_actions": [
                {
                    "id": str(row.log_id),
                    "timestamp": row.timestamp.isoformat() if row.timestamp else "",
                    "action": row.action,
                    "description": row.description or "",
                    "entity_type": row.target_entity,
                    "entity_id": row.entity_id,
                }
                for row in logs
            ],
            "ocr_recent": [
                {
                    "document_id": row.document_id,
                    "ocr_status": row.ocr_status,
                    "document_type": row.document_type or "Unknown",
                    "uploaded_at": row.uploaded_at.isoformat() if row.uploaded_at else "",
                }
                for row in ocr_rows[:8]
            ],
        }
