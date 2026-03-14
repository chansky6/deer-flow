"""Persistent storage for the in-process monolith runtime."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool


@dataclass(frozen=True)
class ThreadOwnerRecord:
    thread_id: str
    owner_user_id: str | None
    legacy: bool


class ActiveRunConflictError(RuntimeError):
    """Raised when a thread already has a pending or running run."""


_pool: ConnectionPool | None = None
_pool_lock = threading.RLock()
_initialized = False

_THREAD_SORT_FIELDS = {
    "thread_id": "thread_id",
    "status": "status",
    "created_at": "created_at",
    "updated_at": "updated_at",
}


def _utcnow() -> datetime:
    return datetime.now(tz=UTC)


def _get_conninfo() -> str:
    import os

    conninfo = os.getenv("AUTH_DATABASE_URL") or os.getenv("DEER_FLOW_POSTGRES_URL")
    if not conninfo:
        raise RuntimeError("AUTH_DATABASE_URL or DEER_FLOW_POSTGRES_URL must be configured")
    return conninfo


def get_db_pool() -> ConnectionPool:
    global _pool
    with _pool_lock:
        if _pool is None:
            _pool = ConnectionPool(
                conninfo=_get_conninfo(),
                min_size=1,
                max_size=6,
                kwargs={"row_factory": dict_row},
            )
        return _pool


def ensure_runtime_schema() -> None:
    global _initialized
    if _initialized:
        return

    with _pool_lock:
        if _initialized:
            return

        pool = get_db_pool()
        with pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS threads (
                        thread_id TEXT PRIMARY KEY,
                        owner_user_id TEXT NULL,
                        legacy BOOLEAN NOT NULL DEFAULT FALSE,
                        assistant_id TEXT NOT NULL DEFAULT 'lead_agent',
                        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                        status TEXT NOT NULL DEFAULT 'idle',
                        values_cache JSONB NOT NULL DEFAULT '{}'::jsonb,
                        interrupts_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                        error_json JSONB NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        deleted_at TIMESTAMPTZ NULL
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS thread_states (
                        thread_id TEXT NOT NULL REFERENCES threads(thread_id) ON DELETE CASCADE,
                        checkpoint_id TEXT NOT NULL,
                        parent_checkpoint_id TEXT NULL,
                        values_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                        next_json JSONB NOT NULL DEFAULT '[]'::jsonb,
                        metadata_json JSONB NULL,
                        tasks_json JSONB NOT NULL DEFAULT '[]'::jsonb,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        PRIMARY KEY (thread_id, checkpoint_id)
                    )
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS thread_runs (
                        run_id TEXT PRIMARY KEY,
                        thread_id TEXT NOT NULL REFERENCES threads(thread_id) ON DELETE CASCADE,
                        assistant_id TEXT NOT NULL DEFAULT 'lead_agent',
                        status TEXT NOT NULL,
                        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                        multitask_strategy TEXT NULL,
                        error_json JSONB NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        finished_at TIMESTAMPTZ NULL
                    )
                    """
                )
                cur.execute(
                    """
                    ALTER TABLE thread_runs
                    ADD COLUMN IF NOT EXISTS request_json JSONB NOT NULL DEFAULT '{}'::jsonb
                    """
                )
                cur.execute(
                    """
                    ALTER TABLE thread_runs
                    ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN NOT NULL DEFAULT FALSE
                    """
                )
                cur.execute(
                    """
                    ALTER TABLE thread_runs
                    ADD COLUMN IF NOT EXISTS worker_id TEXT NULL
                    """
                )
                cur.execute(
                    """
                    ALTER TABLE thread_runs
                    ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ NULL
                    """
                )
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS run_events (
                        run_id TEXT NOT NULL REFERENCES thread_runs(run_id) ON DELETE CASCADE,
                        seq BIGINT NOT NULL,
                        event_id TEXT NOT NULL,
                        event_name TEXT NOT NULL,
                        namespace_json JSONB NULL,
                        data_json JSONB NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        PRIMARY KEY (run_id, seq),
                        UNIQUE (run_id, event_id)
                    )
                    """
                )
                cur.execute("CREATE INDEX IF NOT EXISTS idx_threads_owner_user_id ON threads(owner_user_id)")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_threads_updated_at ON threads(updated_at DESC)")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_thread_states_thread_created ON thread_states(thread_id, created_at DESC)")
                cur.execute("CREATE INDEX IF NOT EXISTS idx_thread_runs_thread_created ON thread_runs(thread_id, created_at DESC)")
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_thread_runs_thread_status
                    ON thread_runs(thread_id, status, created_at DESC)
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_thread_runs_status_created
                    ON thread_runs(status, created_at ASC)
                    """
                )
                cur.execute("CREATE INDEX IF NOT EXISTS idx_run_events_run_seq ON run_events(run_id, seq)")
                cur.execute(
                    """
                    SELECT EXISTS (
                        SELECT 1
                        FROM information_schema.tables
                        WHERE table_name = 'thread_owners'
                    ) AS exists
                    """
                )
                row = cur.fetchone() or {}
                if row.get("exists"):
                    cur.execute(
                        """
                        INSERT INTO threads (thread_id, owner_user_id, legacy, created_at, updated_at)
                        SELECT thread_id, owner_user_id, legacy, created_at, updated_at
                        FROM thread_owners
                        ON CONFLICT (thread_id)
                        DO UPDATE SET
                            owner_user_id = EXCLUDED.owner_user_id,
                            legacy = EXCLUDED.legacy,
                            updated_at = GREATEST(threads.updated_at, EXCLUDED.updated_at)
                        """
                    )
            conn.commit()

        _initialized = True


