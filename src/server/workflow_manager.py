# Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
# SPDX-License-Identifier: MIT

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import AsyncGenerator, Optional

from src.graph.checkpoint import force_persist_conversation

logger = logging.getLogger(__name__)


@dataclass
class WorkflowRun:
    """Represents a single background workflow execution."""

    thread_id: str
    task: asyncio.Task
    status: str = "running"  # "running" | "completed" | "error"
    events: list[str] = field(default_factory=list)
    new_event: asyncio.Condition = field(default_factory=asyncio.Condition)
    created_at: datetime = field(default_factory=datetime.now)
    completed_at: Optional[datetime] = None
    error: Optional[str] = None


class WorkflowManager:
    """
    Manages background workflow executions decoupled from HTTP connections.

    Workflows run as asyncio tasks. Clients can subscribe to events via SSE,
    disconnect, and reconnect without losing progress.
    """

    def __init__(self, cleanup_interval: int = 300, max_age: int = 3600) -> None:
        self._runs: dict[str, WorkflowRun] = {}
        self._cleanup_task: Optional[asyncio.Task] = None
        self._cleanup_interval = cleanup_interval
        self._max_age = max_age

    def start_cleanup_loop(self) -> None:
        """Start the periodic cleanup background task."""
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.ensure_future(self._cleanup_loop())

    async def _cleanup_loop(self) -> None:
        """Periodically remove completed runs older than max_age."""
        while True:
            try:
                await asyncio.sleep(self._cleanup_interval)
                self.cleanup_completed(self._max_age)
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("Error in cleanup loop")

    def get_run(self, thread_id: str) -> Optional[WorkflowRun]:
        return self._runs.get(thread_id)

    def start_workflow(
        self,
        thread_id: str,
        event_generator_factory,
    ) -> WorkflowRun:
        """
        Start a workflow in the background for the given thread_id.

        If a run already exists and is still running, returns the existing run.

        Args:
            thread_id: Unique thread identifier.
            event_generator_factory: An async callable that returns an async generator
                yielding SSE event strings (e.g. "event: message_chunk\\ndata: {...}\\n\\n").
        """
        existing = self._runs.get(thread_id)
        if existing and existing.status == "running":
            logger.info(f"Workflow already running for thread {thread_id}, reusing")
            return existing

        run = WorkflowRun(
            thread_id=thread_id,
            task=asyncio.ensure_future(
                self._run_workflow(thread_id, event_generator_factory)
            ),
        )
        self._runs[thread_id] = run
        logger.info(f"Started background workflow for thread {thread_id}")
        return run

    async def _run_workflow(self, thread_id: str, event_generator_factory) -> None:
        """Execute the workflow, accumulating events."""
        run = self._runs[thread_id]
        try:
            async for event_str in event_generator_factory():
                run.events.append(event_str)
                # Notify all subscribers that a new event is available.
                # Using Condition instead of Event avoids the race where
                # set()+clear() fires before a subscriber calls wait().
                async with run.new_event:
                    run.new_event.notify_all()

            run.status = "completed"
            run.completed_at = datetime.now()
            logger.info(
                f"Workflow completed for thread {thread_id}, "
                f"total events: {len(run.events)}"
            )
        except asyncio.CancelledError:
            run.status = "error"
            run.error = "cancelled"
            run.completed_at = datetime.now()
            logger.info(f"Workflow cancelled for thread {thread_id}")
            raise  # Re-raise so asyncio.gather in cancel_all sees it
        except Exception as e:
            run.status = "error"
            run.error = str(e)
            run.completed_at = datetime.now()
            logger.exception(f"Workflow error for thread {thread_id}")
        finally:
            # Force persist all accumulated events to the database
            try:
                force_persist_conversation(thread_id)
            except Exception:
                logger.exception(
                    f"Failed to force persist events for thread {thread_id}"
                )
            # Final wake-up so subscribers know the workflow ended
            async with run.new_event:
                run.new_event.notify_all()

    async def subscribe(
        self, thread_id: str, from_index: int = 0
    ) -> AsyncGenerator[str, None]:
        """
        Subscribe to SSE events for a workflow.

        Replays events from `from_index`, then yields new events in real-time
        until the workflow completes.
        """
        run = self._runs.get(thread_id)
        if run is None:
            return

        idx = from_index

        # Replay buffered events
        while idx < len(run.events):
            yield run.events[idx]
            idx += 1

        # Stream new events until workflow finishes
        while run.status == "running":
            async with run.new_event:
                # Wait only if no new events have arrived since last check.
                # This avoids the race: if events arrived between the outer
                # while-check and this wait, idx < len(run.events) will be
                # true and we skip the wait entirely.
                if idx >= len(run.events):
                    await run.new_event.wait()
            # Drain all newly available events
            while idx < len(run.events):
                yield run.events[idx]
                idx += 1

        # Drain any remaining events after completion
        while idx < len(run.events):
            yield run.events[idx]
            idx += 1

    async def cancel_all(self) -> None:
        """Cancel all running workflows and force persist their events."""
        for thread_id, run in self._runs.items():
            if run.status == "running" and not run.task.done():
                run.task.cancel()
                logger.info(f"Cancelling workflow for thread {thread_id}")
        tasks = [r.task for r in self._runs.values() if not r.task.done()]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    def cleanup_completed(self, max_age_seconds: int = 3600) -> None:
        """Remove completed runs older than max_age_seconds."""
        now = datetime.now()
        to_remove = []
        for thread_id, run in self._runs.items():
            if run.status != "running" and run.completed_at:
                age = (now - run.completed_at).total_seconds()
                if age > max_age_seconds:
                    to_remove.append(thread_id)
        for thread_id in to_remove:
            del self._runs[thread_id]
            logger.debug(f"Cleaned up completed workflow for thread {thread_id}")
