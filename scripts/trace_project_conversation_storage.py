from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse


SHA256_PATTERN = re.compile(
    r"(?i)(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])"
)


def create_read_only_uri(
    database_path: Path,
) -> str:
    return (
        f"{database_path.resolve().as_uri()}"
        "?mode=ro"
    )


def value_to_bytes(
    value: Any,
) -> bytes:
    if value is None:
        return b""

    if isinstance(value, bytes):
        return value

    if isinstance(value, str):
        return value.encode(
            "utf-8",
            errors="replace",
        )

    return str(value).encode(
        "utf-8",
        errors="replace",
    )


def value_to_text(
    value: Any,
) -> str | None:
    if isinstance(value, str):
        return value

    if isinstance(value, bytes):
        try:
            return value.decode(
                "utf-8"
            )
        except UnicodeDecodeError:
            return None

    return None


def parse_json_value(
    value: Any,
) -> Any | None:
    text_value = value_to_text(
        value
    )

    if text_value is None:
        return None

    try:
        return json.loads(
            text_value
        )
    except json.JSONDecodeError:
        return None


def file_uri_to_path(
    uri_value: str,
) -> str | None:
    try:
        parsed_uri = urlparse(
            uri_value
        )
    except ValueError:
        return None

    if (
        parsed_uri.scheme.lower()
        != "file"
    ):
        return None

    decoded_path = unquote(
        parsed_uri.path
    )

    if os.name == "nt":
        if parsed_uri.netloc:
            decoded_path = (
                f"//{parsed_uri.netloc}"
                f"{decoded_path}"
            )

        if re.match(
            r"^/[A-Za-z]:/",
            decoded_path,
        ):
            decoded_path = (
                decoded_path[1:]
            )

        decoded_path = (
            decoded_path.replace(
                "/",
                "\\",
            )
        )

    return decoded_path


def normalize_local_path(
    path_value: str,
) -> str | None:
    cleaned_value = (
        path_value.strip()
    )

    if not cleaned_value:
        return None

    if cleaned_value.lower().startswith(
        "file:"
    ):
        converted_path = (
            file_uri_to_path(
                cleaned_value
            )
        )

        if converted_path is None:
            return None

        cleaned_value = converted_path

    else:
        cleaned_value = unquote(
            cleaned_value
        )

    if os.name == "nt":
        cleaned_value = (
            cleaned_value.replace(
                "/",
                "\\",
            )
        )

        if re.match(
            r"^\\[A-Za-z]:\\",
            cleaned_value,
        ):
            cleaned_value = (
                cleaned_value[1:]
            )

    try:
        absolute_path = os.path.abspath(
            os.path.expanduser(
                cleaned_value
            )
        )
    except (OSError, ValueError):
        return None

    return os.path.normcase(
        os.path.normpath(
            absolute_path
        )
    )


def add_uri_candidates(
    candidates: list[
        tuple[str, str]
    ],
    source_name: str,
    uri_value: Any,
) -> None:
    if isinstance(uri_value, str):
        candidates.append(
            (
                source_name,
                uri_value,
            )
        )

        return

    if not isinstance(
        uri_value,
        dict,
    ):
        return

    for field_name in (
        "fsPath",
        "external",
        "path",
    ):
        field_value = (
            uri_value.get(
                field_name
            )
        )

        if isinstance(
            field_value,
            str,
        ):
            candidates.append(
                (
                    f"{source_name}."
                    f"{field_name}",
                    field_value,
                )
            )


def get_workspace_match_sources(
    composer_header: dict[
        str,
        Any,
    ],
    normalized_project_path: str,
) -> list[str]:
    workspace_identifier = (
        composer_header.get(
            "workspaceIdentifier"
        )
    )

    if not isinstance(
        workspace_identifier,
        dict,
    ):
        return []

    candidates: list[
        tuple[str, str]
    ] = []

    add_uri_candidates(
        candidates,
        "workspaceIdentifier.uri",
        workspace_identifier.get(
            "uri"
        ),
    )

    matches: list[str] = []

    for (
        source_name,
        candidate_value,
    ) in candidates:
        normalized_candidate = (
            normalize_local_path(
                candidate_value
            )
        )

        if (
            normalized_candidate ==
            normalized_project_path
        ):
            matches.append(
                source_name
            )

    return sorted(
        set(matches)
    )


