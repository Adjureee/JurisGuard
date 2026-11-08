from datetime import datetime, timezone
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from sqlalchemy import func, or_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session, joinedload

import models
from messaging_permissions import can_message_designations, normalize_message_content
from presence_status import personnel_designation
from schemas import (
    MESSAGE_REACTION_EMOJIS,
    PrivateMessagePayload,
    PrivateMessageReactionPayload,
)


def create_user_notification(
    db: Session,
    user_id: int,
    event_key: str,
    title: str,
    message: str,
    redirect_to: str,
    entity_type: str,
    entity_id: str,
) -> None:
    statement = pg_insert(models.Notification).values(
        user_id=user_id,
        event_key=event_key,
        notification_type="workflow",
        title=title,
        message=message,
        redirect_to=redirect_to,
        entity_type=entity_type,
        entity_id=entity_id,
        is_read=False,
    ).on_conflict_do_nothing(constraint="uq_notification_user_event")
    db.execute(statement)


def private_message_reaction_summary(
    db: Session,
    message_ids: list[int],
    viewer_id: int,
) -> dict[int, list[dict[str, Any]]]:
    if not message_ids:
        return {}
    rows = db.query(
        models.PrivateMessageReaction.message_id,
        models.PrivateMessageReaction.emoji,
        models.PrivateMessageReaction.user_id,
    ).filter(
        models.PrivateMessageReaction.message_id.in_(message_ids),
    ).order_by(
        models.PrivateMessageReaction.message_id,
        models.PrivateMessageReaction.emoji,
    ).all()

    summaries: dict[int, dict[str, dict[str, Any]]] = {}
    for message_id, emoji, user_id in rows:
        if emoji not in MESSAGE_REACTION_EMOJIS:
            continue
        by_emoji = summaries.setdefault(message_id, {})
        summary = by_emoji.setdefault(emoji, {"emoji": emoji, "count": 0, "reacted_by_me": False})
        summary["count"] += 1
        if user_id == viewer_id:
            summary["reacted_by_me"] = True
    return {message_id: list(by_emoji.values()) for message_id, by_emoji in summaries.items()}


def private_message_payload(
    message: models.PrivateMessage,
    viewer_id: int,
    reactions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "message_id": message.message_id,
        "sender_user_id": message.sender_user_id,
        "recipient_user_id": message.recipient_user_id,
        "content": message.content,
        "created_at": message.created_at.isoformat() if message.created_at else "",
        "read_at": message.read_at.isoformat() if message.read_at else None,
        "is_mine": message.sender_user_id == viewer_id,
        "reactions": reactions or [],
    }