def _normalize_dt(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat()


def _checkpoint_payload(thread_id: str, checkpoint_id: str, parent_checkpoint_id: str | None = None) -> dict[str, Any]:
    return {
        "thread_id": thread_id,
        "checkpoint_ns": "",
        "checkpoint_id": checkpoint_id,
        "checkpoint_map": None,
    } | ({"parent_checkpoint_id": parent_checkpoint_id} if parent_checkpoint_id else {})


def row_to_thread_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "thread_id": row["thread_id"],
        "assistant_id": row.get("assistant_id") or "lead_agent",
        "created_at": _normalize_dt(row.get("created_at")),
        "updated_at": _normalize_dt(row.get("updated_at")),
        "metadata": row.get("metadata_json") or {},
        "status": row.get("status") or "idle",
        "values": row.get("values_cache") or {},
        "interrupts": row.get("interrupts_json") or {},
        "error": row.get("error_json"),
    }


def row_to_state_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "values": row.get("values_json") or {},
        "next": row.get("next_json") or [],
        "checkpoint": {
            "thread_id": row["thread_id"],
            "checkpoint_ns": "",
            "checkpoint_id": row["checkpoint_id"],
            "checkpoint_map": None,
        },
        "metadata": row.get("metadata_json"),
        "created_at": _normalize_dt(row.get("created_at")),
        "parent_checkpoint": (
            {
                "thread_id": row["thread_id"],
                "checkpoint_ns": "",
                "checkpoint_id": row["parent_checkpoint_id"],
                "checkpoint_map": None,
            }
            if row.get("parent_checkpoint_id")
            else None
        ),
        "tasks": row.get("tasks_json") or [],
    }


def row_to_run_payload(row: dict[str, Any], *, include_request: bool = False) -> dict[str, Any]:
    payload = {
        "run_id": row["run_id"],
        "thread_id": row["thread_id"],
        "assistant_id": row.get("assistant_id") or "lead_agent",
        "created_at": _normalize_dt(row.get("created_at")),
        "updated_at": _normalize_dt(row.get("updated_at")),
        "status": row.get("status") or "pending",
        "metadata": row.get("metadata_json") or {},
        "multitask_strategy": row.get("multitask_strategy"),
        "error": row.get("error_json"),
        "finished_at": _normalize_dt(row.get("finished_at")),
        "cancel_requested": bool(row.get("cancel_requested", False)),
        "worker_id": row.get("worker_id"),
        "claimed_at": _normalize_dt(row.get("claimed_at")),
    }
    if include_request:
        payload["request"] = row.get("request_json") or {}
    return payload


