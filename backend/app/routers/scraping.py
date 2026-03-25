"""CRUD + scrape endpoints for user-configured obituary sources."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db
from app.models import Obit, ScrapingSource, User
from app.scraping import detect_source_type, scrape_source

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class SourceCreate(BaseModel):
    name: str
    url: str


class SourceUpdate(BaseModel):
    name: Optional[str] = None
    url: Optional[str] = None
    is_active: Optional[bool] = None


class SourceOut(BaseModel):
    id: str
    user_id: str
    name: str
    url: str
    source_type: str
    frontrunner_guid: Optional[str] = None
    is_active: bool
    last_scraped_at: Optional[str] = None
    last_scrape_count: int = 0
    last_error: Optional[str] = None
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


class ScrapeResult(BaseModel):
    new_obits: int
    total_scraped: int
    obits: list[dict]


class ScrapeAllResult(BaseModel):
    sources_scraped: int
    total_new_obits: int
    results: list[dict]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _source_to_out(src: ScrapingSource) -> SourceOut:
    return SourceOut(
        id=str(src.id),
        user_id=str(src.user_id),
        name=src.name,
        url=src.url,
        source_type=src.source_type,
        frontrunner_guid=src.frontrunner_guid,
        is_active=src.is_active,
        last_scraped_at=src.last_scraped_at.isoformat() if src.last_scraped_at else None,
        last_scrape_count=src.last_scrape_count,
        last_error=src.last_error,
        created_at=src.created_at.isoformat(),
        updated_at=src.updated_at.isoformat(),
    )


async def _get_source_or_404(
    source_id: str,
    current_user: User,
    db: AsyncSession,
) -> ScrapingSource:
    """Fetch a source by ID, enforcing ownership (or admin)."""
    try:
        sid = uuid.UUID(source_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid source ID")

    result = await db.execute(
        select(ScrapingSource).where(ScrapingSource.id == sid)
    )
    source = result.scalar_one_or_none()

    if source is None:
        raise HTTPException(status_code=404, detail="Source not found")
    if not current_user.is_admin and source.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Source not found")

    return source


async def _run_scrape_for_source(
    source: ScrapingSource,
    user: User,
    db: AsyncSession,
) -> ScrapeResult:
    """Execute the scraper for a single source, deduplicate, and save new obits."""
    now = datetime.now(timezone.utc)

    try:
        scraped = await scrape_source(source)
    except Exception as exc:
        logger.exception("Scrape failed for source %s: %s", source.id, exc)
        source.last_scraped_at = now
        source.last_scrape_count = 0
        source.last_error = str(exc)[:2000]
        await db.flush()
        raise HTTPException(
            status_code=502,
            detail=f"Scraping failed: {exc}",
        )

    # Build set of existing (deceased_name, date_of_death) for this user
    existing_result = await db.execute(
        select(Obit.deceased_name, Obit.date_of_death).where(
            Obit.user_id == user.id
        )
    )
    existing_keys = {(row[0], row[1]) for row in existing_result.all()}

    new_obits: list[dict] = []
    for rec in scraped:
        name = rec.get("name", "").strip()
        if not name:
            continue
        dod = rec.get("dod") or None

        if (name, dod) in existing_keys:
            continue

        obit = Obit(
            user_id=user.id,
            deceased_name=name,
            date_of_death=dod,
            newspaper=source.name,
            monument_ordered=False,
            notes=rec.get("url") or "",
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

    # Update source metadata
    source.last_scraped_at = now
    source.last_scrape_count = len(new_obits)
    source.last_error = None
    await db.flush()

    return ScrapeResult(
        new_obits=len(new_obits),
        total_scraped=len(scraped),
        obits=new_obits,
    )


# ---------------------------------------------------------------------------
# CRUD endpoints
# ---------------------------------------------------------------------------

@router.get("/sources", response_model=list[SourceOut])
async def list_sources(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List scraping sources. Admins see all; regular users see their own."""
    if current_user.is_admin:
        result = await db.execute(
            select(ScrapingSource).order_by(ScrapingSource.created_at.desc())
        )
    else:
        result = await db.execute(
            select(ScrapingSource)
            .where(ScrapingSource.user_id == current_user.id)
            .order_by(ScrapingSource.created_at.desc())
        )
    sources = result.scalars().all()
    return [_source_to_out(s) for s in sources]