def register_messaging_routes(
    app: FastAPI,
    *,
    current_user,
    get_db,
    is_admin,
) -> None:
    def require_messaging_designation(user: models.User) -> str:
        designation = personnel_designation(
            user.role.role_name if user.role else None,
            is_admin(user),
        )
        if designation not in {"Attorney", "Administrator"}:
            raise HTTPException(status_code=403, detail="Private messaging is not available for this designation")
        return designation

    def messaging_peer(db: Session, user: models.User, peer_id: int) -> tuple[models.User, str]:
        sender_designation = require_messaging_designation(user)
        if peer_id <= 0 or peer_id == user.user_id:
            raise HTTPException(status_code=404, detail="Conversation not found")
        peer = db.query(models.User).options(joinedload(models.User.role)).filter(
            models.User.user_id == peer_id,
            models.User.is_active.is_(True),
            models.User.approval_status == "approved",
        ).first()
        if not peer:
            raise HTTPException(status_code=404, detail="Conversation not found")
        peer_designation = personnel_designation(
            peer.role.role_name if peer.role else None,
            is_admin(peer),
        )
        if not can_message_designations(sender_designation, peer_designation):
            raise HTTPException(status_code=404, detail="Conversation not found")
        return peer, peer_designation

    @app.get("/api/messages/personnel")
    def list_messaging_personnel(
        response: Response,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        response.headers["Cache-Control"] = "private, no-store"
        sender_designation = require_messaging_designation(user)
        candidates = db.query(models.User).options(joinedload(models.User.role)).filter(
            models.User.is_active.is_(True),
            models.User.approval_status == "approved",
        ).order_by(models.User.full_name, models.User.user_id).all()
        eligible = []
        for person in candidates:
            designation = personnel_designation(
                person.role.role_name if person.role else None,
                is_admin(person),
            )
            is_self = person.user_id == user.user_id
            if is_self or can_message_designations(sender_designation, designation):
                eligible.append((person, designation, is_self))

        peer_ids = [person.user_id for person, _, is_self in eligible if not is_self]
        unread_by_sender: dict[int, int] = {}
        if peer_ids:
            unread_rows = db.query(
                models.PrivateMessage.sender_user_id,
                func.count(models.PrivateMessage.message_id),
            ).filter(
                models.PrivateMessage.recipient_user_id == user.user_id,
                models.PrivateMessage.sender_user_id.in_(peer_ids),
                models.PrivateMessage.read_at.is_(None),
            ).group_by(models.PrivateMessage.sender_user_id).all()
            unread_by_sender = {sender_id: count for sender_id, count in unread_rows}

        return {
            "personnel": [
                {
                    "user_id": person.user_id,
                    "full_name": person.full_name or person.email or person.username,
                    "profile_image_path": person.profile_image_path,
                    "designation": designation,
                    "is_self": is_self,
                    "unread_count": unread_by_sender.get(person.user_id, 0),
                }
                for person, designation, is_self in eligible
            ],
            "summary": None,
        }

    @app.get("/api/messages/{peer_id}")
    def get_private_conversation(
        peer_id: int,
        response: Response,
        limit: int = Query(default=50, ge=1, le=100),
        before_message_id: int | None = Query(default=None, ge=1),
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        response.headers["Cache-Control"] = "private, no-store"
        peer, _ = messaging_peer(db, user, peer_id)
        query = db.query(models.PrivateMessage).filter(
            or_(
                (models.PrivateMessage.sender_user_id == user.user_id)
                & (models.PrivateMessage.recipient_user_id == peer.user_id),
                (models.PrivateMessage.sender_user_id == peer.user_id)
                & (models.PrivateMessage.recipient_user_id == user.user_id),
            )
        )
        if before_message_id is not None:
            query = query.filter(models.PrivateMessage.message_id < before_message_id)
        rows = query.order_by(models.PrivateMessage.message_id.desc()).limit(limit + 1).all()
        has_more = len(rows) > limit
        rows = list(reversed(rows[:limit]))
        reactions_by_message = private_message_reaction_summary(
            db,
            [message.message_id for message in rows],
            user.user_id,
        )
        return {
            "messages": [
                private_message_payload(message, user.user_id, reactions_by_message.get(message.message_id))
                for message in rows
            ],
            "has_more": has_more,
        }

    @app.post("/api/messages/{peer_id}")
    def send_private_message(
        peer_id: int,
        payload: PrivateMessagePayload,
        response: Response,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        response.headers["Cache-Control"] = "private, no-store"
        peer, _ = messaging_peer(db, user, peer_id)
        try:
            content = normalize_message_content(payload.content)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        message = models.PrivateMessage(
            sender_user_id=user.user_id,
            recipient_user_id=peer.user_id,
            content=content,
        )
        db.add(message)
        db.flush()
        sender_name = user.full_name or user.email or user.username
        create_user_notification(
            db,
            peer.user_id,
            f"private-message:{message.message_id}",
            "New private message",
            f"You have a new private message from {sender_name}.",
            f"/dashboard?messageFrom={user.user_id}",
            "private_message",
            str(user.user_id),
        )
        db.commit()
        db.refresh(message)
        return private_message_payload(message, user.user_id)

    @app.post("/api/messages/{peer_id}/{message_id}/reaction")
    def toggle_private_message_reaction(
        peer_id: int,
        message_id: int,
        payload: PrivateMessageReactionPayload,
        response: Response,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        response.headers["Cache-Control"] = "private, no-store"
        peer, _ = messaging_peer(db, user, peer_id)
        message = db.query(models.PrivateMessage).filter(
            models.PrivateMessage.message_id == message_id,
            or_(
                (models.PrivateMessage.sender_user_id == user.user_id)
                & (models.PrivateMessage.recipient_user_id == peer.user_id),
                (models.PrivateMessage.sender_user_id == peer.user_id)
                & (models.PrivateMessage.recipient_user_id == user.user_id),
            ),
        ).with_for_update().first()
        if not message:
            raise HTTPException(status_code=404, detail="Message not found")

        reaction = db.query(models.PrivateMessageReaction).filter(
            models.PrivateMessageReaction.message_id == message.message_id,
            models.PrivateMessageReaction.user_id == user.user_id,
        ).first()
        if reaction and reaction.emoji == payload.emoji:
            db.delete(reaction)
        elif reaction:
            reaction.emoji = payload.emoji
        else:
            db.add(
                models.PrivateMessageReaction(
                    message_id=message.message_id,
                    user_id=user.user_id,
                    emoji=payload.emoji,
                )
            )
        db.commit()

        reactions = private_message_reaction_summary(db, [message.message_id], user.user_id)
        return {"reactions": reactions.get(message.message_id, [])}

    @app.post("/api/messages/{peer_id}/read")
    def mark_private_conversation_read(
        peer_id: int,
        response: Response,
        user: models.User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        response.headers["Cache-Control"] = "private, no-store"
        peer, _ = messaging_peer(db, user, peer_id)
        read_at = datetime.now(timezone.utc).replace(tzinfo=None)
        updated_count = db.query(models.PrivateMessage).filter(
            models.PrivateMessage.sender_user_id == peer.user_id,
            models.PrivateMessage.recipient_user_id == user.user_id,
            models.PrivateMessage.read_at.is_(None),
        ).update({models.PrivateMessage.read_at: read_at}, synchronize_session=False)
        db.query(models.Notification).filter(
            models.Notification.user_id == user.user_id,
            models.Notification.entity_type == "private_message",
            models.Notification.entity_id == str(peer.user_id),
            models.Notification.is_read.is_(False),
        ).update({models.Notification.is_read: True}, synchronize_session=False)
        db.commit()
        return {"updated": updated_count, "read_at": read_at.isoformat()}