def upsert_thread(
    thread_id: str,
    *,
    owner_user_id: str | None = None,
    assistant_id: str | None = None,
    metadata: dict[str, Any] | None = None,
    status: str | None = None,
    values_cache: dict[str, Any] | None = None,
    interrupts: dict[str, Any] | None = None,
    error: Any = None,
    legacy: bool = False,
) -> dict[str, Any]:
    ensure_runtime_schema()
    metadata_is_set = metadata is not None
    values_is_set = values_cache is not None
    interrupts_is_set = interrupts is not None
    pool = get_db_pool()
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO threads (
                    thread_id,
                    owner_user_id,
                    legacy,
                    assistant_id,
                    metadata_json,
                    status,
                    values_cache,
                    interrupts_json,
                    error_json,
                    deleted_at,
                    created_at,
                    updated_at
                )
                VALUES (
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s,
                    NULL,
                    NOW(),
                    NOW()
                )
                ON CONFLICT (thread_id)
                DO UPDATE SET
                    owner_user_id = COALESCE(EXCLUDED.owner_user_id, threads.owner_user_id),
                    legacy = EXCLUDED.legacy,
                    assistant_id = COALESCE(EXCLUDED.assistant_id, threads.assistant_id),
                    metadata_json = CASE
                        WHEN %s THEN EXCLUDED.metadata_json
                        ELSE threads.metadata_json
                    END,
                    status = COALESCE(EXCLUDED.status, threads.status),
                    values_cache = CASE
                        WHEN %s THEN EXCLUDED.values_cache
                        ELSE threads.values_cache
                    END,
                    interrupts_json = CASE
                        WHEN %s THEN EXCLUDED.interrupts_json
                        ELSE threads.interrupts_json
                    END,
                    error_json = EXCLUDED.error_json,
                    deleted_at = NULL,
                    updated_at = NOW()
                RETURNING *
                """,
                (
                    thread_id,
                    owner_user_id,
                    legacy,
                    assistant_id or "lead_agent",
                    Jsonb(metadata if metadata is not None else {}),
                    status or "idle",
                    Jsonb(values_cache if values_cache is not None else {}),
                    Jsonb(interrupts if interrupts is not None else {}),
                    Jsonb(error) if error is not None else None,
                    metadata_is_set,
                    values_is_set,
                    interrupts_is_set,
                ),
            )
            row = cur.fetchone()
        conn.commit()
    return row_to_thread_payload(row or {})


def get_thread(thread_id: str, *, include_deleted: bool = False) -> dict[str, Any] | None:
    ensure_runtime_schema()
    pool = get_db_pool()
    with pool.connection() as conn:
        with conn.cursor() as cur:
            query = "SELECT * FROM threads WHERE thread_id = %s"
            if not include_deleted:
                query += " AND deleted_at IS NULL"
            cur.execute(query, (thread_id,))
            row = cur.fetchone()
    if row is None:
        return None
    return row_to_thread_payload(row)


def get_thread_owner_record(thread_id: str) -> ThreadOwnerRecord | None:
    ensure_runtime_schema()
    pool = get_db_pool()
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT thread_id, owner_user_id, legacy FROM threads WHERE thread_id = %s AND deleted_at IS NULL",
                (thread_id,),
            )
            row = cur.fetchone()
    if row is None:
        return None
    return ThreadOwnerRecord(
        thread_id=row["thread_id"],
        owner_user_id=row["owner_user_id"],
        legacy=bool(row["legacy"]),
    )


def mark_thread_deleted(thread_id: str) -> None:
    ensure_runtime_schema()
    pool = get_db_pool()
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE threads
                SET deleted_at = NOW(), status = 'idle', updated_at = NOW()
                WHERE thread_id = %s
                """,
                (thread_id,),
            )
        conn.commit()


