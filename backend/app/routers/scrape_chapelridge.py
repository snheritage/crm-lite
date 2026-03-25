"""Scrape Chapel Ridge funeral-home obituaries from FrontRunnerPro API."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db
from app.models import Obit, User

router = APIRouter()

FRONTRUNNER_URL = (
    "https://obituaries.frontrunnerpro.com/runtime/311039"
    "/ims/WF2/public/get-records-additional.php"
)
FRONTRUNNER_PARAMS = {
    "guid": "MTk2MjE2Ok1haW5TaXRl",
    "wholeSite": "true",
    "type": "current",
}


@router.post("/")
async def scrape_chapelridge(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                FRONTRUNNER_URL,
                data=FRONTRUNNER_PARAMS,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Upstream request failed: {exc}")

    try:
        body = resp.json()
    except Exception:
        raise HTTPException(status_code=502, detail="Invalid JSON from upstream")

    if not body.get("success"):
        raise HTTPException(status_code=502, detail="Upstream API returned failure")

    records = body.get("data") or []
    new_obits: list[dict] = []

    # Build a set of existing (deceased_name, date_of_death) pairs for current user
    existing_result = await db.execute(
        select(Obit.deceased_name, Obit.date_of_death).where(
            Obit.user_id == current_user.id
        )
    )
    existing_keys = {(row[0], row[1]) for row in existing_result.all()}

    for rec in records:
        name = rec.get("name", "Unknown")
        dod = rec.get("dod")
        if (name, dod) in existing_keys:
            continue

        obit = Obit(
            user_id=current_user.id,
            deceased_name=name,
            date_of_death=dod,
            newspaper="Chapel Ridge FH",
            monument_ordered=False,
            notes=rec.get("url", ""),
        )
        db.add(obit)
        await db.flush()
        await db.refresh(obit)

        new_obits.append({
            "id": str(obit.id),
            "deceased_name": obit.deceased_name,
            "date_of_death": obit.date_of_death,
            "newspaper": obit.newspaper,
            "monument_ordered": obit.monument_ordered,
            "notes": obit.notes,
            "created_at": obit.created_at.isoformat(),
        })
        existing_keys.add((name, dod))

    return new_obits
