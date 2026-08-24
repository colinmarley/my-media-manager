from typing import Any

from homelab_logging import setup_logging, get_logger
from homelab_logging.config import LoggingConfig

setup_logging(LoggingConfig(project="my-media-manager", service="backend"))

logger = get_logger(__name__)


def log_file_operation(
    operation: str,
    path: str,
    success: bool,
    **kwargs: Any
) -> None:
    """Log file operations with structured data"""
    logger.info(
        "file_operation",
        operation=operation,
        path=path,
        success=success,
        **kwargs
    )


def log_scan_progress(
    scan_id: str,
    current_path: str,
    processed: int,
    total: int,
    **kwargs: Any
) -> None:
    """Log scan progress"""
    logger.info(
        "scan_progress",
        scan_id=scan_id,
        current_path=current_path,
        processed=processed,
        total=total,
        percentage=round((processed / total) * 100, 2) if total > 0 else 0,
        **kwargs
    )