def get_composer_headers(
    connection: sqlite3.Connection,
) -> list[dict[str, Any]]:
    row = connection.execute(
        """
        SELECT value
        FROM ItemTable
        WHERE key =
          'composer.composerHeaders'
        LIMIT 1
        """
    ).fetchone()

    if row is None:
        return []

    parsed_value = parse_json_value(
        row["value"]
    )

    if not isinstance(
        parsed_value,
        dict,
    ):
        return []

    all_composers = (
        parsed_value.get(
            "allComposers"
        )
    )

    if not isinstance(
        all_composers,
        list,
    ):
        return []

    return [
        item
        for item in all_composers
        if isinstance(item, dict)
    ]


def is_sensitive_path(
    path_value: str,
) -> bool:
    lowered_path = (
        path_value.lower()
    )

    sensitive_fragments = (
        "encryptionkey",
        "secret",
        "accesstoken",
        "refreshtoken",
        "password",
        "credential",
    )

    return any(
        fragment in lowered_path
        for fragment
        in sensitive_fragments
    )


def collect_hash_references(
    value: Any,
    path_value: str,
    references:
        dict[str, set[str]],
    embedded_json_paths:
        set[str],
    depth: int = 0,
) -> None:
    if depth > 12:
        return

    if isinstance(value, dict):
        for (
            key,
            child_value,
        ) in value.items():
            child_path = (
                f"{path_value}.{key}"
            )

            collect_hash_references(
                child_value,
                child_path,
                references,
                embedded_json_paths,
                depth + 1,
            )

        return

    if isinstance(value, list):
        for (
            index,
            child_value,
        ) in enumerate(value):
            child_path = (
                f"{path_value}"
                f"[{index}]"
            )

            collect_hash_references(
                child_value,
                child_path,
                references,
                embedded_json_paths,
                depth + 1,
            )

        return

    if not isinstance(value, str):
        return

    if is_sensitive_path(
        path_value
    ):
        return

    for match in (
        SHA256_PATTERN.finditer(
            value
        )
    ):
        digest = (
            match.group(0).lower()
        )

        references.setdefault(
            digest,
            set(),
        ).add(
            path_value
        )

    stripped_value = (
        value.strip()
    )

    if (
        len(stripped_value)
        <= 2_000_000
        and stripped_value.startswith(
            ("{", "[")
        )
    ):
        try:
            parsed_embedded_value = (
                json.loads(
                    stripped_value
                )
            )
        except json.JSONDecodeError:
            return

        embedded_path = (
            f"{path_value}"
            "<embedded-json>"
        )

        embedded_json_paths.add(
            embedded_path
        )

        collect_hash_references(
            parsed_embedded_value,
            embedded_path,
            references,
            embedded_json_paths,
            depth + 1,
        )


def lookup_hash_reference(
    connection: sqlite3.Connection,
    digest: str,
    source_paths: set[str],
) -> dict[str, Any]:
    agent_key = (
        f"agentKv:blob:{digest}"
    )

    composer_content_key = (
        f"composer.content.{digest}"
    )

    rows = connection.execute(
        """
        SELECT
            key,
            typeof(value)
                AS storage_type,
            COALESCE(
                length(value),
                0
            ) AS byte_length
        FROM cursorDiskKV
        WHERE key IN (?, ?)
        ORDER BY key
        """,
        (
            agent_key,
            composer_content_key,
        ),
    ).fetchall()

    targets = [
        {
            "key":
                str(row["key"]),
            "storageType":
                str(
                    row[
                        "storage_type"
                    ]
                ),
            "byteLength":
                int(
                    row[
                        "byte_length"
                    ]
                ),
        }
        for row in rows
    ]

    return {
        "sha256": digest,
        "sourcePaths":
            sorted(source_paths),
        "targets": targets,
    }


