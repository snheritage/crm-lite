"""Async SQLAlchemy engine & session factory, plus a FastAPI dependency."""

from __future__ import annotations

import os

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

# ---------------------------------------------------------------------------
# URL helpers
# ---------------------------------------------------------------------------

def _build_async_url() -> str:
    """Return an asyncpg-compatible database URL.

    Railway provides ``postgresql://…`` – we swap the scheme to
    ``postgresql+asyncpg://`` so SQLAlchemy uses the asyncpg driver.
    """
    raw = os.environ.get("DATABASE_URL", "")
    if not raw:
        raise RuntimeError("DATABASE_URL environment variable is not set")

    if raw.startswith("postgres://"):
        raw = raw.replace("postgres://", "postgresql+asyncpg://", 1)
    elif raw.startswith("postgresql://"):
        raw = raw.replace("postgresql://", "postgresql+asyncpg://", 1)
    elif not raw.startswith("postgresql+asyncpg://"):
        raw = f"postgresql+asyncpg://{raw}"

    return raw


def _build_sync_url() -> str:
    """Return a psycopg2-compatible URL for Alembic migrations."""
    raw = os.environ.get("DATABASE_URL", "")
    if not raw:
        raise RuntimeError("DATABASE_URL environment variable is not set")

    if raw.startswith("postgres://"):
        raw = raw.replace("postgres://", "postgresql://", 1)
    elif raw.startswith("postgresql+asyncpg://"):
        raw = raw.replace("postgresql+asyncpg://", "postgresql://", 1)

    return raw


# ---------------------------------------------------------------------------
# Engine & session
# ---------------------------------------------------------------------------

engine = create_async_engine(_build_async_url(), echo=False)
async_session_factory = async_sessionmaker(engine, expire_on_commit=False)


# ---------------------------------------------------------------------------
# Base class for models
# ---------------------------------------------------------------------------

class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------

async def get_db():
    """Yield an ``AsyncSession`` for a single request, then close it."""
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
