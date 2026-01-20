import structlog
import logging
from typing import Any, Dict

# Configure structured logging
structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer()
    ],
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    wrapper_class=structlog.stdlib.BoundLogger,
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger(__name__)

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