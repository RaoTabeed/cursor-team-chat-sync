from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import sys
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from index_project_conversations import (
    create_read_only_uri,
    get_composer_headers,
    get_project_match_sources,
    normalize_local_path,
)


SYSTEM_PLACEHOLDER_IDS = {
    "empty-state-draft",
}

CONTENT_HASH_PATTERN = re.compile(
    rb"(?i)(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])"
)

CONTENT_ADDRESSABLE_PREFIXES = (
    "agentKv:blob:",
    "composer.content.",
)

DATABASE_TABLES = (
    "ItemTable",
    "cursorDiskKV",
)

MAX_REFERENCE_DEPTH = 8


def utc_now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )


def raw_value_to_bytes(value: Any) -> bytes:
    """
    Convert a SQLite value into deterministic bytes for hashing.

    Cursor conversation records are normally stored as TEXT or BLOB.
    """
    if value is None:
        return b""

    if isinstance(value, bytes):
        return value

    if isinstance(value, str):
        return value.encode("utf-8")

    if isinstance(value, bool):
        return b"1" if value else b"0"

    return str(value).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def get_string(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def get_number(
    value: Any,
) -> int | float | None:
    if isinstance(value, bool):
        return None

    if isinstance(value, (int, float)):
        return value

    return None


def get_boolean(value: Any) -> bool:
    return value if isinstance(value, bool) else False


def classify_record_family(key: str) -> str:
    if key.startswith("composerData:"):
        return "composerData"

    if key.startswith("bubbleId:"):
        return "bubbleId"

    if key.startswith("checkpointId:"):
        return "checkpointId"

    if key.startswith(
        "composerVirtualRowHeights:"
    ):
        return "composerVirtualRowHeights"

    if key.startswith("agentKv:blob:"):
        return "agentKvBlob"

    if key.startswith("composer.content."):
        return "composerContent"

    if key == "composer.composerHeaders":
        return "composerHeaders"

    if ":" in key:
        return key.split(":", 1)[0]

    if "." in key:
        return key.split(".", 1)[0]

    return "other"


def record_location(
    table_name: str,
    key: str,
) -> str:
    return f"{table_name}:{key}"


def validate_table_name(
    table_name: str,
) -> None:
    if table_name not in DATABASE_TABLES:
        raise ValueError(
            f"Unsupported table name: {table_name}"
        )


def fetch_records_containing_composer_id(
    connection: sqlite3.Connection,
    table_name: str,
    composer_id: str,
) -> list[sqlite3.Row]:
    """
    Find all rows whose key contains the composer ID.

    This captures known and future Cursor record families without
    requiring every possible prefix to be hard-coded.
    """
    validate_table_name(table_name)

    return connection.execute(
        f"""
        SELECT
            key,
            value,
            typeof(value) AS sqlite_type
        FROM {table_name}
        WHERE typeof(key) = 'text'
          AND key LIKE ?
        ORDER BY key
        """,
        (
            f"%{composer_id}%",
        ),
    ).fetchall()


def fetch_record_by_key(
    connection: sqlite3.Connection,
    table_name: str,
    key: str,
) -> sqlite3.Row | None:
    validate_table_name(table_name)

    return connection.execute(
        f"""
        SELECT
            key,
            value,
            typeof(value) AS sqlite_type
        FROM {table_name}
        WHERE key = ?
        LIMIT 1
        """,
        (key,),
    ).fetchone()


def extract_content_hashes(
    raw_value: Any,
) -> set[str]:
    """
    Discover explicit hexadecimal SHA-256 references.

    We only treat a value as linked content when a matching
    content-addressed database key actually exists.
    """
    raw_bytes = raw_value_to_bytes(
        raw_value
    )

    return {
        match.group(0)
        .decode("ascii")
        .lower()
        for match in CONTENT_HASH_PATTERN.finditer(
            raw_bytes
        )
    }


def candidate_content_keys(
    digest: str,
) -> tuple[str, ...]:
    return tuple(
        f"{prefix}{digest}"
        for prefix in CONTENT_ADDRESSABLE_PREFIXES
    )


def build_header_fragment_metadata(
    composer_header: dict[str, Any],
    composer_id: str,
) -> dict[str, Any]:
    """
    Inventory only this conversation's header object.

    The complete composer.composerHeaders row is not included because
    that row may contain conversations from unrelated projects.
    """
    canonical_json = json.dumps(
        composer_header,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )

    raw_bytes = canonical_json.encode(
        "utf-8"
    )

    return {
        "recordKind":
            "header-fragment",
        "tableName":
            "ItemTable",
        "key":
            "composer.composerHeaders",
        "selector":
            f"composerId={composer_id}",
        "recordFamily":
            "composerHeaders",
        "sqliteType":
            "json-fragment",
        "byteLength":
            len(raw_bytes),
        "sha256":
            sha256_bytes(raw_bytes),
        "source":
            "project-header-fragment",
        "referenceDepth":
            0,
        "referencedBy":
            [],
    }


def add_record_state(
    record_states: dict[
        tuple[str, str],
        dict[str, Any],
    ],
    pending_records: deque[
        tuple[str, str]
    ],
    table_name: str,
    key: str,
    sqlite_type: str,
    raw_value: Any,
    source: str,
    reference_depth: int,
    referenced_by: str | None,
) -> None:
    identity = (
        table_name,
        key,
    )

    existing_state = record_states.get(
        identity
    )

    if existing_state is not None:
        existing_state[
            "referenceDepth"
        ] = min(
            int(
                existing_state[
                    "referenceDepth"
                ]
            ),
            reference_depth,
        )

        if referenced_by is not None:
            existing_state[
                "referencedBy"
            ].add(
                referenced_by
            )

        if source == "direct-composer-id-key":
            existing_state["source"] = source

        return

    record_states[identity] = {
        "tableName":
            table_name,
        "key":
            key,
        "sqliteType":
            sqlite_type,
        "rawValue":
            raw_value,
        "source":
            source,
        "referenceDepth":
            reference_depth,
        "referencedBy":
            {
                referenced_by
            }
            if referenced_by is not None
            else set(),
    }

    pending_records.append(
        identity
    )


def discover_conversation_records(
    connection: sqlite3.Connection,
    composer_id: str,
) -> tuple[
    list[dict[str, Any]],
    list[dict[str, Any]],
]:
    """
    Inventory direct records and recursively follow explicit
    content-addressed SHA-256 references.
    """
    record_states: dict[
        tuple[str, str],
        dict[str, Any],
    ] = {}

    pending_records: deque[
        tuple[str, str]
    ] = deque()

    unresolved_references: dict[
        str,
        set[str],
    ] = {}

    for table_name in DATABASE_TABLES:
        rows = (
            fetch_records_containing_composer_id(
                connection,
                table_name,
                composer_id,
            )
        )

        for row in rows:
            add_record_state(
                record_states,
                pending_records,
                table_name,
                str(row["key"]),
                str(row["sqlite_type"]),
                row["value"],
                "direct-composer-id-key",
                0,
                None,
            )

    while pending_records:
        current_identity = (
            pending_records.popleft()
        )

        current_state = (
            record_states[
                current_identity
            ]
        )

        current_depth = int(
            current_state[
                "referenceDepth"
            ]
        )

        if (
            current_depth >=
            MAX_REFERENCE_DEPTH
        ):
            continue

        current_location = (
            record_location(
                str(
                    current_state[
                        "tableName"
                    ]
                ),
                str(
                    current_state[
                        "key"
                    ]
                ),
            )
        )

        discovered_hashes = (
            extract_content_hashes(
                current_state[
                    "rawValue"
                ]
            )
        )

        for digest in discovered_hashes:
            target_found = False

            for target_key in (
                candidate_content_keys(
                    digest
                )
            ):
                for table_name in (
                    DATABASE_TABLES
                ):
                    target_row = (
                        fetch_record_by_key(
                            connection,
                            table_name,
                            target_key,
                        )
                    )

                    if target_row is None:
                        continue

                    target_found = True

                    add_record_state(
                        record_states,
                        pending_records,
                        table_name,
                        str(
                            target_row[
                                "key"
                            ]
                        ),
                        str(
                            target_row[
                                "sqlite_type"
                            ]
                        ),
                        target_row["value"],
                        (
                            "content-addressed-"
                            "reference"
                        ),
                        current_depth + 1,
                        current_location,
                    )

            if not target_found:
                unresolved_references.setdefault(
                    digest,
                    set(),
                ).add(
                    current_location
                )

    records: list[
        dict[str, Any]
    ] = []

    for state in record_states.values():
        raw_bytes = raw_value_to_bytes(
            state["rawValue"]
        )

        records.append(
            {
                "recordKind":
                    "sqlite-record",
                "tableName":
                    state["tableName"],
                "key":
                    state["key"],
                "recordFamily":
                    classify_record_family(
                        str(state["key"])
                    ),
                "sqliteType":
                    state["sqliteType"],
                "byteLength":
                    len(raw_bytes),
                "sha256":
                    sha256_bytes(
                        raw_bytes
                    ),
                "source":
                    state["source"],
                "referenceDepth":
                    state[
                        "referenceDepth"
                    ],
                "referencedBy":
                    sorted(
                        state[
                            "referencedBy"
                        ]
                    ),
            }
        )

    records.sort(
        key=lambda item: (
            int(
                item[
                    "referenceDepth"
                ]
            ),
            str(
                item[
                    "recordFamily"
                ]
            ),
            str(item["key"]),
        )
    )

    unresolved = [
        {
            "sha256":
                digest,
            "referencedBy":
                sorted(
                    reference_sources
                ),
        }
        for (
            digest,
            reference_sources,
        ) in sorted(
            unresolved_references.items()
        )
    ]

    return (
        records,
        unresolved,
    )


def build_conversation_manifest(
    connection: sqlite3.Connection,
    composer_header: dict[str, Any],
    match_sources: list[str],
) -> dict[str, Any] | None:
    composer_id = get_string(
        composer_header.get(
            "composerId"
        )
    )

    if not composer_id:
        return None

    if composer_id in SYSTEM_PLACEHOLDER_IDS:
        return None

    (
        records,
        unresolved_hash_references,
    ) = discover_conversation_records(
        connection,
        composer_id,
    )

    header_fragment = (
        build_header_fragment_metadata(
            composer_header,
            composer_id,
        )
    )

    direct_record_count = sum(
        1
        for record in records
        if record["source"]
        == "direct-composer-id-key"
    )

    referenced_record_count = (
        len(records)
        - direct_record_count
    )

    records_byte_length = sum(
        int(record["byteLength"])
        for record in records
    )

    total_byte_length = (
        records_byte_length
        + int(
            header_fragment[
                "byteLength"
            ]
        )
    )

    return {
        "composerId":
            composer_id,
        "shouldUpload":
            True,
        "isSystemPlaceholder":
            False,
        "matchSources":
            match_sources,
        "createdAt":
            get_number(
                composer_header.get(
                    "createdAt"
                )
            ),
        "lastUpdatedAt":
            get_number(
                composer_header.get(
                    "lastUpdatedAt"
                )
            ),
        "type":
            get_string(
                composer_header.get(
                    "type"
                )
            ),
        "unifiedMode":
            get_string(
                composer_header.get(
                    "unifiedMode"
                )
            ),
        "forceMode":
            get_string(
                composer_header.get(
                    "forceMode"
                )
            ),
        "isArchived":
            get_boolean(
                composer_header.get(
                    "isArchived"
                )
            ),
        "isDraft":
            get_boolean(
                composer_header.get(
                    "isDraft"
                )
            ),
        "isWorktree":
            get_boolean(
                composer_header.get(
                    "isWorktree"
                )
            ),
        "directRecordCount":
            direct_record_count,
        "referencedRecordCount":
            referenced_record_count,
        "totalRecordCount":
            len(records) + 1,
        "totalByteLength":
            total_byte_length,
        "unresolvedHashReferenceCount":
            len(
                unresolved_hash_references
            ),
        "headerFragment":
            header_fragment,
        "records":
            records,
        "unresolvedHashReferences":
            unresolved_hash_references,
    }


def build_project_manifest(
    database_path_string: str,
    project_path_string: str,
) -> dict[str, Any]:
    database_path = Path(
        database_path_string
    ).expanduser()

    if not database_path.is_file():
        raise FileNotFoundError(
            "Global Cursor database "
            f"was not found: "
            f"{database_path}"
        )

    normalized_project_path = (
        normalize_local_path(
            project_path_string
        )
    )

    if normalized_project_path is None:
        raise ValueError(
            "Invalid project path: "
            f"{project_path_string}"
        )

    connection = sqlite3.connect(
        create_read_only_uri(
            database_path
        ),
        uri=True,
        timeout=10.0,
    )

    connection.row_factory = (
        sqlite3.Row
    )

    try:
        connection.execute(
            "PRAGMA query_only = ON"
        )

        composer_headers = (
            get_composer_headers(
                connection
            )
        )

        conversations: list[
            dict[str, Any]
        ] = []

        seen_composer_ids: set[str] = set()

        matched_header_count = 0
        system_placeholder_count = 0

        for composer_header in (
            composer_headers
        ):
            match_sources = (
                get_project_match_sources(
                    composer_header,
                    normalized_project_path,
                )
            )

            if not match_sources:
                continue

            matched_header_count += 1

            composer_id = get_string(
                composer_header.get(
                    "composerId"
                )
            )

            if (
                composer_id in
                SYSTEM_PLACEHOLDER_IDS
            ):
                system_placeholder_count += 1
                continue

            conversation = (
                build_conversation_manifest(
                    connection,
                    composer_header,
                    match_sources,
                )
            )

            if conversation is None:
                continue

            resolved_composer_id = str(
                conversation[
                    "composerId"
                ]
            )

            if (
                resolved_composer_id in
                seen_composer_ids
            ):
                continue

            seen_composer_ids.add(
                resolved_composer_id
            )

            conversations.append(
                conversation
            )

        conversations.sort(
            key=lambda item: (
                item.get(
                    "lastUpdatedAt"
                )
                or item.get(
                    "createdAt"
                )
                or 0
            ),
            reverse=True,
        )

        total_record_count = sum(
            int(
                conversation[
                    "totalRecordCount"
                ]
            )
            for conversation
            in conversations
        )

        total_byte_length = sum(
            int(
                conversation[
                    "totalByteLength"
                ]
            )
            for conversation
            in conversations
        )

        unresolved_hash_count = sum(
            int(
                conversation[
                    "unresolvedHashReferenceCount"
                ]
            )
            for conversation
            in conversations
        )

        return {
            "ok":
                True,
            "manifestVersion":
                1,
            "generatedAt":
                utc_now_iso(),
            "databasePath":
                str(
                    database_path.resolve()
                ),
            "projectPath":
                os.path.abspath(
                    project_path_string
                ),
            "headersScanned":
                len(composer_headers),
            "matchedHeaderCount":
                matched_header_count,
            "summary": {
                "conversationCount":
                    len(conversations),
                "uploadCandidateCount":
                    len(conversations),
                "systemPlaceholderCount":
                    system_placeholder_count,
                "totalRecordCount":
                    total_record_count,
                "totalByteLength":
                    total_byte_length,
                "unresolvedHashReferenceCount":
                    unresolved_hash_count,
            },
            "conversations":
                conversations,
        }

    finally:
        connection.close()


def main() -> int:
    if len(sys.argv) != 3:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": (
                        "Expected a database "
                        "path and project path."
                    ),
                }
            )
        )

        return 2

    try:
        manifest = (
            build_project_manifest(
                sys.argv[1],
                sys.argv[2],
            )
        )

        print(
            json.dumps(
                manifest,
                ensure_ascii=False,
            )
        )

        return 0

    except Exception as error:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": str(error),
                },
                ensure_ascii=False,
            )
        )

        return 1


if __name__ == "__main__":
    raise SystemExit(main())