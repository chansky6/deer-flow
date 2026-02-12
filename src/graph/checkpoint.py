# Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
# SPDX-License-Identifier: MIT

import json
import logging
import uuid
from datetime import datetime
from typing import List, Optional, Tuple

import psycopg
from langgraph.store.memory import InMemoryStore
from psycopg.rows import dict_row
from pymongo import MongoClient

from src.config.loader import get_bool_env, get_str_env


class ChatStreamManager:
    """
    Manages chat stream messages with persistent storage and in-memory caching.

    This class handles the storage and retrieval of chat messages using both
    an in-memory store for temporary data and MongoDB or PostgreSQL for persistent storage.
    It tracks message chunks and consolidates them when a conversation finishes.

    Attributes:
        store (InMemoryStore): In-memory storage for temporary message chunks
        mongo_client (MongoClient): MongoDB client connection
        mongo_db (Database): MongoDB database instance
        postgres_conn (psycopg.Connection): PostgreSQL connection
        logger (logging.Logger): Logger instance for this class
    """

    def __init__(
        self, checkpoint_saver: bool = False, db_uri: Optional[str] = None
    ) -> None:
        """
        Initialize the ChatStreamManager with database connections.

        Args:
            db_uri: Database connection URI. Supports MongoDB (mongodb://) and PostgreSQL (postgresql://)
                   If None, uses LANGGRAPH_CHECKPOINT_DB_URL env var or defaults to localhost
        """
        self.logger = logging.getLogger(__name__)
        self.store = InMemoryStore()
        self.checkpoint_saver = checkpoint_saver
        # Use provided URI or fall back to environment variable or default
        self.db_uri = db_uri

        # Initialize database connections
        self.mongo_client = None
        self.mongo_db = None
        self.postgres_conn = None

        if self.checkpoint_saver:
            if self.db_uri is None:
                self.logger.warning(
                    "Checkpoint saver is enabled but db_uri is None. "
                    "Please provide a valid database URI or disable checkpoint saver."
                )
            elif self.db_uri.startswith("mongodb://"):
                self._init_mongodb()
            elif self.db_uri.startswith("postgresql://") or self.db_uri.startswith(
                "postgres://"
            ):
                self._init_postgresql()
            else:
                self.logger.warning(
                    f"Unsupported database URI scheme: {self.db_uri}. "
                    "Supported schemes: mongodb://, postgresql://, postgres://"
                )
        else:
            self.logger.warning("Checkpoint saver is disabled")

    def _init_mongodb(self) -> None:
        """Initialize MongoDB connection."""

        try:
            self.mongo_client = MongoClient(self.db_uri)
            self.mongo_db = self.mongo_client.checkpointing_db
            # Test connection
            self.mongo_client.admin.command("ping")
            self.logger.info("Successfully connected to MongoDB")
        except Exception as e:
            self.logger.error(f"Failed to connect to MongoDB: {e}")

    def _init_postgresql(self) -> None:
        """Initialize PostgreSQL connection and create table if needed."""

        try:
            self.postgres_conn = psycopg.connect(self.db_uri, row_factory=dict_row)
            self.logger.info("Successfully connected to PostgreSQL")
            self._create_chat_streams_table()
        except Exception as e:
            self.logger.error(f"Failed to connect to PostgreSQL: {e}")

    def _create_chat_streams_table(self) -> None:
        """Create the chat_streams table if it doesn't exist."""
        try:
            with self.postgres_conn.cursor() as cursor:
                create_table_sql = """
                CREATE TABLE IF NOT EXISTS chat_streams (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    thread_id VARCHAR(255) NOT NULL UNIQUE,
                    messages JSONB NOT NULL,
                    ts TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
                );
                
                CREATE INDEX IF NOT EXISTS idx_chat_streams_thread_id ON chat_streams(thread_id);
                CREATE INDEX IF NOT EXISTS idx_chat_streams_ts ON chat_streams(ts);
                """
                cursor.execute(create_table_sql)
                self.postgres_conn.commit()
                self.logger.info("Chat streams table created/verified successfully")
        except Exception as e:
            self.logger.error(f"Failed to create chat_streams table: {e}")
            if self.postgres_conn:
                self.postgres_conn.rollback()

    def process_stream_message(
        self, thread_id: str, message: str, finish_reason: str
    ) -> bool:
        """
        Process and store a chat stream message chunk.

        Every event is immediately persisted to the database so that sessions
        can be restored even after a server restart or mid-workflow crash.
        The in-memory store is kept as a secondary cache for fast access.

        Args:
            thread_id: Unique identifier for the conversation thread
            message: The message content or chunk to store
            finish_reason: Reason for message completion ("stop", "interrupt", or partial)

        Returns:
            bool: True if message was processed successfully, False otherwise
        """
        if not thread_id or not isinstance(thread_id, str):
            self.logger.warning("Invalid thread_id provided")
            return False

        if not message:
            self.logger.warning("Empty message provided")
            return False

        try:
            # Create namespace for this thread's messages
            store_namespace: Tuple[str, str] = ("messages", thread_id)

            # Get or initialize message cursor for tracking chunks
            cursor = self.store.get(store_namespace, "cursor")
            current_index = 0

            if cursor is None:
                # Initialize cursor for new conversation
                self.store.put(store_namespace, "cursor", {"index": 0})
            else:
                # Increment index for next chunk
                current_index = int(cursor.value.get("index", 0)) + 1
                self.store.put(store_namespace, "cursor", {"index": current_index})

            # Store the current message chunk in memory
            self.store.put(store_namespace, f"chunk_{current_index}", message)

            # Persist every event to the database immediately
            self._append_single_message(thread_id, message)

            # On completion, clean up the in-memory store
            if finish_reason in ("stop", "interrupt"):
                try:
                    memories = self.store.search(
                        store_namespace, limit=current_index + 2
                    )
                    for item in memories:
                        self.store.delete(store_namespace, item.key)
                except Exception as e:
                    self.logger.error(
                        f"Error cleaning up memory store for thread {thread_id}: {e}"
                    )

            return True

        except Exception as e:
            self.logger.error(
                f"Error processing stream message for thread {thread_id}: {e}"
            )
            return False

    def _append_single_message(self, thread_id: str, message: str) -> bool:
        """
        Append a single SSE event to the database immediately.

        Uses upsert semantics: creates the document/row if it doesn't exist,
        otherwise appends to the messages array.
        """
        if not self.checkpoint_saver:
            return False

        try:
            if self.mongo_db is not None:
                return self._append_single_to_mongodb(thread_id, message)
            elif self.postgres_conn is not None:
                return self._append_single_to_postgresql(thread_id, message)
            else:
                return False
        except Exception as e:
            self.logger.error(
                f"Error appending message to DB for thread {thread_id}: {e}"
            )
            return False

    def _append_single_to_mongodb(self, thread_id: str, message: str) -> bool:
        """Append a single message to MongoDB using upsert."""
        try:
            collection = self.mongo_db.chat_streams
            result = collection.update_one(
                {"thread_id": thread_id},
                {
                    "$push": {"messages": message},
                    "$set": {"ts": datetime.now()},
                    "$setOnInsert": {"id": uuid.uuid4().hex},
                },
                upsert=True,
            )
            return result.acknowledged
        except Exception as e:
            self.logger.error(f"Error appending to MongoDB: {e}")
            return False

    def _append_single_to_postgresql(self, thread_id: str, message: str) -> bool:
        """Append a single message to PostgreSQL using upsert."""
        try:
            with self.postgres_conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO chat_streams (id, thread_id, messages, ts)
                    VALUES (%s, %s, %s::jsonb, %s)
                    ON CONFLICT (thread_id) DO UPDATE
                    SET messages = chat_streams.messages || %s::jsonb,
                        ts = %s
                    """,
                    (
                        uuid.uuid4(),
                        thread_id,
                        json.dumps([message]),
                        datetime.now(),
                        json.dumps([message]),
                        datetime.now(),
                    ),
                )
                self.postgres_conn.commit()
                return cursor.rowcount > 0
        except Exception as e:
            self.logger.error(f"Error appending to PostgreSQL: {e}")
            if self.postgres_conn:
                self.postgres_conn.rollback()
            return False

    def _persist_complete_conversation(
        self, thread_id: str, store_namespace: Tuple[str, str], final_index: int
    ) -> bool:
        """
        Persist completed conversation to database (MongoDB or PostgreSQL).

        Retrieves all message chunks from memory store and saves the complete
        conversation to the configured database for permanent storage.

        Args:
            thread_id: Unique identifier for the conversation thread
            store_namespace: Namespace tuple for accessing stored messages
            final_index: The final chunk index for this conversation

        Returns:
            bool: True if persistence was successful, False otherwise
        """
        try:
            # Retrieve all message chunks from memory store
            # Get all messages up to the final index including cursor metadata
            memories = self.store.search(store_namespace, limit=final_index + 2)

            # Extract message content, filtering out cursor metadata
            messages: List[str] = []
            for item in memories:
                value = item.dict().get("value", "")
                # Skip cursor metadata, only include actual message chunks
                if value and not isinstance(value, dict):
                    messages.append(str(value))

            if not messages:
                self.logger.warning(f"No messages found for thread {thread_id}")
                return False

            if not self.checkpoint_saver:
                self.logger.warning("Checkpoint saver is disabled")
                return False

            # Choose persistence method based on available connection
            success = False
            if self.mongo_db is not None:
                success = self._persist_to_mongodb(thread_id, messages)
            elif self.postgres_conn is not None:
                success = self._persist_to_postgresql(thread_id, messages)
            else:
                self.logger.warning("No database connection available")
                return False

            if success:
                try:
                    for item in memories:
                        self.store.delete(store_namespace, item.key)
                except Exception as e:
                    self.logger.error(
                        f"Error cleaning up memory store for thread {thread_id}: {e}"
                    )

            return success

        except Exception as e:
            self.logger.error(
                f"Error persisting conversation for thread {thread_id}: {e}"
            )
            return False

    def _persist_to_mongodb(self, thread_id: str, messages: List[str]) -> bool:
        """Persist conversation to MongoDB."""
        try:
            # Get MongoDB collection for chat streams
            collection = self.mongo_db.chat_streams

            # Check if conversation already exists in database
            existing_document = collection.find_one({"thread_id": thread_id})

            current_timestamp = datetime.now()

            if existing_document:
                # Append new messages to existing conversation
                update_result = collection.update_one(
                    {"thread_id": thread_id},
                    {
                        "$push": {"messages": {"$each": messages}},
                        "$set": {"ts": current_timestamp}
                    },
                )
                self.logger.info(
                    f"Updated conversation for thread {thread_id}: "
                    f"{update_result.modified_count} documents modified"
                )
                return update_result.modified_count > 0
            else:
                # Create new conversation document
                new_document = {
                    "thread_id": thread_id,
                    "messages": messages,
                    "ts": current_timestamp,
                    "id": uuid.uuid4().hex,
                }
                insert_result = collection.insert_one(new_document)
                self.logger.info(
                    f"Created new conversation: {insert_result.inserted_id}"
                )
                return insert_result.inserted_id is not None

        except Exception as e:
            self.logger.error(f"Error persisting to MongoDB: {e}")
            return False

    def _persist_to_postgresql(self, thread_id: str, messages: List[str]) -> bool:
        """Persist conversation to PostgreSQL."""
        try:
            with self.postgres_conn.cursor() as cursor:
                # Check if conversation already exists
                cursor.execute(
                    "SELECT id FROM chat_streams WHERE thread_id = %s", (thread_id,)
                )
                existing_record = cursor.fetchone()

                current_timestamp = datetime.now()
                messages_json = json.dumps(messages)

                if existing_record:
                    # Append new messages to existing conversation
                    cursor.execute(
                        """
                        UPDATE chat_streams
                        SET messages = messages || %s::jsonb, ts = %s
                        WHERE thread_id = %s
                        """,
                        (messages_json, current_timestamp, thread_id),
                    )
                    affected_rows = cursor.rowcount
                    self.postgres_conn.commit()

                    self.logger.info(
                        f"Updated conversation for thread {thread_id}: "
                        f"{affected_rows} rows modified"
                    )
                    return affected_rows > 0
                else:
                    # Create new conversation record
                    conversation_id = uuid.uuid4()
                    cursor.execute(
                        """
                        INSERT INTO chat_streams (id, thread_id, messages, ts) 
                        VALUES (%s, %s, %s, %s)
                        """,
                        (conversation_id, thread_id, messages_json, current_timestamp),
                    )
                    affected_rows = cursor.rowcount
                    self.postgres_conn.commit()

                    self.logger.info(
                        f"Created new conversation with ID: {conversation_id}"
                    )
                    return affected_rows > 0

        except Exception as e:
            self.logger.error(f"Error persisting to PostgreSQL: {e}")
            if self.postgres_conn:
                self.postgres_conn.rollback()
            return False

    def get_conversation_history(self, thread_id: str) -> List[str]:
        """
        Retrieve stored SSE events for a given thread_id.

        Args:
            thread_id: Unique identifier for the conversation thread

        Returns:
            List of SSE event strings (format: "event: {type}\ndata: {json}\n\n")
        """
        if not thread_id or not isinstance(thread_id, str):
            self.logger.warning("Invalid thread_id provided for history retrieval")
            return []

        if not self.checkpoint_saver:
            self.logger.debug("Checkpoint saver is disabled, no history available")
            return []

        try:
            if self.mongo_db is not None:
                return self._retrieve_from_mongodb(thread_id)
            elif self.postgres_conn is not None:
                return self._retrieve_from_postgresql(thread_id)
            else:
                self.logger.warning("No database connection available for history retrieval")
                return []
        except Exception as e:
            self.logger.error(f"Error retrieving conversation history for thread {thread_id}: {e}")
            return []

    def _retrieve_from_postgresql(self, thread_id: str) -> List[str]:
        """Retrieve conversation history from PostgreSQL."""
        try:
            with self.postgres_conn.cursor() as cursor:
                cursor.execute(
                    "SELECT messages FROM chat_streams WHERE thread_id = %s",
                    (thread_id,),
                )
                row = cursor.fetchone()
                if row is None:
                    return []
                messages = row.get("messages", []) if isinstance(row, dict) else row[0]
                if isinstance(messages, str):
                    messages = json.loads(messages)
                return messages if isinstance(messages, list) else []
        except Exception as e:
            self.logger.error(f"Error retrieving from PostgreSQL: {e}")
            return []

    def _retrieve_from_mongodb(self, thread_id: str) -> List[str]:
        """Retrieve conversation history from MongoDB."""
        try:
            collection = self.mongo_db.chat_streams
            document = collection.find_one({"thread_id": thread_id})
            if document is None:
                return []
            messages = document.get("messages", [])
            return messages if isinstance(messages, list) else []
        except Exception as e:
            self.logger.error(f"Error retrieving from MongoDB: {e}")
            return []

    def force_persist(self, thread_id: str) -> bool:
        """
        Force persist all in-memory chunks for a thread_id to the database,
        regardless of finish_reason. Used when a background workflow completes
        so events are saved even if the client disconnected mid-stream.

        Args:
            thread_id: Unique identifier for the conversation thread

        Returns:
            bool: True if persistence was successful, False otherwise
        """
        if not thread_id or not isinstance(thread_id, str):
            self.logger.warning("Invalid thread_id provided for force_persist")
            return False

        if not self.checkpoint_saver:
            self.logger.debug("Checkpoint saver is disabled, skipping force_persist")
            return False

        try:
            store_namespace = ("messages", thread_id)
            cursor = self.store.get(store_namespace, "cursor")
            if cursor is None:
                self.logger.debug(
                    f"No in-memory chunks found for thread {thread_id}"
                )
                return False

            final_index = int(cursor.value.get("index", 0))
            return self._persist_complete_conversation(
                thread_id, store_namespace, final_index
            )
        except Exception as e:
            self.logger.error(
                f"Error in force_persist for thread {thread_id}: {e}"
            )
            return False

    def close(self) -> None:
        """Close database connections."""
        try:
            if self.mongo_client is not None:
                self.mongo_client.close()
                self.logger.info("MongoDB connection closed")
        except Exception as e:
            self.logger.error(f"Error closing MongoDB connection: {e}")

        try:
            if self.postgres_conn is not None:
                self.postgres_conn.close()
                self.logger.info("PostgreSQL connection closed")
        except Exception as e:
            self.logger.error(f"Error closing PostgreSQL connection: {e}")

    def __enter__(self):
        """Context manager entry."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit - close connections."""
        self.close()


