"""obit-crm-lite – FastAPI backend."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.routers.scrape_chapelridge import router as chapelridge_router

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="obit-crm-lite API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # tighten for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chapelridge_router, prefix="/api/obits/scrape/chapelridge")

# ---------------------------------------------------------------------------
# In-memory store
# ---------------------------------------------------------------------------
obits_db: dict[str, dict] = {}

# Seed a couple of sample records so the table isn't empty on first load.
_seed = [
    {
        "id": str(uuid.uuid4()),
        "deceased_name": "Margaret Anne Sullivan",
        "date_of_death": "2026-03-10",
        "newspaper": "Chronicle Herald",
        "monument_ordered": True,
        "notes": "Family requested grey granite upright.",
        "created_at": datetime.utcnow().isoformat(),
    },
    {
        "id": str(uuid.uuid4()),
        "deceased_name": "Robert James MacNeil",
        "date_of_death": "2026-03-18",
        "newspaper": "Cape Breton Post",
        "monument_ordered": False,
        "notes": "",
        "created_at": datetime.utcnow().isoformat(),
    },
]
for rec in _seed:
    obits_db[rec["id"]] = rec

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

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health():
    return {"status": "ok", "service": "obit-crm-lite"}


@app.get("/api/obits", response_model=list[ObitOut])
def list_obits():
    return list(obits_db.values())


@app.get("/api/obits/{obit_id}", response_model=ObitOut)
def get_obit(obit_id: str):
    if obit_id not in obits_db:
        raise HTTPException(status_code=404, detail="Obit not found")
    return obits_db[obit_id]


@app.post("/api/obits", response_model=ObitOut, status_code=201)
def create_obit(payload: ObitCreate):
    obit_id = str(uuid.uuid4())
    record = {
        "id": obit_id,
        "deceased_name": payload.deceased_name,
        "date_of_death": payload.date_of_death,
        "newspaper": payload.newspaper or "",
        "monument_ordered": payload.monument_ordered or False,
        "notes": payload.notes or "",
        "created_at": datetime.utcnow().isoformat(),
    }
    obits_db[obit_id] = record
    return record


@app.put("/api/obits/{obit_id}", response_model=ObitOut)
def update_obit(obit_id: str, payload: ObitUpdate):
    if obit_id not in obits_db:
        raise HTTPException(status_code=404, detail="Obit not found")
    existing = obits_db[obit_id]
    update_data = payload.model_dump(exclude_unset=True)
    existing.update(update_data)
    obits_db[obit_id] = existing
    return existing


@app.delete("/api/obits/{obit_id}", status_code=204)
def delete_obit(obit_id: str):
    if obit_id not in obits_db:
        raise HTTPException(status_code=404, detail="Obit not found")
    del obits_db[obit_id]
    return None