def list_threads(
    *,
    user_id: str | None,
    is_admin: bool,
    ids: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
    values: dict[str, Any] | None = None,
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
    sort_by: str = "updated_at",
    sort_order: str = "desc",
) -> list[dict[str, Any]]:
    ensure_runtime_schema()
    sort_field = _THREAD_SORT_FIELDS.get(sort_by, "updated_at")
    sort_dir = "ASC" if str(sort_order).lower() == "asc" else "DESC"

    clauses = ["deleted_at IS NULL"]
    params: list[Any] = []

    if not is_admin:
        clauses.append("owner_user_id = %s")
        params.append(user_id)

    if ids:
        clauses.append("thread_id = ANY(%s)")
        params.append(ids)

    if status:
        clauses.append("status = %s")
        params.append(status)

    if metadata:
        clauses.append("metadata_json @> %s")
        params.append(Jsonb(metadata))

    if values:
        clauses.append("values_cache @> %s")
        params.append(Jsonb(values))

    where_sql = " AND ".join(clauses)
    query = (
        "SELECT * FROM threads "
        f"WHERE {where_sql} "
        f"ORDER BY {sort_field} {sort_dir}, thread_id ASC "
        "LIMIT %s OFFSET %s"
    )
    params.extend([max(1, limit), max(0, offset)])

    pool = get_db_pool()
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall()
    return [row_to_thread_payload(row) for row in rows]


def save_thread_state(
    thread_id: str,
    *,
    checkpoint_id: str,
    parent_checkpoint_id: str | None,
    values: dict[str, Any],
    next_nodes: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
    tasks: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    ensure_runtime_schema()
    next_nodes = list(next_nodes or [])
    tasks = list(tasks or [])
    pool = get_db_pool()
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO thread_states (
                    thread_id,
                    checkpoint_id,
                    parent_checkpoint_id,
                    values_json,
                    next_json,
                    metadata_json,
                    tasks_json,
                    created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (thread_id, checkpoint_id)
                DO UPDATE SET
                    parent_checkpoint_id = EXCLUDED.parent_checkpoint_id,
                    values_json = EXCLUDED.values_json,
                    next_json = EXCLUDED.next_json,
                    metadata_json = EXCLUDED.metadata_json,
                    tasks_json = EXCLUDED.tasks_json
                RETURNING *
                """,
                (
                    thread_id,
                    checkpoint_id,
                    parent_checkpoint_id,
                    Jsonb(values),
                    Jsonb(next_nodes),
                    Jsonb(metadata) if metadata is not None else None,
                    Jsonb(tasks),
                ),
            )
            row = cur.fetchone()
        conn.commit()
    return row_to_state_payload(row or {})


def get_latest_thread_state(thread_id: str) -> dict[str, Any] | None:
    ensure_runtime_schema()
    pool = get_db_pool()
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT *
                FROM thread_states
                WHERE thread_id = %s
                ORDER BY created_at DESC, checkpoint_id DESC
                LIMIT 1
                """,
                (thread_id,),
            )
            row = cur.fetchone()
    if row is None:
        return None
    return row_to_state_payload(row)


def list_thread_states(thread_id: str, *, limit: int = 10) -> list[dict[str, Any]]:
    ensure_runtime_schema()
    pool = get_db_pool()
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT *
                FROM thread_states
                WHERE thread_id = %s
                ORDER BY created_at DESC, checkpoint_id DESC
                LIMIT %s
                """,
                (thread_id, max(1, limit)),
            )
            rows = cur.fetchall()
    return [row_to_state_payload(row) for row in rows]


def create_run(
    run_id: str,
    *,
    thread_id: str,
    assistant_id: str,
    metadata: dict[str, Any] | None = None,
    multitask_strategy: str | None = None,
    request: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ensure_runtime_schema()
    pool = get_db_pool()
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO thread_runs (
                    run_id,
                    thread_id,
                    assistant_id,
                    status,
                    metadata_json,
                    multitask_strategy,
                    request_json,
                    created_at,
                    updated_at
                )
                VALUES (%s, %s, %s, 'running', %s, %s, %s, NOW(), NOW())
                RETURNING *
                """,
                (
                    run_id,
                    thread_id,
                    assistant_id,
                    Jsonb(metadata or {}),
                    multitask_strategy,
                    Jsonb(request or {}),
                ),
            )
            row = cur.fetchone()
        conn.commit()
    return row_to_run_payload(row or {}, include_request=True)


