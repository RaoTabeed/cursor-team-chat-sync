from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import sys
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse


def create_read_only_uri(database_path: Path) -> str:
    """
    Return a SQLite URI that opens the database in read-only mode.
    """
    return f"{database_path.resolve().as_uri()}?mode=ro"


def value_to_text(value: Any) -> str | None:
    """
    Convert a SQLite text or UTF-8 blob value into a Python string.
    """
    if isinstance(value, str):
        return value

    if isinstance(value, bytes):
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError:
            return None

    return None


def parse_json_value(value: Any) -> Any | None:
    """
    Parse a SQLite value as JSON without raising parsing errors.
    """
    text_value = value_to_text(value)

    if text_value is None:
        return None

    try:
        return json.loads(text_value)
    except json.JSONDecodeError:
        return None


def value_byte_length(value: Any) -> int:
    """
    Return the UTF-8 or binary byte length of a SQLite value.
    """
    if value is None:
        return 0

    if isinstance(value, bytes):
        return len(value)

    if isinstance(value, str):
        return len(value.encode("utf-8"))

    return len(str(value).encode("utf-8"))


def file_uri_to_path(uri_value: str) -> str | None:
    """
    Convert a file URI into a local filesystem path.
    """
    try:
        parsed_uri = urlparse(uri_value)
    except ValueError:
        return None

    if parsed_uri.scheme.lower() != "file":
        return None

    decoded_path = unquote(parsed_uri.path)

    if os.name == "nt":
        if parsed_uri.netloc:
            decoded_path = (
                f"//{parsed_uri.netloc}"
                f"{decoded_path}"
            )

        if re.match(r"^/[A-Za-z]:/", decoded_path):
            decoded_path = decoded_path[1:]

        decoded_path = decoded_path.replace("/", "\\")

    return decoded_path


def normalize_local_path(path_value: str) -> str | None:
    """
    Normalize a local path or file URI for reliable comparison.
    """
    cleaned_value = path_value.strip()

    if not cleaned_value:
        return None

    if cleaned_value.lower().startswith("file:"):
        converted_path = file_uri_to_path(cleaned_value)

        if converted_path is None:
            return None

        cleaned_value = converted_path
    else:
        cleaned_value = unquote(cleaned_value)

    if os.name == "nt":
        cleaned_value = cleaned_value.replace("/", "\\")

        if re.match(r"^\\[A-Za-z]:\\", cleaned_value):
            cleaned_value = cleaned_value[1:]

    try:
        absolute_path = os.path.abspath(
            os.path.expanduser(cleaned_value)
        )
    except (OSError, ValueError):
        return None

    return os.path.normcase(
        os.path.normpath(absolute_path)
    )


def add_uri_candidates(
    candidates: list[tuple[str, str]],
    source_name: str,
    uri_value: Any,
) -> None:
    """
    Add path-like values from a Cursor URI object.
    """
    if isinstance(uri_value, str):
        candidates.append(
            (
                source_name,
                uri_value,
            )
        )

        return

    if not isinstance(uri_value, dict):
        return

    for field_name in (
        "fsPath",
        "external",
        "path",
    ):
        field_value = uri_value.get(field_name)

        if isinstance(field_value, str):
            candidates.append(
                (
                    f"{source_name}.{field_name}",
                    field_value,
                )
            )


def get_workspace_candidates(
    composer_header: dict[str, Any],
) -> list[tuple[str, str]]:
    """
    Return every workspace path candidate found in a composer header.
    """
    candidates: list[tuple[str, str]] = []

    workspace_identifier = composer_header.get(
        "workspaceIdentifier"
    )

    if isinstance(workspace_identifier, dict):
        add_uri_candidates(
            candidates,
            "workspaceIdentifier.uri",
            workspace_identifier.get("uri"),
        )

    draft_target = composer_header.get(
        "draftTarget"
    )

    if isinstance(draft_target, dict):
        environment = draft_target.get(
            "environment"
        )

        if isinstance(environment, dict):
            add_uri_candidates(
                candidates,
                "draftTarget.environment.uri",
                environment.get("uri"),
            )

    return candidates


def get_project_match_sources(
    composer_header: dict[str, Any],
    normalized_project_path: str,
) -> list[str]:
    """
    Return the header fields that matched the selected project path.
    """
    match_sources: list[str] = []

    for (
        source_name,
        candidate_value,
    ) in get_workspace_candidates(composer_header):
        normalized_candidate = normalize_local_path(
            candidate_value
        )

        if normalized_candidate == normalized_project_path:
            match_sources.append(source_name)

    return sorted(set(match_sources))


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


def count_keys(
    connection: sqlite3.Connection,
    pattern: str,
) -> int:
    """
    Count cursorDiskKV keys matching the supplied LIKE pattern.
    """
    row = connection.execute(
        """
        SELECT COUNT(*) AS count
        FROM cursorDiskKV
        WHERE typeof(key) = 'text'
          AND key LIKE ?
        """,
        (pattern,),
    ).fetchone()

    if row is None:
        return 0

    return int(row["count"])


