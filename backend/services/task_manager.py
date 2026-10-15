import asyncio
import time
from typing import Dict, Any, Optional
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor

from utils.logging import logger

@dataclass
class Task:
    task_id: str
    task_type: str
    status: str = "pending"  # pending, running, completed, failed, cancelled
    progress: float = 0.0
    result: Optional[Any] = None
    error: Optional[str] = None
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    metadata: Dict[str, Any] = None

    def __post_init__(self):
        if self.metadata is None:
            self.metadata = {}

class AsyncTaskManager:
    def __init__(self, max_workers: int = 4):
        self.executor = ThreadPoolExecutor(max_workers=max_workers)
        self.tasks: Dict[str, Task] = {}
        self.running_tasks: Dict[str, asyncio.Task] = {}

    def cleanup_old_tasks(self, max_age_hours: int = 24):
        """Remove old completed/failed tasks"""
        current_time = time.time()
        max_age_seconds = max_age_hours * 3600

        to_remove = []
        for task_id, task in self.tasks.items():
            if (task.status in ['completed', 'failed', 'cancelled'] and
                task.end_time and
                (current_time - task.end_time) > max_age_seconds):
                to_remove.append(task_id)

        for task_id in to_remove:
            del self.tasks[task_id]

        logger.info("Cleaned up old tasks", removed_count=len(to_remove))
