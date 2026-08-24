from typing import Any, Dict, List, Optional
import time

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from utils.logging import logger


router = APIRouter(prefix="/api/library/compliance", tags=["Library Compliance"])


class ApiResponse(BaseModel):
    success: bool
    data: Optional[Dict[str, Any]] = None
    error: Optional[Dict[str, Any]] = None
    timestamp: str


class StartComplianceScanRequest(BaseModel):
    libraryPath: str
    triggeredBy: Optional[str] = None
    mediaType: Optional[str] = "movie"


class UpdateFindingStatusRequest(BaseModel):
    status: str
    actor: Optional[str] = None
    note: Optional[str] = None


class PreviewApplyRequest(BaseModel):
    actionIds: Optional[List[str]] = None


class UpdateActionRequest(BaseModel):
    selected: Optional[bool] = None
    targetPath: Optional[str] = None


class BulkApplyRequest(BaseModel):
    findingIds: List[str]
    actor: Optional[str] = None


class BulkStatusRequest(BaseModel):
    findingIds: List[str]
    status: str
    actor: Optional[str] = None
    note: Optional[str] = None


@router.post("/scan")
async def start_scan(request: StartComplianceScanRequest, req: Request):
    try:
        compliance_service = req.app.state.library_compliance_service
        scan_id = await compliance_service.start_scan(
            library_path=request.libraryPath,
            triggered_by=request.triggeredBy,
            media_type=request.mediaType or "movie",
        )

        return ApiResponse(
            success=True,
            data={
                "scanId": scan_id,
                "libraryPath": request.libraryPath,
                "status": "started",
            },
            timestamp=str(int(time.time())),
        )
    except Exception as exc:
        logger.error("Failed to start compliance scan", error=str(exc))
        raise HTTPException(status_code=500, detail={
            "type": "ComplianceScanError",
            "message": str(exc),
            "code": "COMPLIANCE_SCAN_FAILED",
        })


@router.get("/scan/status/{scan_id}")
async def get_scan_status(scan_id: str, req: Request):
    compliance_service = req.app.state.library_compliance_service
    status = compliance_service.get_scan_status(scan_id)
    if not status:
        raise HTTPException(status_code=404, detail="Scan not found")

    return ApiResponse(
        success=True,
        data=status,
        timestamp=str(int(time.time())),
    )


@router.post("/scan/{scan_id}/cancel")
async def cancel_scan(scan_id: str, req: Request):
    compliance_service = req.app.state.library_compliance_service
    cancelled = await compliance_service.cancel_scan(scan_id)
    if not cancelled:
        raise HTTPException(status_code=400, detail="Scan is not running")

    return ApiResponse(
        success=True,
        data={"scanId": scan_id, "status": "cancelled"},
        timestamp=str(int(time.time())),
    )


@router.get("/findings")
async def list_findings(
    req: Request,
    status: Optional[str] = None,
    severity: Optional[str] = None,
    issueType: Optional[str] = None,
    scanId: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
):
    compliance_service = req.app.state.library_compliance_service
    findings = await compliance_service.list_findings(
        status=status,
        severity=severity,
        issue_type=issueType,
        scan_id=scanId,
        limit=limit,
        offset=offset,
    )

    return ApiResponse(
        success=True,
        data={"findings": findings},
        timestamp=str(int(time.time())),
    )


@router.get("/findings/{finding_id}")
async def get_finding(finding_id: str, req: Request):
    compliance_service = req.app.state.library_compliance_service
    finding = await compliance_service.get_finding(finding_id)
    if not finding:
        raise HTTPException(status_code=404, detail="Finding not found")

    return ApiResponse(
        success=True,
        data={"finding": finding},
        timestamp=str(int(time.time())),
    )


@router.patch("/findings/{finding_id}")
async def update_finding_status(finding_id: str, body: UpdateFindingStatusRequest, req: Request):
    compliance_service = req.app.state.library_compliance_service
    finding = await compliance_service.update_finding_status(
        finding_id=finding_id,
        status=body.status,
        actor=body.actor,
        note=body.note,
    )
    if not finding:
        raise HTTPException(status_code=404, detail="Finding not found")

    return ApiResponse(
        success=True,
        data={"finding": finding},
        timestamp=str(int(time.time())),
    )


@router.patch("/findings/{finding_id}/actions/{action_id}")
async def update_finding_action(
    finding_id: str,
    action_id: str,
    body: UpdateActionRequest,
    req: Request,
):
    compliance_service = req.app.state.library_compliance_service
    action = await compliance_service.update_action(
        finding_id=finding_id,
        action_id=action_id,
        selected=body.selected,
        target_path=body.targetPath,
    )
    if not action:
        raise HTTPException(status_code=404, detail="Action not found")

    return ApiResponse(
        success=True,
        data={"action": action},
        timestamp=str(int(time.time())),
    )


@router.post("/findings/{finding_id}/preview")
async def preview_finding(finding_id: str, body: PreviewApplyRequest, req: Request):
    compliance_service = req.app.state.library_compliance_service
    preview = await compliance_service.preview_actions(
        finding_id=finding_id,
        action_ids=body.actionIds,
    )
    if not preview:
        raise HTTPException(status_code=404, detail="Finding not found")

    return ApiResponse(
        success=True,
        data=preview,
        timestamp=str(int(time.time())),
    )


@router.post("/findings/{finding_id}/apply")
async def apply_finding(finding_id: str, body: PreviewApplyRequest, req: Request):
    compliance_service = req.app.state.library_compliance_service
    result = await compliance_service.apply_actions(
        finding_id=finding_id,
        action_ids=body.actionIds,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Finding not found")

    return ApiResponse(
        success=True,
        data=result,
        timestamp=str(int(time.time())),
    )


@router.post("/bulk/apply")
async def bulk_apply(body: BulkApplyRequest, req: Request):
    compliance_service = req.app.state.library_compliance_service
    result = await compliance_service.bulk_apply(
        finding_ids=body.findingIds,
        actor=body.actor,
    )

    return ApiResponse(
        success=True,
        data=result,
        timestamp=str(int(time.time())),
    )


@router.post("/bulk/status")
async def bulk_status(body: BulkStatusRequest, req: Request):
    compliance_service = req.app.state.library_compliance_service
    result = await compliance_service.bulk_status(
        finding_ids=body.findingIds,
        status=body.status,
        actor=body.actor,
        note=body.note,
    )

    return ApiResponse(
        success=True,
        data=result,
        timestamp=str(int(time.time())),
    )


@router.get("/summary")
async def get_summary(req: Request):
    compliance_service = req.app.state.library_compliance_service
    result = await compliance_service.summary()

    return ApiResponse(
        success=True,
        data=result,
        timestamp=str(int(time.time())),
    )
