"""S3-compatible file storage service for monument photos."""

from __future__ import annotations

import logging
import os
from typing import Optional

import boto3
from botocore.exceptions import ClientError
from fastapi import UploadFile

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

S3_BUCKET_NAME = os.environ.get("S3_BUCKET_NAME")
S3_ACCESS_KEY = os.environ.get("S3_ACCESS_KEY")
S3_SECRET_KEY = os.environ.get("S3_SECRET_KEY")
S3_ENDPOINT_URL = os.environ.get("S3_ENDPOINT_URL")
S3_REGION = os.environ.get("S3_REGION", "us-east-1")


def _s3_configured() -> bool:
    """Return True only if all required S3 env vars are present."""
    return bool(S3_BUCKET_NAME and S3_ACCESS_KEY and S3_SECRET_KEY)


def _get_client():
    """Build and return a boto3 S3 client."""
    kwargs: dict = {
        "aws_access_key_id": S3_ACCESS_KEY,
        "aws_secret_access_key": S3_SECRET_KEY,
        "region_name": S3_REGION,
    }
    if S3_ENDPOINT_URL:
        kwargs["endpoint_url"] = S3_ENDPOINT_URL
    return boto3.client("s3", **kwargs)


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

async def upload_monument_photo(file: UploadFile, monument_id: str) -> Optional[str]:
    """Upload *file* to S3 under ``monuments/{monument_id}/{filename}``.

    Returns the S3 object key on success, or ``None`` if S3 is not configured.
    """
    if not _s3_configured():
        logger.warning("S3 is not configured – skipping photo upload.")
        return None

    filename = file.filename or "photo.jpg"
    key = f"monuments/{monument_id}/{filename}"
    content = await file.read()

    try:
        client = _get_client()
        client.put_object(
            Bucket=S3_BUCKET_NAME,
            Key=key,
            Body=content,
            ContentType=file.content_type or "application/octet-stream",
        )
    except ClientError:
        logger.exception("Failed to upload photo to S3")
        return None

    return key


def get_photo_url(key: str) -> Optional[str]:
    """Generate a presigned URL (1-hour expiry) for the given S3 key.

    Returns ``None`` if S3 is not configured.
    """
    if not _s3_configured():
        logger.warning("S3 is not configured – cannot generate presigned URL.")
        return None

    try:
        client = _get_client()
        url = client.generate_presigned_url(
            "get_object",
            Params={"Bucket": S3_BUCKET_NAME, "Key": key},
            ExpiresIn=3600,
        )
    except ClientError:
        logger.exception("Failed to generate presigned URL")
        return None

    return url


def delete_photo(key: str) -> None:
    """Delete the S3 object at *key*. No-op if S3 is not configured."""
    if not _s3_configured():
        logger.warning("S3 is not configured – skipping photo delete.")
        return

    try:
        client = _get_client()
        client.delete_object(Bucket=S3_BUCKET_NAME, Key=key)
    except ClientError:
        logger.exception("Failed to delete photo from S3")