@router.post("/sources", response_model=SourceOut, status_code=201)
async def create_source(
    payload: SourceCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a new scraping source. Auto-detects source type."""
    source_type, guid = await detect_source_type(payload.url)

    source = ScrapingSource(
        user_id=current_user.id,
        name=payload.name,
        url=payload.url,
        source_type=source_type,
        frontrunner_guid=guid,
    )
    db.add(source)
    await db.flush()
    await db.refresh(source)
    return _source_to_out(source)


@router.put("/sources/{source_id}", response_model=SourceOut)
async def update_source(
    source_id: str,
    payload: SourceUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Edit a scraping source. Re-detects source type if URL changes."""
    source = await _get_source_or_404(source_id, current_user, db)

    if payload.name is not None:
        source.name = payload.name
    if payload.is_active is not None:
        source.is_active = payload.is_active
    if payload.url is not None and payload.url != source.url:
        source.url = payload.url
        # Re-detect source type
        source_type, guid = await detect_source_type(payload.url)
        source.source_type = source_type
        source.frontrunner_guid = guid

    await db.flush()
    await db.refresh(source)
    return _source_to_out(source)


@router.delete("/sources/{source_id}", status_code=204)
async def delete_source(
    source_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a scraping source."""
    source = await _get_source_or_404(source_id, current_user, db)
    await db.delete(source)
    return None


# ---------------------------------------------------------------------------
# Scrape endpoints
# ---------------------------------------------------------------------------

@router.post("/sources/{source_id}/scrape", response_model=ScrapeResult)
async def scrape_single(
    source_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Scrape a single source now."""
    source = await _get_source_or_404(source_id, current_user, db)

    # Determine which user's obits to check against
    # (source owner, not necessarily the current admin user)
    if current_user.is_admin and source.user_id != current_user.id:
        result = await db.execute(
            select(User).where(User.id == source.user_id)
        )
        owner = result.scalar_one_or_none()
        if owner is None:
            raise HTTPException(status_code=404, detail="Source owner not found")
    else:
        owner = current_user

    return await _run_scrape_for_source(source, owner, db)


@router.post("/scrape-all", response_model=ScrapeAllResult)
async def scrape_all_user_sources(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Scrape all active sources for the current user."""
    result = await db.execute(
        select(ScrapingSource).where(
            ScrapingSource.user_id == current_user.id,
            ScrapingSource.is_active == True,  # noqa: E712
        )
    )
    sources = result.scalars().all()

    all_results: list[dict] = []
    total_new = 0

    for source in sources:
        try:
            scrape_result = await _run_scrape_for_source(source, current_user, db)
            total_new += scrape_result.new_obits
            all_results.append({
                "source_id": str(source.id),
                "source_name": source.name,
                "new_obits": scrape_result.new_obits,
                "total_scraped": scrape_result.total_scraped,
                "error": None,
            })
        except HTTPException as exc:
            all_results.append({
                "source_id": str(source.id),
                "source_name": source.name,
                "new_obits": 0,
                "total_scraped": 0,
                "error": exc.detail,
            })
        except Exception as exc:
            logger.exception("Unexpected error scraping source %s", source.id)
            all_results.append({
                "source_id": str(source.id),
                "source_name": source.name,
                "new_obits": 0,
                "total_scraped": 0,
                "error": str(exc),
            })

    return ScrapeAllResult(
        sources_scraped=len(sources),
        total_new_obits=total_new,
        results=all_results,
    )


# ---------------------------------------------------------------------------
# Admin: scrape all users' sources (for daily cron)
# ---------------------------------------------------------------------------

@router.post("/admin/scrape-all-users")
async def scrape_all_users(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Admin-only: scrape all active sources for all users."""
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )

    result = await db.execute(
        select(ScrapingSource).where(ScrapingSource.is_active == True)  # noqa: E712
    )
    sources = result.scalars().all()

    # Cache user lookups
    user_cache: dict[uuid.UUID, User] = {}
    all_results: list[dict] = []
    total_new = 0

    for source in sources:
        # Look up the source owner
        if source.user_id not in user_cache:
            user_result = await db.execute(
                select(User).where(User.id == source.user_id)
            )
            owner = user_result.scalar_one_or_none()
            if owner:
                user_cache[source.user_id] = owner
        else:
            owner = user_cache.get(source.user_id)

        if not owner:
            all_results.append({
                "source_id": str(source.id),
                "source_name": source.name,
                "user_email": "unknown",
                "new_obits": 0,
                "total_scraped": 0,
                "error": "Source owner not found",
            })
            continue

        try:
            scrape_result = await _run_scrape_for_source(source, owner, db)
            total_new += scrape_result.new_obits
            all_results.append({
                "source_id": str(source.id),
                "source_name": source.name,
                "user_email": owner.email,
                "new_obits": scrape_result.new_obits,
                "total_scraped": scrape_result.total_scraped,
                "error": None,
            })
        except HTTPException as exc:
            all_results.append({
                "source_id": str(source.id),
                "source_name": source.name,
                "user_email": owner.email,
                "new_obits": 0,
                "total_scraped": 0,
                "error": exc.detail,
            })
        except Exception as exc:
            logger.exception("Unexpected error scraping source %s", source.id)
            all_results.append({
                "source_id": str(source.id),
                "source_name": source.name,
                "user_email": owner.email,
                "new_obits": 0,
                "total_scraped": 0,
                "error": str(exc),
            })

    return {
        "sources_scraped": len(sources),
        "total_new_obits": total_new,
        "results": all_results,
    }
