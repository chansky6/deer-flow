"""Thread ownership persistence and authorization helpers."""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass

from fastapi import Depends, HTTPException
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from src.gateway.auth import AuthContext, require_auth


@dataclass(frozen=True)
class ThreadOwner:
    thread_id: str
    owner_user_id: str
    legacy: bool


_pool: ConnectionPool | None = None
_pool_lock = threading.RLock()
_initialized = False


def _get_conninfo() -> str:
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
                max_size=4,
                kwargs={"row_factory": dict_row},
            )
        return _pool


def ensure_ownership_schema() -> None:
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
                    CREATE TABLE IF NOT EXISTS thread_owners (
                        thread_id TEXT PRIMARY KEY,
                        owner_user_id TEXT NOT NULL,
                        legacy BOOLEAN NOT NULL DEFAULT FALSE,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
            conn.commit()
        _initialized = True


def record_thread_owner(thread_id: str, owner_user_id: str) -> None:
    ensure_ownership_schema()
    pool = get_db_pool()
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO thread_owners (thread_id, owner_user_id, legacy)
                VALUES (%s, %s, FALSE)
                ON CONFLICT (thread_id)
                DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id, legacy = FALSE, updated_at = NOW()
                """,
                (thread_id, owner_user_id),
            )
        conn.commit()


def delete_thread_owner(thread_id: str) -> None:
    ensure_ownership_schema()
    pool = get_db_pool()
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM thread_owners WHERE thread_id = %s", (thread_id,))
        conn.commit()


def get_thread_owner(thread_id: str) -> ThreadOwner | None:
    ensure_ownership_schema()
    pool = get_db_pool()
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT thread_id, owner_user_id, legacy FROM thread_owners WHERE thread_id = %s",
                (thread_id,),
            )
            row = cur.fetchone()
    if row is None:
        return None
    return ThreadOwner(
        thread_id=row["thread_id"],
        owner_user_id=row["owner_user_id"],
        legacy=bool(row["legacy"]),
    )


def filter_accessible_threads(items: list[dict], auth: AuthContext) -> list[dict]:
    ensure_ownership_schema()
    if not items:
        return []

    if auth.is_admin:
        return [item for item in items if isinstance(item.get("thread_id"), str)]

    thread_ids = [item.get("thread_id") for item in items if isinstance(item.get("thread_id"), str)]
    if not thread_ids:
        return []

    pool = get_db_pool()
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT thread_id, owner_user_id, legacy FROM thread_owners WHERE thread_id = ANY(%s)",
                (thread_ids,),
            )
            rows = cur.fetchall()

    ownership = {
        row["thread_id"]: ThreadOwner(
            thread_id=row["thread_id"],
            owner_user_id=row["owner_user_id"],
            legacy=bool(row["legacy"]),
        )
        for row in rows
    }

    accessible: list[dict] = []
    for item in items:
        thread_id = item.get("thread_id")
        if not isinstance(thread_id, str):
            continue
        owner = ownership.get(thread_id)
        if owner is not None and owner.owner_user_id == auth.user_id:
            accessible.append(item)
    return accessible


def can_access_thread(thread_id: str, auth: AuthContext) -> bool:
    if auth.is_admin:
        return True
    owner = get_thread_owner(thread_id)
    if owner is None:
        return False
    return owner.owner_user_id == auth.user_id


async def require_thread_owner(thread_id: str, auth: AuthContext = Depends(require_auth)) -> AuthContext:
    if not can_access_thread(thread_id, auth):
        raise HTTPException(status_code=404, detail="Thread not found")
    return auth