# Global instance for backward compatibility
# TODO: Consider using dependency injection instead of global instance
_default_manager = ChatStreamManager(
    checkpoint_saver=get_bool_env("LANGGRAPH_CHECKPOINT_SAVER", False),
    db_uri=get_str_env("LANGGRAPH_CHECKPOINT_DB_URL", "mongodb://localhost:27017"),
)


def chat_stream_message(thread_id: str, message: str, finish_reason: str) -> bool:
    """
    Legacy function wrapper for backward compatibility.

    Args:
        thread_id: Unique identifier for the conversation thread
        message: The message content to store
        finish_reason: Reason for message completion

    Returns:
        bool: True if message was processed successfully
    """
    checkpoint_saver = get_bool_env("LANGGRAPH_CHECKPOINT_SAVER", False)
    if checkpoint_saver:
        return _default_manager.process_stream_message(
            thread_id, message, finish_reason
        )
    else:
        return False


def force_persist_conversation(thread_id: str) -> bool:
    """
    Force persist all in-memory chunks for a thread_id to the database.
    Called by WorkflowManager when a background workflow completes.

    Args:
        thread_id: Unique identifier for the conversation thread

    Returns:
        bool: True if persistence was successful
    """
    return _default_manager.force_persist(thread_id)


def get_chat_stream_history(thread_id: str) -> dict:
    """
    Retrieve chat stream history for a given thread_id.

    Args:
        thread_id: Unique identifier for the conversation thread

    Returns:
        dict with keys: thread_id, messages (list of SSE event strings), available (bool)
    """
    checkpoint_saver = get_bool_env("LANGGRAPH_CHECKPOINT_SAVER", False)
    if not checkpoint_saver:
        return {"thread_id": thread_id, "messages": [], "available": False}

    messages = _default_manager.get_conversation_history(thread_id)
    return {
        "thread_id": thread_id,
        "messages": messages,
        "available": True,
    }
