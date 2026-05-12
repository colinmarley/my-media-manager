from datetime import datetime, timedelta, timezone
import uuid

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from config.settings import settings
from db.database import get_db
from db.models import AppConfig, Session as DBSession

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    password: str


class ChangePasswordRequest(BaseModel):
    currentPassword: str
    newPassword: str


async def _get_password_hash(db: AsyncSession) -> str | None:
    result = await db.execute(select(AppConfig).where(AppConfig.key == "password_hash"))
    row = result.scalar_one_or_none()
    return row.value if row else None


async def _upsert_password_hash(db: AsyncSession, hashed: str) -> None:
    result = await db.execute(select(AppConfig).where(AppConfig.key == "password_hash"))
    row = result.scalar_one_or_none()
    if row:
        row.value = hashed
    else:
        db.add(AppConfig(key="password_hash", value=hashed))
    await db.commit()


async def require_session(request: Request, db: AsyncSession = Depends(get_db)) -> DBSession:
    """Dependency that validates the session cookie on every protected request."""
    session_id = request.cookies.get("session_id")
    if not session_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    result = await db.execute(
        select(DBSession).where(
            DBSession.session_id == session_id,
            DBSession.expires_at > datetime.now(timezone.utc),
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    return session


@router.post("/login")
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    stored_hash = await _get_password_hash(db)
    if not stored_hash:
        raise HTTPException(status_code=500, detail="App password not configured")

    if not bcrypt.checkpw(body.password.encode(), stored_hash.encode()):
        raise HTTPException(status_code=401, detail="Incorrect password")

    session = DBSession(
        session_id=str(uuid.uuid4()),
        expires_at=datetime.now(timezone.utc) + timedelta(hours=settings.session_expiry_hours),
        ip_address=str(request.client.host) if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.add(session)
    await db.commit()

    response.set_cookie(
        key="session_id",
        value=session.session_id,
        httponly=True,
        secure=False,   # set True when serving over HTTPS
        samesite="lax",
        max_age=settings.session_expiry_hours * 3600,
    )
    return {"authenticated": True}


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    session_id = request.cookies.get("session_id")
    if session_id:
        await db.execute(delete(DBSession).where(DBSession.session_id == session_id))
        await db.commit()
    response.delete_cookie("session_id")
    return {"authenticated": False}


@router.get("/password-status")
async def password_status(db: AsyncSession = Depends(get_db)):
    """Expose whether a password hash is configured (no secret values returned)."""
    return {"configured": bool(await _get_password_hash(db))}


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    _session: DBSession = Depends(require_session),
    db: AsyncSession = Depends(get_db),
):
    current_hash = await _get_password_hash(db)
    if not current_hash:
        raise HTTPException(status_code=500, detail="App password not configured")

    if not body.newPassword or len(body.newPassword.strip()) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")

    if not bcrypt.checkpw(body.currentPassword.encode(), current_hash.encode()):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    new_hash = bcrypt.hashpw(body.newPassword.encode(), bcrypt.gensalt()).decode()
    await _upsert_password_hash(db, new_hash)
    return {"changed": True}


@router.get("/me")
async def me(session: DBSession = Depends(require_session)):
    return {"authenticated": True, "expires_at": session.expires_at.isoformat()}
