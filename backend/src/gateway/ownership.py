"""Thread ownership persistence and authorization helpers."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, HTTPException

from src.gateway.auth import AuthContext, require_auth
from src.runtime import repository


@dataclass(frozen=True)
class ThreadOwner:
    thread_id: str
    owner_user_id: str | None
    legacy: bool


def ensure_ownership_schema() -> None:
    repository.ensure_runtime_schema()


def record_thread_owner(thread_id: str, owner_user_id: str) -> None:
    ensure_ownership_schema()
    repository.upsert_thread(
        thread_id,
        owner_user_id=owner_user_id,
        legacy=False,
    )


def delete_thread_owner(thread_id: str) -> None:
    ensure_ownership_schema()
    repository.mark_thread_deleted(thread_id)


def get_thread_owner(thread_id: str) -> ThreadOwner | None:
    ensure_ownership_schema()
    record = repository.get_thread_owner_record(thread_id)
    if record is None:
        return None
    return ThreadOwner(
        thread_id=record.thread_id,
        owner_user_id=record.owner_user_id,
        legacy=record.legacy,
    )


def filter_accessible_threads(items: list[dict], auth: AuthContext) -> list[dict]:
    ensure_ownership_schema()
    if auth.is_admin:
        return [item for item in items if isinstance(item.get("thread_id"), str)]

    accessible_thread_ids = {
        thread["thread_id"]
        for thread in repository.list_threads(
            user_id=auth.user_id,
            is_admin=False,
            ids=[item["thread_id"] for item in items if isinstance(item.get("thread_id"), str)],
            limit=max(1, len(items)),
            offset=0,
        )
    }
    return [
        item
        for item in items
        if isinstance(item.get("thread_id"), str) and item["thread_id"] in accessible_thread_ids
    ]


def can_access_thread(thread_id: str, auth: AuthContext) -> bool:
    if auth.is_admin:
        return repository.get_thread(thread_id) is not None

    owner = get_thread_owner(thread_id)
    if owner is None:
        return False
    return owner.owner_user_id == auth.user_id


async def require_thread_owner(thread_id: str, auth: AuthContext = Depends(require_auth)) -> AuthContext:
    if not can_access_thread(thread_id, auth):
        raise HTTPException(status_code=404, detail="Thread not found")
    return auth
