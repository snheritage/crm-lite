"""Admin-only endpoints – stats, CSV export, user management."""

from __future__ import annotations

import csv
import io
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import case, cast, func, literal, select, extract, String
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db
from app.models import Monument, Obit, User

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Admin dependency
# ---------------------------------------------------------------------------

async def _require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CemeteryCount(BaseModel):
    cemetery_name: str
    count: int


class UserMonumentCount(BaseModel):
    user_email: str
    user_name: str
    count: int


class MonthCount(BaseModel):
    month: str
    count: int


class RecentMonument(BaseModel):
    id: str
    cemetery_name: str
    deceased_name: str | None = None
    date_of_birth: str | None = None
    date_of_death: str | None = None
    created_at: str
    user_email: str
    user_name: str


class StatsResponse(BaseModel):
    total_monuments: int
    total_users: int
    total_obits: int
    monuments_by_cemetery: list[CemeteryCount]
    monuments_by_user: list[UserMonumentCount]
    monuments_by_month: list[MonthCount]
    recent_monuments: list[RecentMonument]


class AdminUserOut(BaseModel):
    id: str
    email: str
    full_name: str
    is_admin: bool
    is_active: bool
    monument_count: int
    obit_count: int
    created_at: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/ping")
async def admin_ping(_admin: User = Depends(_require_admin)):
    """Lightweight health-check that requires admin auth but skips the DB."""
    return {"status": "ok", "admin": True}


@router.get("/stats", response_model=StatsResponse)
async def admin_stats(
    _admin: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Return dashboard statistics for admins."""
    try:
        # Total counts
        total_monuments = (await db.execute(select(func.count()).select_from(Monument))).scalar() or 0
        total_users = (await db.execute(select(func.count()).select_from(User))).scalar() or 0
        total_obits = (await db.execute(select(func.count()).select_from(Obit))).scalar() or 0

        # Monuments by cemetery – COALESCE handles potential NULLs
        by_cemetery_q = (
            select(
                func.coalesce(Monument.cemetery_name, "Unknown").label("cemetery_name"),
                func.count().label("count"),
            )
            .group_by(func.coalesce(Monument.cemetery_name, "Unknown"))
            .order_by(func.count().desc())
        )
        by_cemetery_rows = (await db.execute(by_cemetery_q)).all()
        monuments_by_cemetery = [
            CemeteryCount(cemetery_name=row[0], count=row[1]) for row in by_cemetery_rows
        ]

        # Monuments by user – LEFT JOIN so orphaned monuments don't break the query
        by_user_q = (
            select(
                func.coalesce(User.email, "deleted-user").label("email"),
                func.coalesce(User.full_name, "Deleted User").label("full_name"),
                func.count(Monument.id).label("count"),
            )
            .select_from(Monument)
            .outerjoin(User, Monument.user_id == User.id)
            .group_by(func.coalesce(User.email, "deleted-user"), func.coalesce(User.full_name, "Deleted User"))
            .order_by(func.count(Monument.id).desc())
        )
        by_user_rows = (await db.execute(by_user_q)).all()
        monuments_by_user = [
            UserMonumentCount(user_email=row[0], user_name=row[1], count=row[2])
            for row in by_user_rows
        ]

        # Monuments by month – use extract() for portability instead of to_char,
        # and wrap with COALESCE so NULL created_at doesn't crash the query.
        month_expr = func.concat(
            cast(extract("year", Monument.created_at), String),
            literal("-"),
            func.lpad(cast(extract("month", Monument.created_at), String), 2, "0"),
        )
        by_month_q = (
            select(
                month_expr.label("month"),
                func.count().label("count"),
            )
            .where(Monument.created_at.is_not(None))
            .group_by(month_expr)
            .order_by(month_expr.desc())
        )
        by_month_rows = (await db.execute(by_month_q)).all()
        monuments_by_month = [
            MonthCount(month=row[0] if row[0] else "Unknown", count=row[1])
            for row in by_month_rows
        ]

        # Recent monuments (last 10) with user info – LEFT JOIN for safety
        recent_q = (
            select(
                Monument,
                func.coalesce(User.email, "deleted-user").label("email"),
                func.coalesce(User.full_name, "Deleted User").label("full_name"),
            )
            .outerjoin(User, Monument.user_id == User.id)
            .order_by(Monument.created_at.desc())
            .limit(10)
        )
        recent_rows = (await db.execute(recent_q)).all()
        recent_monuments = [
            RecentMonument(
                id=str(row[0].id),
                cemetery_name=row[0].cemetery_name,
                deceased_name=row[0].deceased_name,
                date_of_birth=row[0].date_of_birth,
                date_of_death=row[0].date_of_death,
                created_at=row[0].created_at.isoformat() if row[0].created_at else "",
                user_email=row[1],
                user_name=row[2],
            )
            for row in recent_rows
        ]

        return StatsResponse(
            total_monuments=total_monuments,
            total_users=total_users,
            total_obits=total_obits,
            monuments_by_cemetery=monuments_by_cemetery,
            monuments_by_user=monuments_by_user,
            monuments_by_month=monuments_by_month,
            recent_monuments=recent_monuments,
        )

    except SQLAlchemyError as exc:
        logger.exception("Database error in admin_stats: %s", exc)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": f"Database error in admin stats: {exc}"},
        )
    except Exception as exc:
        logger.exception("Unexpected error in admin_stats: %s", exc)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": f"Unexpected error in admin stats: {exc}"},
        )


@router.get("/export/monuments")
async def export_monuments_csv(
    _admin: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Export all monuments as a CSV file."""
    query = (
        select(Monument, User.email)
        .join(User, Monument.user_id == User.id)
        .order_by(Monument.created_at.desc())
    )
    rows = (await db.execute(query)).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "id", "cemetery_name", "deceased_name", "date_of_birth",
        "date_of_death", "notes", "photo_url", "ocr_raw_text",
        "created_at", "updated_at", "user_email",
    ])
    for monument, user_email in rows:
        writer.writerow([
            str(monument.id),
            monument.cemetery_name,
            monument.deceased_name or "",
            monument.date_of_birth or "",
            monument.date_of_death or "",
            monument.notes or "",
            monument.photo_url or "",
            monument.ocr_raw_text or "",
            monument.created_at.isoformat(),
            monument.updated_at.isoformat(),
            user_email,
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=monuments_export.csv"},
    )


@router.get("/users", response_model=list[AdminUserOut])
async def list_users(
    _admin: User = Depends(_require_admin),
    db: AsyncSession = Depends(get_db),
):
    """List all users with their monument and obit counts."""
    query = (
        select(
            User,
            func.count(func.distinct(Monument.id)).label("monument_count"),
            func.count(func.distinct(Obit.id)).label("obit_count"),
        )
        .outerjoin(Monument, Monument.user_id == User.id)
        .outerjoin(Obit, Obit.user_id == User.id)
        .group_by(User.id)
        .order_by(User.created_at.desc())
    )
    rows = (await db.execute(query)).all()

    return [
        AdminUserOut(
            id=str(user.id),
            email=user.email,
            full_name=user.full_name,
            is_admin=user.is_admin,
            is_active=user.is_active,
            monument_count=monument_count,
            obit_count=obit_count,
            created_at=user.created_at.isoformat(),
        )
        for user, monument_count, obit_count in rows
    ]