def classify_conversation_state_format(
    conversation_state: Any,
) -> str | None:
    """
    Classify the state without returning its actual contents.
    """
    if not isinstance(conversation_state, str):
        return None

    if conversation_state == "~":
        return "empty-marker"

    if conversation_state.startswith("~"):
        return "tilde-prefixed-encoded"

    return "text-or-unknown"


def inspect_composer_data(
    connection: sqlite3.Connection,
    composer_id: str,
) -> dict[str, Any]:
    """
    Return safe metadata for a composerData record.

    The raw conversationState and blobEncryptionKey values are
    intentionally never returned.
    """
    composer_key = f"composerData:{composer_id}"

    row = connection.execute(
        """
        SELECT
            value,
            typeof(value) AS storage_type
        FROM cursorDiskKV
        WHERE key = ?
        LIMIT 1
        """,
        (composer_key,),
    ).fetchone()

    if row is None:
        return {
            "exists": False,
            "storageType": None,
            "byteLength": 0,
            "isJson": False,
            "version": None,
            "createdAt": None,
            "conversationStatePresent": False,
            "conversationStateByteLength": 0,
            "conversationStateSha256": None,
            "conversationStateFormat": None,
            "conversationMapEntryCount": 0,
            "capabilityCount": 0,
            "blobEncryptionKeyPresent": False,
        }

    raw_value = row["value"]

    parsed_value = parse_json_value(raw_value)

    if not isinstance(parsed_value, dict):
        return {
            "exists": True,
            "storageType": str(
                row["storage_type"]
            ),
            "byteLength": value_byte_length(
                raw_value
            ),
            "isJson": False,
            "version": None,
            "createdAt": None,
            "conversationStatePresent": False,
            "conversationStateByteLength": 0,
            "conversationStateSha256": None,
            "conversationStateFormat": None,
            "conversationMapEntryCount": 0,
            "capabilityCount": 0,
            "blobEncryptionKeyPresent": False,
        }

    conversation_map = parsed_value.get(
        "conversationMap"
    )

    capabilities = parsed_value.get(
        "capabilities"
    )

    encryption_key = parsed_value.get(
        "blobEncryptionKey"
    )

    conversation_state = parsed_value.get(
        "conversationState"
    )

    conversation_state_bytes = (
        conversation_state.encode("utf-8")
        if isinstance(conversation_state, str)
        else b""
    )

    conversation_state_present = (
        len(conversation_state_bytes) > 0
    )

    conversation_state_sha256 = (
        hashlib.sha256(
            conversation_state_bytes
        ).hexdigest()
        if conversation_state_present
        else None
    )

    return {
        "exists": True,
        "storageType": str(
            row["storage_type"]
        ),
        "byteLength": value_byte_length(
            raw_value
        ),
        "isJson": True,
        "version": get_number(
            parsed_value.get("_v")
        ),
        "createdAt": get_number(
            parsed_value.get("createdAt")
        ),
        "conversationStatePresent":
            conversation_state_present,
        "conversationStateByteLength":
            len(conversation_state_bytes),
        "conversationStateSha256":
            conversation_state_sha256,
        "conversationStateFormat":
            classify_conversation_state_format(
                conversation_state
            ),
        "conversationMapEntryCount":
            len(conversation_map)
            if isinstance(conversation_map, dict)
            else 0,
        "capabilityCount":
            len(capabilities)
            if isinstance(capabilities, list)
            else 0,
        "blobEncryptionKeyPresent":
            isinstance(encryption_key, str)
            and len(encryption_key) > 0,
    }


def inspect_conversation(
    connection: sqlite3.Connection,
    composer_header: dict[str, Any],
    match_sources: list[str],
) -> dict[str, Any] | None:
    """
    Build metadata for one project conversation.
    """
    composer_id = get_string(
        composer_header.get("composerId")
    )

    if not composer_id:
        return None

    if composer_id == "empty-state-draft":
        return None

    workspace_identifier = composer_header.get(
        "workspaceIdentifier"
    )

    workspace_id: str | None = None

    if isinstance(workspace_identifier, dict):
        workspace_id = get_string(
            workspace_identifier.get("id")
        )

    composer_data = inspect_composer_data(
        connection,
        composer_id,
    )

    bubble_count = count_keys(
        connection,
        f"bubbleId:{composer_id}:%",
    )

    checkpoint_count = count_keys(
        connection,
        f"checkpointId:{composer_id}:%",
    )

    has_meaningful_state = (
        composer_data[
            "conversationStateByteLength"
        ] > 1
    )

    sync_eligible = (
        bubble_count > 0
        or checkpoint_count > 0
        or composer_data[
            "conversationMapEntryCount"
        ] > 0
        or has_meaningful_state
    )

    return {
        "composerId": composer_id,
        "workspaceId": workspace_id,
        "matchSources": match_sources,
        "syncEligible": sync_eligible,
        "createdAt": get_number(
            composer_header.get("createdAt")
        ),
        "lastUpdatedAt": get_number(
            composer_header.get(
                "lastUpdatedAt"
            )
        ),
        "type": get_string(
            composer_header.get("type")
        ),
        "unifiedMode": get_string(
            composer_header.get(
                "unifiedMode"
            )
        ),
        "forceMode": get_string(
            composer_header.get(
                "forceMode"
            )
        ),
        "isArchived": get_boolean(
            composer_header.get(
                "isArchived"
            )
        ),
        "isDraft": get_boolean(
            composer_header.get("isDraft")
        ),
        "isWorktree": get_boolean(
            composer_header.get(
                "isWorktree"
            )
        ),
        "isSpec": get_boolean(
            composer_header.get("isSpec")
        ),
        "isProject": get_boolean(
            composer_header.get(
                "isProject"
            )
        ),
        "hasUnreadMessages": get_boolean(
            composer_header.get(
                "hasUnreadMessages"
            )
        ),
        "numSubComposers": get_number(
            composer_header.get(
                "numSubComposers"
            )
        ),
        "totalLinesAdded": get_number(
            composer_header.get(
                "totalLinesAdded"
            )
        ),
        "totalLinesRemoved": get_number(
            composer_header.get(
                "totalLinesRemoved"
            )
        ),
        "bubbleCount": bubble_count,
        "checkpointCount":
            checkpoint_count,
        "composerData": composer_data,
    }


