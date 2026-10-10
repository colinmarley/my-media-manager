"""
App-wide error responses
=========================
Without these, a database error or an unexpected exception reached the
client as Starlette's plain-text "Internal Server Error" — no JSON `detail`,
nothing a client can show, and no way to find the request in the logs.

Every error now comes back as JSON with a `detail` string and the request's
`correlation_id` (the same id CorrelationMiddleware puts in the
X-Correlation-ID header and on every log line):

  IntegrityError (duplicate key, missing foreign key)  -> 409
  DataError (value doesn't fit the column type)        -> 422
  anything else unhandled                              -> 500
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DataError, IntegrityError
from starlette.middleware.base import BaseHTTPMiddleware

from homelab_logging import correlation_id_var
from utils.logging import logger


def _body(detail: str) -> dict:
    return {"detail": detail, "correlation_id": correlation_id_var.get("") or None}


async def _integrity_error(request: Request, exc: IntegrityError) -> JSONResponse:
    logger.warning("Integrity error", path=request.url.path, error=str(exc.orig))
    return JSONResponse(
        status_code=409,
        content=_body("This change conflicts with existing data (a duplicate, or a reference to something that no longer exists)."),
    )


async def _data_error(request: Request, exc: DataError) -> JSONResponse:
    logger.warning("Data error", path=request.url.path, error=str(exc.orig))
    return JSONResponse(status_code=422, content=_body("One of the values has the wrong type or is too long."))


class UnhandledErrorMiddleware(BaseHTTPMiddleware):
    """Turn an unhandled exception into a JSON 500.

    A plain `app.exception_handler(Exception)` runs in Starlette's outermost
    ServerErrorMiddleware — after CorrelationMiddleware has already reset the
    correlation id and without it adding the response header. Registered
    inside CorrelationMiddleware instead, so both survive."""

    async def dispatch(self, request: Request, call_next):
        try:
            return await call_next(request)
        except Exception:
            logger.exception("Unhandled error", path=request.url.path, method=request.method)
            return JSONResponse(status_code=500, content=_body("Something went wrong on the server."))


def install_error_handling(app: FastAPI) -> None:
    """Register the handlers. Call before adding CorrelationMiddleware, so
    the catch-all middleware ends up inside it."""
    app.add_exception_handler(IntegrityError, _integrity_error)
    app.add_exception_handler(DataError, _data_error)
    app.add_middleware(UnhandledErrorMiddleware)
