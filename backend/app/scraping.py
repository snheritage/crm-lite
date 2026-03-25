"""Core scraping logic for obituary sources.

Supports two scraper types:
- FrontRunner (frontrunnerpro.com API)
- Generic HTML (best-effort heuristic parsing)
"""

from __future__ import annotations

import logging
import re
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup

from app.models import ScrapingSource

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# FrontRunner scraper
# ---------------------------------------------------------------------------

FRONTRUNNER_API_PATH = "/ims/WF2/public/get-records-additional.php"


async def scrape_frontrunner(guid: str, url: str) -> list[dict]:
    """Scrape obituaries from a FrontRunner Pro site.

    Returns list of {"name": str, "dod": str|None, "url": str|None}.
    """
    # Derive the API endpoint from the site URL
    # FrontRunner URLs look like:
    #   https://obituaries.frontrunnerpro.com/runtime/<id>/...
    # The API endpoint is at the same origin with a known path.
    api_url = _frontrunner_api_url(url)

    params = {
        "guid": guid,
        "wholeSite": "true",
        "type": "current",
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            api_url,
            data=params,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        resp.raise_for_status()

    body = resp.json()
    if not body.get("success"):
        raise ValueError("FrontRunner API returned failure")

    records = body.get("data") or []
    results: list[dict] = []
    for rec in records:
        name = rec.get("name", "").strip()
        if not name:
            continue
        results.append({
            "name": name,
            "dod": rec.get("dod") or None,
            "url": rec.get("url") or None,
        })
    return results


def _frontrunner_api_url(url: str) -> str:
    """Derive the FrontRunner API endpoint from the page URL."""
    # Try to extract the runtime ID from the URL
    match = re.search(r"frontrunnerpro\.com/runtime/(\d+)", url)
    if match:
        runtime_id = match.group(1)
        return f"https://obituaries.frontrunnerpro.com/runtime/{runtime_id}{FRONTRUNNER_API_PATH}"
    # Fallback: use the known Chapel Ridge endpoint pattern
    return f"https://obituaries.frontrunnerpro.com/runtime/311039{FRONTRUNNER_API_PATH}"


# ---------------------------------------------------------------------------
# Generic HTML scraper
# ---------------------------------------------------------------------------

# CSS selectors/class patterns commonly used for obituary listings
_OBIT_SELECTORS = [
    ".obituary",
    ".obit",
    ".obituary-item",
    ".obit-item",
    ".obituary-card",
    ".obit-card",
    ".obituary-listing",
    ".obit-listing",
    ".obituary-entry",
    ".obit-entry",
    "[class*='obituar']",
    "[class*='obit']",
    "article",
    ".listing",
    ".entry",
]

# Date pattern: matches common date formats in obituary text
_DATE_PATTERNS = [
    # "January 15, 2026" or "Jan 15, 2026"
    re.compile(
        r"\b(?:January|February|March|April|May|June|July|August|September|October|November|December|"
        r"Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2},?\s+\d{4}\b",
        re.IGNORECASE,
    ),
    # "01/15/2026" or "1-15-2026"
    re.compile(r"\b\d{1,2}[/\-]\d{1,2}[/\-]\d{4}\b"),
    # "2026-01-15"
    re.compile(r"\b\d{4}-\d{2}-\d{2}\b"),
]


async def scrape_generic_obits(url: str) -> list[dict]:
    """Best-effort generic HTML scraper for obituary listings.

    Returns list of {"name": str, "dod": str|None, "url": str|None}.
    """
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0 obit-crm-lite/1.0"})
        resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "lxml")
    results: list[dict] = []
    seen_names: set[str] = set()

    # Try each selector, collect candidate elements
    candidates: list[BeautifulSoup] = []
    for selector in _OBIT_SELECTORS:
        try:
            found = soup.select(selector)
            if found:
                candidates.extend(found)
        except Exception:
            continue

    # Deduplicate candidates by their text content
    seen_texts: set[str] = set()
    unique_candidates = []
    for el in candidates:
        text = el.get_text(strip=True)[:200]
        if text and text not in seen_texts:
            seen_texts.add(text)
            unique_candidates.append(el)

    for el in unique_candidates:
        record = _extract_obit_from_element(el, url)
        if record and record["name"] not in seen_names:
            seen_names.add(record["name"])
            results.append(record)

    # If selectors found nothing, try a fallback: look for <h2>/<h3> tags
    # that might be obituary names
    if not results:
        for tag in soup.find_all(["h2", "h3", "h4"]):
            text = tag.get_text(strip=True)
            if _looks_like_name(text):
                link = tag.find("a")
                obit_url = None
                if link and link.get("href"):
                    obit_url = urljoin(url, link["href"])

                # Look for a date nearby
                dod = _find_nearby_date(tag)

                if text not in seen_names:
                    seen_names.add(text)
                    results.append({
                        "name": text,
                        "dod": dod,
                        "url": obit_url,
                    })

    return results


