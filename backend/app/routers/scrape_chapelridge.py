"""Scrape Chapel Ridge funeral-home obituaries from FrontRunnerPro API."""

from __future__ import annotations

import uuid
from datetime import datetime

import httpx
from fastapi import APIRouter, HTTPException

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
async def scrape_chapelridge():
    # Import the shared in-memory store from main
    from app.main import obits_db

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

    for rec in records:
        obit_id = str(uuid.uuid4())
        record = {
            "id": obit_id,
            "deceased_name": rec.get("name", "Unknown"),
            "date_of_death": rec.get("dod"),
            "newspaper": "Chapel Ridge FH",
            "monument_ordered": False,
            "notes": rec.get("url", ""),
            "created_at": datetime.utcnow().isoformat(),
        }
        obits_db[obit_id] = record
        new_obits.append(record)

    return new_obits