def find_keys_containing_composer_id(
    connection: sqlite3.Connection,
    composer_id: str,
) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT
            key,
            typeof(value)
                AS storage_type,
            COALESCE(
                length(value),
                0
            ) AS byte_length
        FROM cursorDiskKV
        WHERE typeof(key) = 'text'
          AND key LIKE ?
        ORDER BY key
        LIMIT 200
        """,
        (
            f"%{composer_id}%",
        ),
    ).fetchall()

    return [
        {
            "key":
                str(row["key"]),
            "storageType":
                str(
                    row[
                        "storage_type"
                    ]
                ),
            "byteLength":
                int(
                    row[
                        "byte_length"
                    ]
                ),
        }
        for row in rows
    ]


def find_values_containing_identifier(
    connection: sqlite3.Connection,
    identifier: str,
) -> list[dict[str, Any]]:
    if not identifier:
        return []

    identifier_bytes = (
        identifier.encode(
            "utf-8"
        )
    )

    rows = connection.execute(
        """
        SELECT
            key,
            value,
            typeof(value)
                AS storage_type
        FROM cursorDiskKV
        WHERE key LIKE
          'agentKv:blob:%'
        ORDER BY key
        """
    ).fetchall()

    matches: list[
        dict[str, Any]
    ] = []

    for row in rows:
        raw_bytes = value_to_bytes(
            row["value"]
        )

        if (
            identifier_bytes
            not in raw_bytes
        ):
            continue

        matches.append(
            {
                "key":
                    str(row["key"]),
                "storageType":
                    str(
                        row[
                            "storage_type"
                        ]
                    ),
                "byteLength":
                    len(raw_bytes),
            }
        )

        if len(matches) >= 50:
            break

    return matches


def inspect_composer_data(
    connection: sqlite3.Connection,
    composer_id: str,
) -> dict[str, Any]:
    composer_key = (
        f"composerData:{composer_id}"
    )

    row = connection.execute(
        """
        SELECT
            value,
            typeof(value)
                AS storage_type
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
            "topLevelFields": [],
            "embeddedJsonPaths": [],
            "hashReferences": [],
        }

    raw_value = row["value"]

    parsed_value = parse_json_value(
        raw_value
    )

    if not isinstance(
        parsed_value,
        dict,
    ):
        return {
            "exists": True,
            "storageType":
                str(
                    row[
                        "storage_type"
                    ]
                ),
            "byteLength":
                len(
                    value_to_bytes(
                        raw_value
                    )
                ),
            "topLevelFields": [],
            "embeddedJsonPaths": [],
            "hashReferences": [],
        }

    references:dict[str, set[str]] = {}

    embedded_json_paths:set[str] = set()

    collect_hash_references(
        parsed_value,
        "$",
        references,
        embedded_json_paths,
    )

    resolved_references = [
        lookup_hash_reference(
            connection,
            digest,
            source_paths,
        )
        for (
            digest,
            source_paths,
        ) in sorted(
            references.items()
        )
    ]

    return {
        "exists": True,
        "storageType":
            str(
                row[
                    "storage_type"
                ]
            ),
        "byteLength":
            len(
                value_to_bytes(
                    raw_value
                )
            ),
        "topLevelFields":
            sorted(
                str(key)
                for key
                in parsed_value.keys()
            ),
        "embeddedJsonPaths":
            sorted(
                embedded_json_paths
            ),
        "hashReferences":
            resolved_references,
    }