def _extract_obit_from_element(el: BeautifulSoup, base_url: str) -> dict | None:
    """Extract name, date, and link from a candidate obituary element."""
    # Try to find a name — usually in a heading or strong tag, or the first link
    name = None
    obit_url = None

    # Check headings first
    heading = el.find(["h1", "h2", "h3", "h4", "h5", "h6"])
    if heading:
        name = heading.get_text(strip=True)
        link = heading.find("a")
        if link and link.get("href"):
            obit_url = urljoin(base_url, link["href"])

    # Fallback: first link
    if not name:
        link = el.find("a")
        if link:
            text = link.get_text(strip=True)
            if _looks_like_name(text):
                name = text
                if link.get("href"):
                    obit_url = urljoin(base_url, link["href"])

    # Fallback: strong/b tag
    if not name:
        strong = el.find(["strong", "b"])
        if strong:
            text = strong.get_text(strip=True)
            if _looks_like_name(text):
                name = text

    if not name:
        return None

    # Clean up the name
    name = _clean_name(name)
    if not name or len(name) < 3:
        return None

    # Extract date of death
    dod = _find_date_in_element(el)

    return {
        "name": name,
        "dod": dod,
        "url": obit_url,
    }


def _looks_like_name(text: str) -> bool:
    """Heuristic check if text looks like a person's name."""
    if not text or len(text) < 3 or len(text) > 120:
        return False
    # Should have at least 2 words
    words = text.split()
    if len(words) < 2:
        return False
    # Should not be too many words (likely a sentence)
    if len(words) > 8:
        return False
    # Should not contain too many non-alpha characters
    alpha_ratio = sum(1 for c in text if c.isalpha()) / max(len(text), 1)
    if alpha_ratio < 0.6:
        return False
    return True


def _clean_name(name: str) -> str:
    """Clean up an extracted name."""
    # Remove common prefixes/suffixes
    name = re.sub(r"\s*obituary\s*", "", name, flags=re.IGNORECASE).strip()
    name = re.sub(r"\s*-\s*$", "", name).strip()
    # Remove dates from the name
    for pattern in _DATE_PATTERNS:
        name = pattern.sub("", name).strip()
    # Clean extra whitespace
    name = re.sub(r"\s+", " ", name).strip()
    return name


def _find_date_in_element(el: BeautifulSoup) -> str | None:
    """Find a date in the text content of an element."""
    text = el.get_text()
    for pattern in _DATE_PATTERNS:
        match = pattern.search(text)
        if match:
            return match.group(0)
    return None


def _find_nearby_date(tag: BeautifulSoup) -> str | None:
    """Look for a date in the next few siblings of a tag."""
    for sibling in list(tag.next_siblings)[:5]:
        text = sibling.string if hasattr(sibling, "string") else str(sibling)
        if text:
            for pattern in _DATE_PATTERNS:
                match = pattern.search(text)
                if match:
                    return match.group(0)
    return None


# ---------------------------------------------------------------------------
# Source type detection
# ---------------------------------------------------------------------------

async def detect_source_type(url: str) -> tuple[str, str | None]:
    """Detect whether a URL is a FrontRunner site or generic.

    Returns (source_type, frontrunner_guid).
    """
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            resp = await client.get(
                url, headers={"User-Agent": "Mozilla/5.0 obit-crm-lite/1.0"}
            )
            resp.raise_for_status()
    except Exception:
        # If we can't fetch, default to generic
        return ("generic", None)

    text = resp.text

    # Check for FrontRunner indicators
    if "frontrunnerpro.com" in text or "frontrunnerpro" in url.lower():
        # Try to extract the guid from the page source
        guid = _extract_frontrunner_guid(text)
        if guid:
            return ("frontrunner", guid)
        return ("frontrunner", None)

    return ("generic", None)


def _extract_frontrunner_guid(html: str) -> str | None:
    """Extract the FrontRunner guid parameter from page HTML."""
    # Look for guid in JavaScript or form data
    patterns = [
        re.compile(r'["\']guid["\']\s*:\s*["\']([^"\']+)["\']'),
        re.compile(r"guid=([A-Za-z0-9+/=]+)"),
        re.compile(r'guid["\']\s*,\s*["\']([^"\']+)["\']'),
    ]
    for pattern in patterns:
        match = pattern.search(html)
        if match:
            return match.group(1)
    return None


# ---------------------------------------------------------------------------
# Main dispatcher
# ---------------------------------------------------------------------------

async def scrape_source(source: ScrapingSource) -> list[dict]:
    """Route to the appropriate scraper based on source_type.

    Returns list of {"name": str, "dod": str|None, "url": str|None}.
    """
    if source.source_type == "frontrunner" and source.frontrunner_guid:
        return await scrape_frontrunner(source.frontrunner_guid, source.url)
    else:
        return await scrape_generic_obits(source.url)