def create_pending_run(
    run_id: str,
    *,
    thread_id: str,
    assistant_id: str,
    request: dict[str, Any],
    metadata: dict[str, Any] | None = None,
    multitask_strategy: str | None = None,
) -> dict[str, Any]:
    ensure_runtime_schema()
    pool = get_db_pool()
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT thread_id
                FROM threads
                WHERE thread_id = %s AND deleted_at IS NULL
                FOR UPDATE
                """,
                (thread_id,),
            )
            if cur.fetchone() is None:
                raise KeyError(thread_id)

            cur.execute(
                """
                SELECT run_id
                FROM thread_runs
                WHERE thread_id = %s AND status IN ('pending', 'running')
                ORDER BY created_at DESC, run_id DESC
                LIMIT 1
                FOR UPDATE
                """,
                (thread_id,),
            )
            existing = cur.fetchone()
            if existing is not None:
                raise ActiveRunConflictError(f"Thread {thread_id} already has a running task")

            cur.execute(
                """
                INSERT INTO thread_runs (
                    run_id,
                    thread_id,
                    assistant_id,
                    status,
                    metadata_json,
                    multitask_strategy,
                    request_json,
                    cancel_requested,
                    worker_id,
                    claimed_at,
                    created_at,
                    updated_at
                )
                VALUES (%s, %s, %s, 'pending', %s, %s, %s, FALSE, NULL, NULL, NOW(), NOW())
                RETURNING *
                """,
                (
                    run_id,
                    thread_id,
                    assistant_id,
                    Jsonb(metadata or {}),
                    multitask_strategy,
                    Jsonb(request),
                ),
            )
            row = cur.fetchone()
        conn.commit()
    return row_to_run_payload(row or {}, include_request=True)


def claim_next_pending_run(worker_id: str) -> dict[str, Any] | None:
    ensure_runtime_schema()
    pool = get_db_pool()
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                WITH next_run AS (
                    SELECT run_id
                    FROM thread_runs
                    WHERE status = 'pending' AND cancel_requested = FALSE
                    ORDER BY created_at ASC, run_id ASC
                    FOR UPDATE SKIP LOCKED
                    LIMIT 1
                )
                UPDATE thread_runs AS runs
                SET status = 'running',
                    worker_id = %s,
                    claimed_at = NOW(),
                    updated_at = NOW()
                FROM next_run
                WHERE runs.run_id = next_run.run_id
                RETURNING runs.*
                """,
                (worker_id,),
            )
            row = cur.fetchone()
        conn.commit()
    if row is None:
        return None
    return row_to_run_payload(row, include_request=True)


def update_run_status(run_id: str, *, status: str, error: Any = None) -> dict[str, Any] | None:
    ensure_runtime_schema()
    pool = get_db_pool()
    finished_at = _utcnow() if status in {"success", "error", "interrupted", "timeout"} else None
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE thread_runs
                SET status = %s,
                    error_json = %s,
                    updated_at = NOW(),
                    finished_at = COALESCE(%s, finished_at)
                WHERE run_id = %s
                RETURNING *
                """,
                (
                    status,
                    Jsonb(error) if error is not None else None,
                    finished_at,
                    run_id,
                ),
            )
            row = cur.fetchone()
        conn.commit()
    if row is None:
        return None
    return row_to_run_payload(row)


def mark_run_cancel_requested(run_id: str) -> dict[str, Any] | None:
    ensure_runtime_schema()
    pool = get_db_pool()
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE thread_runs
                SET cancel_requested = TRUE,
                    updated_at = NOW()
                WHERE run_id = %s
                RETURNING *
                """,
                (run_id,),
            )
            row = cur.fetchone()
        conn.commit()
    if row is None:
        return None
    return row_to_run_payload(row)


def get_run_request(run_id: str) -> dict[str, Any] | None:
    ensure_runtime_schema()
    pool = get_db_pool()
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT request_json FROM thread_runs WHERE run_id = %s", (run_id,))
            row = cur.fetchone()
    if row is None:
        return None
    return row.get("request_json") or {}


