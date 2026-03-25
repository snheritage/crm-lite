"""Monument OCR router – extracts text from monument photos via OCR.space."""

from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class MonumentOut(BaseModel):
    id: str
    cemetery_name: str
    deceased_name: str | None = None
    date_of_birth: str | None = None
    date_of_death: str | None = None
    notes: str
    created_at: str


# ---------------------------------------------------------------------------
# OCR.space client
# ---------------------------------------------------------------------------

_OCR_SPACE_URL = "https://api.ocr.space/parse/image"
_OCR_SPACE_API_KEY = os.environ.get("OCR_SPACE_API_KEY")


async def _ocr_space_extract_text(image_bytes: bytes) -> str:
    """Send image bytes to OCR.space and return the full extracted text."""
    if not _OCR_SPACE_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="OCR_SPACE_API_KEY env var is not set.",
        )

    async with httpx.AsyncClient(timeout=30) as client:
        files = {"file": ("monument.jpg", image_bytes)}
        data = {
            "apikey": _OCR_SPACE_API_KEY,
            "language": "eng",
            "isOverlayRequired": False,
        }
        resp = await client.post(_OCR_SPACE_URL, data=data, files=files)

    try:
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"OCR.space HTTP error: {exc}",
        ) from exc

    payload = resp.json()
    if payload.get("IsErroredOnProcessing"):
        msg = payload.get("ErrorMessage") or payload.get("ErrorDetails") or "Unknown OCR error"
        if isinstance(msg, list):
            msg = "; ".join(str(m) for m in msg)
        raise HTTPException(
            status_code=502,
            detail=f"OCR.space error: {msg}",
        )

    results = payload.get("ParsedResults") or []
    if not results:
        return ""

    return results.get("ParsedText", "") or ""


# ---------------------------------------------------------------------------
# OCR text parsing helpers
# ---------------------------------------------------------------------------

_DATE_PATTERN = re.compile(
    r"""
    (?: # -- Option A: month-day-year written out --
    (?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?
    |Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)
    [\\s.,]+\\d{1,2}[\\s,]*\\d{4}

    |(?:\\d{1,2}[/\\-]\\d{1,2}[/\\-]\\d{2,4})
    |(?:\\d{4}[/\\-]\\d{1,2}[/\\-]\\d{1,2})
    |(?:\\d{4})
    """,
    re.VERBOSE | re.IGNORECASE,
)

_YEAR_RANGE_PATTERN = re.compile(r"(\\d{4})\\s*[-–—]\\s*(\\d{4})")


def _parse_ocr_text(text: str) -> dict:
    """Extract deceased_name, date_of_birth, and date_of_death from raw OCR text."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]

    deceased_name: str | None = None
    date_of_birth: str | None = None
    date_of_death: str | None = None

    range_match = _YEAR_RANGE_PATTERN.search(text)
    if range_match:
        date_of_birth = range_match.group(1)
        date_of_death = range_match.group(2)
    else:
        dates_found: list[str] = []
        for line in lines:
            for m in _DATE_PATTERN.finditer(line):
                dates_found.append(m.group(0).strip())
        seen: set[str] = set()
        unique_dates: list[str] = []
        for d in dates_found:
            if d not in seen:
                seen.add(d)
                unique_dates.append(d)
        if len(unique_dates) >= 2:
            date_of_birth = unique_dates
            date_of_death = unique_dates
        elif len(unique_dates) == 1:
            date_of_death = unique_dates

    _BOILERPLATE = {"REST", "IN", "PEACE", "LOVING", "MEMORY", "OF", "RIP"}
    for line in lines:
        alpha_chars = [ch for ch in line if ch.isalpha()]
        if len(alpha_chars) < 3:
            continue
        stripped = _DATE_PATTERN.sub("", line).strip()
        if not stripped:
            continue
        upper_ratio = sum(1 for ch in alpha_chars if ch.isupper()) / len(alpha_chars)
        if upper_ratio >= 0.6:
            words = {w.upper() for w in line.split()}
            if not words.issubset(_BOILERPLATE):
                deceased_name = line
                break

    return {
        "deceased_name": deceased_name,
        "date_of_birth": date_of_birth,
        "date_of_death": date_of_death,
    }


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter()


@router.post("/from-photo", response_model=MonumentOut, status_code=201)
async def create_monument_from_photo(
    cemetery_name: str = Form(...),
    file: UploadFile = File(...),
):
    """Upload a monument photo; returns OCR-extracted record."""
    from app.main import monuments_db

    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    full_text = await _ocr_space_extract_text(image_bytes)

    parsed = _parse_ocr_text(full_text)

    record_id = str(uuid.uuid4())
    record = {
        "id": record_id,
        "cemetery_name": cemetery_name,
        "deceased_name": parsed["deceased_name"],
        "date_of_birth": parsed["date_of_birth"],
        "date_of_death": parsed["date_of_death"],
        "notes": full_text,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    monuments_db[record_id] = record
    return record


@router.get("/", response_model=list[MonumentOut])
def list_monuments():
    """Return all monument records."""
    from app.main import monuments_db

    return list(monuments_db.values())
