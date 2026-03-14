"""Background runner for pending monolith runtime tasks."""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import socket
import uuid

from . import repository
from .service import get_monolith_runtime

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

logger = logging.getLogger(__name__)


async def _run_worker() -> None:
    runtime = get_monolith_runtime()
    worker_id = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"
    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()

    def _request_stop() -> None:
        if stop_event.is_set():
            return
        logger.info("Stopping monolith runner: worker=%s", worker_id)
        stop_event.set()

    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, _request_stop)
        except NotImplementedError:
            signal.signal(sig, lambda *_args: _request_stop())

    await runtime.ensure_ready()
    logger.info("Monolith runner started: worker=%s", worker_id)

    try:
        while not stop_event.is_set():
            claimed = await asyncio.to_thread(repository.claim_next_pending_run, worker_id)
            if claimed is None:
                try:
                    await asyncio.wait_for(stop_event.wait(), timeout=0.25)
                except asyncio.TimeoutError:
                    pass
                continue

            logger.info(
                "Claimed monolith run: worker=%s thread=%s run=%s",
                worker_id,
                claimed["thread_id"],
                claimed["run_id"],
            )
            try:
                await runtime.execute_claimed_run(claimed)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception(
                    "Monolith runner execution failed: worker=%s thread=%s run=%s",
                    worker_id,
                    claimed["thread_id"],
                    claimed["run_id"],
                )
    finally:
        await runtime.close()
        logger.info("Monolith runner stopped: worker=%s", worker_id)


def main() -> None:
    asyncio.run(_run_worker())


if __name__ == "__main__":
    main()