def classify_storage_model(
    keys_containing_composer_id:
        list[dict[str, Any]],
    value_mentions:
        list[dict[str, Any]],
    hash_references:
        list[dict[str, Any]],
) -> str:
    has_bubbles = any(
        str(item["key"]).startswith(
            "bubbleId:"
        )
        for item
        in keys_containing_composer_id
    )

    if has_bubbles:
        return (
            "legacy-bubble-records"
        )

    has_agent_targets = any(
        any(
            str(
                target["key"]
            ).startswith(
                "agentKv:blob:"
            )
            for target
            in reference[
                "targets"
            ]
        )
        for reference
        in hash_references
    )

    if (
        has_agent_targets
        or len(value_mentions) > 0
    ):
        return "agent-kv-graph"

    return "unresolved-or-empty"


def inspect_conversation(
    connection: sqlite3.Connection,
    composer_header:
        dict[str, Any],
    match_sources: list[str],
) -> dict[str, Any] | None:
    composer_id = (
        composer_header.get(
            "composerId"
        )
    )

    if not isinstance(
        composer_id,
        str,
    ):
        return None

    if (
        composer_id ==
        "empty-state-draft"
    ):
        return None

    header_id = (
        composer_header.get(
            "id"
        )
    )

    if not isinstance(
        header_id,
        str,
    ):
        header_id = None

    composer_data = (
        inspect_composer_data(
            connection,
            composer_id,
        )
    )

    keys_containing_composer_id = (
        find_keys_containing_composer_id(
            connection,
            composer_id,
        )
    )

    composer_id_mentions = (
        find_values_containing_identifier(
            connection,
            composer_id,
        )
    )

    header_id_mentions = (
        find_values_containing_identifier(
            connection,
            header_id or "",
        )
    )

    header_id_reference = None

    if (
        header_id is not None
        and SHA256_PATTERN.fullmatch(
            header_id
        )
    ):
        header_id_reference = (
            lookup_hash_reference(
                connection,
                header_id.lower(),
                {
                    "$.header.id"
                },
            )
        )

    storage_model = (
        classify_storage_model(
            keys_containing_composer_id,
            composer_id_mentions,
            composer_data[
                "hashReferences"
            ],
        )
    )

    return {
        "composerId":
            composer_id,
        "headerId":
            header_id,
        "headerIdReference":
            header_id_reference,
        "type":
            composer_header.get(
                "type"
            )
            if isinstance(
                composer_header.get(
                    "type"
                ),
                str,
            )
            else None,
        "unifiedMode":
            composer_header.get(
                "unifiedMode"
            )
            if isinstance(
                composer_header.get(
                    "unifiedMode"
                ),
                str,
            )
            else None,
        "matchSources":
            match_sources,
        "storageModel":
            storage_model,
        "composerData":
            composer_data,
        "keysContainingComposerId":
            keys_containing_composer_id,
        "agentBlobsMentioningComposerId":
            composer_id_mentions,
        "agentBlobsMentioningHeaderId":
            header_id_mentions,
    }


def inspect_project_storage(
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

    if (
        normalized_project_path
        is None
    ):
        raise ValueError(
            f"Invalid project path: "
            f"{project_path_string}"
        )

    connection = sqlite3.connect(
        create_read_only_uri(
            database_path
        ),
        uri=True,
        timeout=5.0,
    )

    connection.row_factory = (
        sqlite3.Row
    )

    try:
        connection.execute(
            "PRAGMA query_only = ON"
        )

        conversations: list[
            dict[str, Any]
        ] = []

        for composer_header in (
            get_composer_headers(
                connection
            )
        ):
            match_sources = (
                get_workspace_match_sources(
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

            if conversation is not None:
                conversations.append(
                    conversation
                )

        conversations.sort(
            key=lambda item:
                str(
                    item["composerId"]
                )
        )

        return {
            "ok": True,
            "databasePath":
                str(
                    database_path.resolve()
                ),
            "projectPath":
                os.path.abspath(
                    project_path_string
                ),
            "conversationCount":
                len(conversations),
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
                    "error":
                        "Expected a database path and project path.",
                }
            )
        )

        return 2

    try:
        result = (
            inspect_project_storage(
                sys.argv[1],
                sys.argv[2],
            )
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