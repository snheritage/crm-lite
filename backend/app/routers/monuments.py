"""Monument OCR router – extracts text from monument photos via Google Cloud Vision."""

from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from google.cloud import vision
from google.oauth2 import service_account
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
# Google Cloud Vision client (lazy-initialised)
# ---------------------------------------------------------------------------

_vision_client: vision.ImageAnnotatorClient | None = None


def _get_vision_client() -> vision.ImageAnnotatorClient:
    """Return a cached Vision client, creating it on first call."""
    global _vision_client
    if _vision_client is not None:
        return _vision_client

    creds_json = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON")
    if not creds_json:
        raise HTTPException(
            status_code=500,
            detail="GOOGLE_APPLICATION_CREDENTIALS_JSON env var is not set.",
        )

    info = json.loads(creds_json)
    credentials = service_account.Credentials.from_service_account_info(info)
    _vision_client = vision.ImageAnnotatorClient(credentials=credentials)
    return _vision_client


# ---------------------------------------------------------------------------
# OCR text parsing helpers
# ---------------------------------------------------------------------------

# Matches date-like patterns commonly found on monuments:
#   "1942 - 2024", "1942-2024", "Jan 5, 1942", "01/05/1942",
#   "January 5 1942", "2024-01-05", etc.
_DATE_PATTERN = re.compile(
    r"""
    (?:                                     # -- Option A: month-day-year written out --
        (?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?
         |Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)
        [\s.,]+\d{1,2}[\s,]*\d{4}
    )
    |(?:\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})   # -- Option B: MM/DD/YYYY or DD-MM-YYYY --
    |(?:\d{4}[/\-]\d{1,2}[/\-]\d{1,2})      # -- Option C: YYYY-MM-DD --
    |(?:\d{4})                               # -- Option D: bare year like 1942 --
    """,
    re.VERBOSE | re.IGNORECASE,
)

# Matches a "birth - death" year range like "1942 - 2024" or "1942-2024"
_YEAR_RANGE_PATTERN = re.compile(r"(\d{4})\s*[-–—]\s*(\d{4})")


def _parse_ocr_text(text: str) -> dict:
    """Extract deceased_name, date_of_birth, and date_of_death from raw OCR text.

    Heuristics (intentionally simple – meant to be improved later):
    1. Look for a year-range like "1942 - 2024" → birth year / death year.
    2. Otherwise collect all date-like tokens; first → birth, second → death.
    3. The deceased name is the first line that is mostly uppercase letters
       (at least 3 alpha chars) and does NOT look like a date or common
       monument boilerplate.
    """
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]

    deceased_name: str | None = None
    date_of_birth: str | None = None
    date_of_death: str | None = None

    # --- Try to find a year range first (e.g. "1942 - 2024") ---
    range_match = _YEAR_RANGE_PATTERN.search(text)
    if range_match:
        date_of_birth = range_match.group(1)
        date_of_death = range_match.group(2)
    else:
        # --- Fall back: collect individual date tokens ---
        dates_found: list[str] = []
        for line in lines:
            for m in _DATE_PATTERN.finditer(line):
                dates_found.append(m.group(0).strip())
        # Deduplicate while preserving order
        seen: set[str] = set()
        unique_dates: list[str] = []
        for d in dates_found:
            if d not in seen:
                seen.add(d)
                unique_dates.append(d)
        if len(unique_dates) >= 2:
            date_of_birth = unique_dates[0]
            date_of_death = unique_dates[1]
        elif len(unique_dates) == 1:
            # Only one date found – assume it's the death date
            date_of_death = unique_dates[0]

    # --- Extract the deceased name ---
    # Pick the first line that is mostly uppercase alpha characters and
    # doesn't look like a date or common boilerplate.
    _BOILERPLATE = {"REST", "IN", "PEACE", "LOVING", "MEMORY", "OF", "RIP"}
    for line in lines:
        alpha_chars = [ch for ch in line if ch.isalpha()]
        if len(alpha_chars) < 3:
            continue
        # Skip lines that are just dates
        stripped = _DATE_PATTERN.sub("", line).strip()
        if not stripped:
            continue
        upper_ratio = sum(1 for ch in alpha_chars if ch.isupper()) / len(alpha_chars)
        # Consider a line a likely name if ≥60 % uppercase
        if upper_ratio >= 0.6:
            # Ignore pure boilerplate lines like "REST IN PEACE"
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
    # Lazy import to access the shared in-memory store defined in main.py
    from app.main import monuments_db

    # Read image bytes
    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    # Call Google Cloud Vision text detection
    client = _get_vision_client()
    image = vision.Image(content=image_bytes)
    response = client.text_detection(image=image)

    if response.error.message:
        raise HTTPException(
            status_code=502,
            detail=f"Vision API error: {response.error.message}",
        )

    # The first annotation contains the full concatenated text
    full_text = ""
    if response.text_annotations:
        full_text = response.text_annotations[0].description

    # Parse OCR text with simple heuristics
    parsed = _parse_ocr_text(full_text)

    # Build and store the record
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
