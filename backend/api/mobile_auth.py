"""
Mobile token auth
=================
Bearer-token auth for the mobile app, parallel to (not a replacement for)
the cookie-session auth in api/auth.py used by the web app.

  POST /api/mobile/login    password (+ optional deviceName) -> {token, expiresAt}
  GET  /api/mobile/me       validates Authorization: Bearer <token>
  POST /api/mobile/logout   revokes the presented token

require_any_auth() is the dependency other routers should use to protect
endpoints the mobile app needs to call — it accepts either a valid session
cookie or a valid bearer token, so the web app's existing cookie flow is
completely unaffected.
"""

import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import _get_password_hash
from config.settings import settings
from db.database import get_db
from db.models import MobileToken, Session as DBSession
from utils.logging import logger

import bcrypt

router = APIRouter(prefix="/api/mobile", tags=["Mobile Auth"])


class MobileLoginRequest(BaseModel):
    password: str
    deviceName: str | None = None


class MobileLoginResponse(BaseModel):
    token: str
    expiresAt: str


async def require_mobile_token(request: Request, db: AsyncSession = Depends(get_db)) -> MobileToken:
    """Dependency that validates a bearer token on every mobile-protected request."""
    auth_header = request.headers.get("authorization") or ""
    if not auth_header.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token_value = auth_header.split(" ", 1)[1].strip()
    if not token_value:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = await db.execute(
        select(MobileToken).where(
            MobileToken.token == token_value,
            MobileToken.revoked_at.is_(None),
            MobileToken.expires_at > datetime.now(timezone.utc),
        )
    )
    token_row = result.scalar_one_or_none()
    if not token_row:
        raise HTTPException(status_code=401, detail="Token expired or invalid")

    token_row.last_used_at = datetime.now(timezone.utc)
    await db.commit()
    return token_row


async def require_any_auth(request: Request, db: AsyncSession = Depends(get_db)):
    """Accepts either a valid session cookie (web) or a valid bearer token
    (mobile). Use this in place of require_session on endpoints the mobile
    app needs to call for writes."""
    session_id = request.cookies.get("session_id")
    if session_id:
        result = await db.execute(
            select(DBSession).where(
                DBSession.session_id == session_id,
                DBSession.expires_at > datetime.now(timezone.utc),
            )
        )
        session = result.scalar_one_or_none()
        if session:
            return session

    auth_header = request.headers.get("authorization") or ""
    if auth_header.lower().startswith("bearer "):
        token_value = auth_header.split(" ", 1)[1].strip()
        if token_value:
            result = await db.execute(
                select(MobileToken).where(
                    MobileToken.token == token_value,
                    MobileToken.revoked_at.is_(None),
                    MobileToken.expires_at > datetime.now(timezone.utc),
                )
            )
            token_row = result.scalar_one_or_none()
            if token_row:
                token_row.last_used_at = datetime.now(timezone.utc)
                await db.commit()
                return token_row

    raise HTTPException(status_code=401, detail="Not authenticated")


@router.post("/login", response_model=MobileLoginResponse)
async def mobile_login(body: MobileLoginRequest, db: AsyncSession = Depends(get_db)):
    stored_hash = await _get_password_hash(db)
    if not stored_hash:
        raise HTTPException(status_code=500, detail="App password not configured")

    if not bcrypt.checkpw(body.password.encode(), stored_hash.encode()):
        raise HTTPException(status_code=401, detail="Incorrect password")

    expires_at = datetime.now(timezone.utc) + timedelta(days=settings.mobile_token_expiry_days)
    token_row = MobileToken(
        token=secrets.token_urlsafe(32),
        device_name=body.deviceName,
        expires_at=expires_at,
    )
    db.add(token_row)
    await db.commit()

    logger.info("Mobile token issued", device_name=body.deviceName)
    return MobileLoginResponse(token=token_row.token, expiresAt=expires_at.isoformat())


@router.get("/me")
async def mobile_me(token_row: MobileToken = Depends(require_mobile_token)):
    return {
        "authenticated": True,
        "deviceName": token_row.device_name,
        "expiresAt": token_row.expires_at.isoformat(),
    }


@router.post("/logout")
async def mobile_logout(request: Request, db: AsyncSession = Depends(get_db)):
    auth_header = request.headers.get("authorization") or ""
    if auth_header.lower().startswith("bearer "):
        token_value = auth_header.split(" ", 1)[1].strip()
        if token_value:
            result = await db.execute(select(MobileToken).where(MobileToken.token == token_value))
            token_row = result.scalar_one_or_none()
            if token_row:
                token_row.revoked_at = datetime.now(timezone.utc)
                await db.commit()
    return {"authenticated": False}
