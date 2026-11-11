"""Library inventory scan: kick one off, read its progress.

``POST /api/library/inventory/scan`` starts a reconcile scan in the background
(409 while one runs); ``GET /api/library/inventory/status`` returns its
progress (phase, counts, started / finished, last error).
"""

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Request

from api.mobile_auth import require_any_auth

router = APIRouter(
    prefix="/api/library/inventory",
    tags=["Library Inventory"],
    dependencies=[Depends(require_any_auth)],
)


def _service(req: Request) -> Any:
    service = getattr(req.app.state, "library_inventory_service", None)
    if service is None:
        raise HTTPException(status_code=503, detail={
            "type": "ServiceUnavailable",
            "message": "The library inventory service is not running",
            "code": "INVENTORY_UNAVAILABLE",
        })
    return service


@router.post("/scan")
async def start_inventory_scan(req: Request) -> Dict[str, Any]:
    service = _service(req)
    if not service.start_scan():
        raise HTTPException(status_code=409, detail={
            "type": "ConflictError",
            "message": "An inventory scan is already running",
            "code": "INVENTORY_SCAN_RUNNING",
            "status": service.status(),
        })
    return {"success": True, "data": service.status()}


@router.get("/status")
async def get_inventory_status(req: Request) -> Dict[str, Any]:
    return {"success": True, "data": _service(req).status()}
