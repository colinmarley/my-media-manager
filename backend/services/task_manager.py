import asyncio
import time
from typing import Dict, Any, Optional, Callable, List
from dataclasses import dataclass, asdict
from uuid import uuid4
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
        
    async def submit_task(
        self,
        task_type: str,
        func: Callable,
        *args,
        progress_callback: Optional[Callable] = None,
        **kwargs
    ) -> str:
        """Submit a new task for execution"""
        task_id = str(uuid4())
        
        task = Task(
            task_id=task_id,
            task_type=task_type,
            metadata=kwargs.get('metadata', {})
        )
        
        self.tasks[task_id] = task
        
        # Create and start the async task
        async_task = asyncio.create_task(
            self._run_task(task_id, func, progress_callback, *args, **kwargs)
        )
        
        self.running_tasks[task_id] = async_task
        
        logger.info("Task submitted", task_id=task_id, task_type=task_type)
        return task_id
    
    async def _run_task(
        self,
        task_id: str,
        func: Callable,
        progress_callback: Optional[Callable],
        *args,
        **kwargs
    ):
        """Run a task asynchronously"""
        task = self.tasks[task_id]
        task.status = "running"
        task.start_time = time.time()
        
        try:
            # Create a wrapper function that includes progress callback
            if progress_callback:
                def progress_wrapper(progress: float, **metadata):
                    task.progress = progress
                    task.metadata.update(metadata)
                    progress_callback(task)
                
                kwargs['progress_callback'] = progress_wrapper
            
            # Run the function in thread pool
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                self.executor,
                lambda: func(*args, **kwargs)
            )
            
            task.result = result
            task.status = "completed"
            task.progress = 100.0
            
            logger.info("Task completed", task_id=task_id, elapsed_time=time.time() - task.start_time)
            
        except Exception as e:
            task.error = str(e)
            task.status = "failed"
            logger.error("Task failed", task_id=task_id, error=str(e))
        
        finally:
            task.end_time = time.time()
            # Remove from running tasks
            if task_id in self.running_tasks:
                del self.running_tasks[task_id]
    
    def get_task_status(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Get task status"""
        if task_id not in self.tasks:
            return None
        
        return asdict(self.tasks[task_id])
    
    def cancel_task(self, task_id: str) -> bool:
        """Cancel a running task"""
        if task_id not in self.running_tasks:
            return False
        
        async_task = self.running_tasks[task_id]
        if not async_task.done():
            async_task.cancel()
            
            task = self.tasks[task_id]
            task.status = "cancelled"
            task.end_time = time.time()
            
            logger.info("Task cancelled", task_id=task_id)
            return True
        
        return False
    
    def list_tasks(self, status_filter: Optional[str] = None) -> List[Dict[str, Any]]:
        """List all tasks, optionally filtered by status"""
        tasks = []
        for task in self.tasks.values():
            if status_filter is None or task.status == status_filter:
                tasks.append(asdict(task))
        
        return sorted(tasks, key=lambda x: x.get('start_time', 0), reverse=True)
    
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