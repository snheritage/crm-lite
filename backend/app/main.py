"""obit-crm-lite – FastAPI backend."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import engine, get_db
from app.models import Obit, User
from app.routers.admin import router as admin_router
from app.routers.auth import router as auth_router
from app.routers.monuments import router as monuments_router
from app.routers.scrape_chapelridge import router as chapelridge_router

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="obit-crm-lite API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # tighten for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(admin_router, prefix="/api/admin")
app.include_router(auth_router, prefix="/api/auth")
app.include_router(chapelridge_router, prefix="/api/obits/scrape/chapelridge")
app.include_router(monuments_router, prefix="/api/monuments")


# ---------------------------------------------------------------------------
# Startup / Shutdown
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def startup():
    """Verify the database connection on startup."""
    try:
        async with engine.connect() as conn:
            await conn.execute(select(1))
        logger.info("Database connection verified.")
    except Exception:
        logger.exception("Failed to connect to the database!")
        raise


@app.on_event("shutdown")
async def shutdown():
    await engine.dispose()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class ObitCreate(BaseModel):
    deceased_name: str
    date_of_death: Optional[str] = None          # ISO date string
    newspaper: Optional[str] = ""
    monument_ordered: Optional[bool] = False
    notes: Optional[str] = ""


class ObitUpdate(BaseModel):
    deceased_name: Optional[str] = None
    date_of_death: Optional[str] = None
    newspaper: Optional[str] = None
    monument_ordered: Optional[bool] = None
    notes: Optional[str] = None


class ObitOut(BaseModel):
    id: str
    deceased_name: str
    date_of_death: Optional[str] = None
    newspaper: Optional[str] = ""
    monument_ordered: bool = False
    notes: str = ""
    created_at: str

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _obit_to_out(obit: Obit) -> ObitOut:
    return ObitOut(
        id=str(obit.id),
        deceased_name=obit.deceased_name,
        date_of_death=obit.date_of_death,
        newspaper=obit.newspaper,
        monument_ordered=obit.monument_ordered,
        notes=obit.notes,
        created_at=obit.created_at.isoformat(),
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "obit-crm-lite"}


@app.get("/api/obits", response_model=list[ObitOut])
async def list_obits(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List obits. Admins see all; regular users see only their own."""
    if current_user.is_admin:
        result = await db.execute(select(Obit).order_by(Obit.created_at.desc()))
    else:
        result = await db.execute(
            select(Obit)
            .where(Obit.user_id == current_user.id)
            .order_by(Obit.created_at.desc())
        )
    obits = result.scalars().all()
    return [_obit_to_out(o) for o in obits]


@app.get("/api/obits/{obit_id}", response_model=ObitOut)
async def get_obit(
    obit_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        oid = uuid.UUID(obit_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid obit ID")

    result = await db.execute(select(Obit).where(Obit.id == oid))
    obit = result.scalar_one_or_none()

    if obit is None:
        raise HTTPException(status_code=404, detail="Obit not found")
    if not current_user.is_admin and obit.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Obit not found")

    return _obit_to_out(obit)


@app.post("/api/obits", response_model=ObitOut, status_code=201)
async def create_obit(
    payload: ObitCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    obit = Obit(
        user_id=current_user.id,
        deceased_name=payload.deceased_name,
        date_of_death=payload.date_of_death,
        newspaper=payload.newspaper or "",
        monument_ordered=payload.monument_ordered or False,
        notes=payload.notes or "",
    )
    db.add(obit)
    await db.flush()
    await db.refresh(obit)
    return _obit_to_out(obit)


@app.put("/api/obits/{obit_id}", response_model=ObitOut)
async def update_obit(
    obit_id: str,
    payload: ObitUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        oid = uuid.UUID(obit_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid obit ID")

    result = await db.execute(select(Obit).where(Obit.id == oid))
    obit = result.scalar_one_or_none()

    if obit is None:
        raise HTTPException(status_code=404, detail="Obit not found")
    if not current_user.is_admin and obit.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Obit not found")

    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(obit, key, value)

    await db.flush()
    await db.refresh(obit)
    return _obit_to_out(obit)


@app.delete("/api/obits/{obit_id}", status_code=204)
async def delete_obit(
    obit_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        oid = uuid.UUID(obit_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid obit ID")

    result = await db.execute(select(Obit).where(Obit.id == oid))
    obit = result.scalar_one_or_none()

    if obit is None:
        raise HTTPException(status_code=404, detail="Obit not found")
    if not current_user.is_admin and obit.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Obit not found")

    await db.delete(obit)
    return None