def get_run_control(run_id: str) -> dict[str, Any] | None:
    ensure_runtime_schema()
    pool = get_db_pool()
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT run_id, thread_id, status, cancel_requested, worker_id, claimed_at, updated_at
                FROM thread_runs
                WHERE run_id = %s
                """,
                (run_id,),
            )
            row = cur.fetchone()
    if row is None:
        return None
    return {
        "run_id": row["run_id"],
        "thread_id": row["thread_id"],
        "status": row["status"],
        "cancel_requested": bool(row.get("cancel_requested", False)),
        "worker_id": row.get("worker_id"),
        "claimed_at": _normalize_dt(row.get("claimed_at")),
        "updated_at": _normalize_dt(row.get("updated_at")),
    }


def get_run(run_id: str) -> dict[str, Any] | None:
    ensure_runtime_schema()
    pool = get_db_pool()
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM thread_runs WHERE run_id = %s", (run_id,))
            row = cur.fetchone()
    if row is None:
        return None
    return row_to_run_payload(row)


def append_run_event(
    run_id: str,
    *,
    seq: int,
    event_name: str,
    data: Any,
    namespace: list[str] | None = None,
) -> dict[str, Any]:
    ensure_runtime_schema()
    event_id = str(seq)
    pool = get_db_pool()
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO run_events (
                    run_id,
                    seq,
                    event_id,
                    event_name,
                    namespace_json,
                    data_json,
                    created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, NOW())
                RETURNING *
                """,
                (
                    run_id,
                    seq,
                    event_id,
                    event_name,
                    Jsonb(namespace) if namespace is not None else None,
                    Jsonb(data),
                ),
            )
            row = cur.fetchone()
        conn.commit()
    return {
        "id": row["event_id"],
        "seq": row["seq"],
        "event": row["event_name"],
        "data": row["data_json"],
        "namespace": row.get("namespace_json"),
        "created_at": _normalize_dt(row.get("created_at")),
    }


def append_run_event_auto(
    run_id: str,
    *,
    event_name: str,
    data: Any,
    namespace: list[str] | None = None,
) -> dict[str, Any]:
    ensure_runtime_schema()
    pool = get_db_pool()
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT run_id FROM thread_runs WHERE run_id = %s FOR UPDATE", (run_id,))
            if cur.fetchone() is None:
                raise KeyError(run_id)

            cur.execute(
                """
                SELECT COALESCE(MAX(seq), 0) AS latest_seq
                FROM run_events
                WHERE run_id = %s
                """,
                (run_id,),
            )
            latest_row = cur.fetchone() or {}
            seq = int(latest_row.get("latest_seq") or 0) + 1
            event_id = str(seq)

            cur.execute(
                """
                INSERT INTO run_events (
                    run_id,
                    seq,
                    event_id,
                    event_name,
                    namespace_json,
                    data_json,
                    created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, NOW())
                RETURNING *
                """,
                (
                    run_id,
                    seq,
                    event_id,
                    event_name,
                    Jsonb(namespace) if namespace is not None else None,
                    Jsonb(data),
                ),
            )
            row = cur.fetchone()
        conn.commit()
    return {
        "id": row["event_id"],
        "seq": row["seq"],
        "event": row["event_name"],
        "data": row["data_json"],
        "namespace": row.get("namespace_json"),
        "created_at": _normalize_dt(row.get("created_at")),
    }


def list_run_events(run_id: str, *, after_event_id: str | None = None, limit: int = 10000) -> list[dict[str, Any]]:
    ensure_runtime_schema()
    pool = get_db_pool()
    after_seq = 0
    if after_event_id:
        try:
            after_seq = int(after_event_id)
        except ValueError:
            after_seq = 0

    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT *
                FROM run_events
                WHERE run_id = %s AND seq > %s
                ORDER BY seq ASC
                LIMIT %s
                """,
                (run_id, after_seq, max(1, limit)),
            )
            rows = cur.fetchall()
    return [
        {
            "id": row["event_id"],
            "seq": row["seq"],
            "event": row["event_name"],
            "data": row["data_json"],
            "namespace": row.get("namespace_json"),
            "created_at": _normalize_dt(row.get("created_at")),
        }
        for row in rows
    ]