def get_composer_headers(
    connection: sqlite3.Connection,
) -> list[dict[str, Any]]:
    """
    Load the global Cursor composer header index.
    """
    row = connection.execute(
        """
        SELECT value
        FROM ItemTable
        WHERE key = 'composer.composerHeaders'
        LIMIT 1
        """
    ).fetchone()

    if row is None:
        return []

    parsed_value = parse_json_value(
        row["value"]
    )

    if not isinstance(parsed_value, dict):
        return []

    all_composers = parsed_value.get(
        "allComposers"
    )

    if not isinstance(all_composers, list):
        return []

    return [
        item
        for item in all_composers
        if isinstance(item, dict)
    ]


def inspect_project_conversations(
    database_path_string: str,
    project_path_string: str,
) -> dict[str, Any]:
    """
    Build a metadata-only index for conversations belonging
    to one local project.
    """
    database_path = Path(
        database_path_string
    ).expanduser()

    if not database_path.is_file():
        raise FileNotFoundError(
            "Global Cursor database was not found: "
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
        create_read_only_uri(database_path),
        uri=True,
        timeout=5.0,
    )

    connection.row_factory = sqlite3.Row

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

        for composer_header in composer_headers:
            match_sources = (
                get_project_match_sources(
                    composer_header,
                    normalized_project_path,
                )
            )

            if not match_sources:
                continue

            conversation = (
                inspect_conversation(
                    connection,
                    composer_header,
                    match_sources,
                )
            )

            if conversation is None:
                continue

            composer_id = str(
                conversation["composerId"]
            )

            if composer_id in seen_composer_ids:
                continue

            seen_composer_ids.add(
                composer_id
            )

            conversations.append(
                conversation
            )

        conversations.sort(
            key=lambda item: (
                item.get("lastUpdatedAt")
                or item.get("createdAt")
                or 0
            ),
            reverse=True,
        )

        total_bubbles = sum(
            int(
                conversation[
                    "bubbleCount"
                ]
            )
            for conversation
            in conversations
        )

        total_checkpoints = sum(
            int(
                conversation[
                    "checkpointCount"
                ]
            )
            for conversation
            in conversations
        )

        archived_count = sum(
            1
            for conversation
            in conversations
            if conversation["isArchived"]
        )

        draft_count = sum(
            1
            for conversation
            in conversations
            if conversation["isDraft"]
        )

        unread_count = sum(
            1
            for conversation
            in conversations
            if conversation[
                "hasUnreadMessages"
            ]
        )

        composer_data_count = sum(
            1
            for conversation
            in conversations
            if conversation[
                "composerData"
            ]["exists"]
        )

        sync_eligible_count = sum(
            1
            for conversation
            in conversations
            if conversation[
                "syncEligible"
            ]
        )

        return {
            "ok": True,
            "databasePath": str(
                database_path.resolve()
            ),
            "projectPath": os.path.abspath(
                project_path_string
            ),
            "headersScanned": len(
                composer_headers
            ),
            "matchedConversationCount":
                len(conversations),
            "summary": {
                "activeCount":
                    len(conversations)
                    - archived_count,
                "archivedCount":
                    archived_count,
                "draftCount":
                    draft_count,
                "unreadCount":
                    unread_count,
                "withComposerDataCount":
                    composer_data_count,
                "syncEligibleCount":
                    sync_eligible_count,
                "totalBubbleCount":
                    total_bubbles,
                "totalCheckpointCount":
                    total_checkpoints,
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
                        "Expected a database path "
                        "and project path."
                    ),
                }
            )
        )

        return 2

    try:
        result = inspect_project_conversations(
            sys.argv[1],
            sys.argv[2],
        )

        print(
            json.dumps(
                result,
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