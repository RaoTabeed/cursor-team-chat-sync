from __future__ import annotations

import copy
import json
import os
import re
import sqlite3
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from index_project_conversations import (
    create_read_only_uri,
    get_composer_headers,
    parse_json_value,
)


GLOBAL_HEADERS_KEY = "composer.composerHeaders"
WORKSPACE_COMPOSER_DATA_KEY = "composer.composerData"

IGNORED_COMPOSER_IDS = {
    "",
    "empty-state-draft",
}

COMPOSER_ID_FIELD_NAMES = {
    "composerId",
    "selectedComposerId",
    "lastFocusedComposerId",
    "activeComposerId",
    "currentComposerId",
    "focusedComposerId",
    "openComposerId",
    "agentComposerId",
    "chatComposerId",
}

COMPOSER_ID_LIST_FIELD_NAMES = {
    "composerIds",
    "selectedComposerIds",
    "lastFocusedComposerIds",
    "activeComposerIds",
    "currentComposerIds",
    "focusedComposerIds",
    "openComposerIds",
    "agentComposerIds",
    "chatComposerIds",
}

WORKSPACE_RELEVANT_KEY_TERMS = (
    "composer",
    "agent",
    "chat",
    "ai",
)

UUID_PATTERN = re.compile(
    r"(?i)\b"
    r"[0-9a-f]{8}-"
    r"[0-9a-f]{4}-"
    r"[0-9a-f]{4}-"
    r"[0-9a-f]{4}-"
    r"[0-9a-f]{12}"
    r"\b"
)

HEADER_COPY_FIELDS = (
    "name",
    "title",
    "subtitle",
    "createdAt",
    "lastUpdatedAt",
    "type",
    "unifiedMode",
    "forceMode",
    "isArchived",
    "isDraft",
    "isWorktree",
    "isSpec",
    "isProject",
    "hasUnreadMessages",
    "hasBeenInSidebar",
    "numSubComposers",
    "totalLinesAdded",
    "totalLinesRemoved",
    "draftTarget",
    "workspaceIdentifier",
)


def get_string(
    value: Any,
) -> str | None:
    if not isinstance(
        value,
        str,
    ):
        return None

    cleaned = value.strip()

    return cleaned or None


def get_number(
    value: Any,
) -> int | float | None:
    if isinstance(
        value,
        bool,
    ):
        return None

    if isinstance(
        value,
        (
            int,
            float,
        ),
    ):
        return value

    return None


def normalize_local_path(
    path_value: str,
) -> str | None:
    cleaned_value = path_value.strip()

    if not cleaned_value:
        return None

    if cleaned_value.lower().startswith(
        "file:"
    ):
        try:
            parsed_uri = urlparse(
                cleaned_value
            )
        except ValueError:
            return None

        if parsed_uri.scheme.lower() != "file":
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

        cleaned_value = decoded_path

    else:
        cleaned_value = unquote(
            cleaned_value
        )

    try:
        absolute_path = os.path.abspath(
            os.path.expanduser(
                cleaned_value
            )
        )
    except (
        OSError,
        ValueError,
    ):
        return None

    normalized_path = os.path.normpath(
        absolute_path
    )

    if os.name == "nt":
        normalized_path = os.path.normcase(
            normalized_path
        )

    return normalized_path.rstrip(
        "\\/"
    )


def paths_are_equal(
    first_path: str,
    second_path: str,
) -> bool:
    normalized_first = (
        normalize_local_path(
            first_path
        )
    )

    normalized_second = (
        normalize_local_path(
            second_path
        )
    )

    return (
        normalized_first is not None
        and normalized_second is not None
        and normalized_first
        == normalized_second
    )


def uri_to_local_path(
    uri_value: str,
) -> str | None:
    return normalize_local_path(
        uri_value
    )


def get_cursor_user_directory(
    global_database_path: Path,
) -> Path:
    resolved_path = (
        global_database_path.resolve()
    )

    if (
        resolved_path.name.lower()
        != "state.vscdb"
    ):
        raise ValueError(
            "The global Cursor database path "
            "must end with state.vscdb."
        )

    global_storage_directory = (
        resolved_path.parent
    )

    if (
        global_storage_directory.name.lower()
        != "globalstorage"
    ):
        raise ValueError(
            "The supplied database is not inside "
            "Cursor's globalStorage directory."
        )

    return global_storage_directory.parent


def read_workspace_json(
    workspace_json_path: Path,
) -> dict[str, Any]:
    parsed_value = json.loads(
        workspace_json_path.read_text(
            encoding="utf-8"
        )
    )

    if not isinstance(
        parsed_value,
        dict,
    ):
        raise ValueError(
            "workspace.json must contain "
            "a JSON object."
        )

    return parsed_value


def get_workspace_project_path(
    workspace_json: dict[str, Any],
) -> str | None:
    folder_value = workspace_json.get(
        "folder"
    )

    if isinstance(
        folder_value,
        str,
    ):
        return uri_to_local_path(
            folder_value
        )

    workspace_value = workspace_json.get(
        "workspace"
    )

    if isinstance(
        workspace_value,
        str,
    ):
        return uri_to_local_path(
            workspace_value
        )

    return None


def locate_workspace_database(
    global_database_path: Path,
    project_path: str,
) -> tuple[
    str,
    Path,
]:
    cursor_user_directory = (
        get_cursor_user_directory(
            global_database_path
        )
    )

    workspace_storage_directory = (
        cursor_user_directory
        / "workspaceStorage"
    )

    if not workspace_storage_directory.is_dir():
        raise FileNotFoundError(
            "Cursor workspaceStorage directory "
            "was not found: "
            f"{workspace_storage_directory}"
        )

    matches: list[
        tuple[
            str,
            Path,
        ]
    ] = []

    for workspace_directory in (
        workspace_storage_directory
        .iterdir()
    ):
        if not workspace_directory.is_dir():
            continue

        workspace_json_path = (
            workspace_directory
            / "workspace.json"
        )

        workspace_database_path = (
            workspace_directory
            / "state.vscdb"
        )

        if (
            not workspace_json_path.is_file()
            or not workspace_database_path.is_file()
        ):
            continue

        try:
            workspace_json = (
                read_workspace_json(
                    workspace_json_path
                )
            )

            workspace_project_path = (
                get_workspace_project_path(
                    workspace_json
                )
            )
        except (
            OSError,
            ValueError,
            json.JSONDecodeError,
        ):
            continue

        if (
            workspace_project_path is not None
            and paths_are_equal(
                workspace_project_path,
                project_path,
            )
        ):
            matches.append(
                (
                    workspace_directory.name,
                    workspace_database_path,
                )
            )

    if not matches:
        raise RuntimeError(
            "No Cursor workspace database matched "
            f"the current project: {project_path}. "
            "Open the project in Cursor and create "
            "an Agent conversation."
        )

    if len(matches) > 1:
        matches.sort(
            key=lambda item: (
                item[1]
                .stat()
                .st_mtime
            ),
            reverse=True,
        )

    return matches[0]


def get_composer_id(
    value: Any,
) -> str | None:
    if isinstance(
        value,
        str,
    ):
        cleaned = value.strip()

        if (
            cleaned
            and cleaned
            not in IGNORED_COMPOSER_IDS
        ):
            return cleaned

        return None

    if not isinstance(
        value,
        dict,
    ):
        return None

    composer_id = get_string(
        value.get(
            "composerId"
        )
    )

    if (
        composer_id is None
        or composer_id
        in IGNORED_COMPOSER_IDS
    ):
        return None

    return composer_id


def add_candidate_header(
    headers_by_id:
        dict[str, dict[str, Any]],
    composer_id: str,
    source_value: Any = None,
) -> None:
    cleaned_id = get_composer_id(
        composer_id
    )

    if cleaned_id is None:
        return

    existing_header = (
        headers_by_id.get(
            cleaned_id
        )
    )

    if isinstance(
        source_value,
        dict,
    ):
        candidate_header = {
            "composerId":
                cleaned_id,
        }

        for field_name in (
            HEADER_COPY_FIELDS
        ):
            if field_name in source_value:
                candidate_header[
                    field_name
                ] = copy.deepcopy(
                    source_value[
                        field_name
                    ]
                )

    else:
        candidate_header = {
            "composerId":
                cleaned_id,
        }

    if existing_header is None:
        headers_by_id[
            cleaned_id
        ] = candidate_header

        return

    headers_by_id[
        cleaned_id
    ] = merge_nested_dict(
        existing_header,
        candidate_header,
    )


def collect_ids_from_json_value(
    value: Any,
    headers_by_id:
        dict[str, dict[str, Any]],
    depth: int = 0,
) -> None:
    if depth > 20:
        return

    if isinstance(
        value,
        dict,
    ):
        direct_composer_id = (
            get_composer_id(
                value
            )
        )

        if direct_composer_id is not None:
            add_candidate_header(
                headers_by_id,
                direct_composer_id,
                value,
            )

        for (
            field_name,
            field_value,
        ) in value.items():
            if (
                field_name
                in COMPOSER_ID_FIELD_NAMES
            ):
                composer_id = (
                    get_composer_id(
                        field_value
                    )
                )

                if composer_id is not None:
                    add_candidate_header(
                        headers_by_id,
                        composer_id,
                        value,
                    )

            elif (
                field_name
                in COMPOSER_ID_LIST_FIELD_NAMES
                and isinstance(
                    field_value,
                    list,
                )
            ):
                for item in field_value:
                    composer_id = (
                        get_composer_id(
                            item
                        )
                    )

                    if composer_id is not None:
                        add_candidate_header(
                            headers_by_id,
                            composer_id,
                            (
                                item
                                if isinstance(
                                    item,
                                    dict,
                                )
                                else value
                            ),
                        )

            collect_ids_from_json_value(
                field_value,
                headers_by_id,
                depth + 1,
            )

        return

    if isinstance(
        value,
        list,
    ):
        for item in value:
            collect_ids_from_json_value(
                item,
                headers_by_id,
                depth + 1,
            )


def collect_uuid_candidates_from_text(
    text_value: str,
    headers_by_id:
        dict[str, dict[str, Any]],
) -> None:
    for match in UUID_PATTERN.finditer(
        text_value
    ):
        add_candidate_header(
            headers_by_id,
            match.group(0),
        )


def is_workspace_record_relevant(
    key: str,
) -> bool:
    lowered_key = key.lower()

    return any(
        term in lowered_key
        for term in (
            WORKSPACE_RELEVANT_KEY_TERMS
        )
    )


def load_workspace_candidate_headers(
    workspace_database_path: Path,
) -> tuple[
    list[dict[str, Any]],
    int,
]:
    connection = sqlite3.connect(
        create_read_only_uri(
            workspace_database_path
        ),
        uri=True,
        timeout=10.0,
    )

    connection.row_factory = (
        sqlite3.Row
    )

    headers_by_id: dict[
        str,
        dict[str, Any],
    ] = {}

    relevant_record_count = 0

    try:
        connection.execute(
            "PRAGMA query_only = ON"
        )

        rows = connection.execute(
            """
            SELECT
                key,
                value
            FROM ItemTable
            WHERE typeof(key) = 'text'
            ORDER BY key
            """
        ).fetchall()

        for row in rows:
            key = str(
                row[
                    "key"
                ]
            )

            if not is_workspace_record_relevant(
                key
            ):
                continue

            relevant_record_count += 1

            raw_value = row[
                "value"
            ]

            parsed_value = (
                parse_json_value(
                    raw_value
                )
            )

            if parsed_value is not None:
                collect_ids_from_json_value(
                    parsed_value,
                    headers_by_id,
                )

            text_value: str | None = None

            if isinstance(
                raw_value,
                str,
            ):
                text_value = raw_value

            elif isinstance(
                raw_value,
                bytes,
            ):
                try:
                    text_value = (
                        raw_value.decode(
                            "utf-8"
                        )
                    )
                except UnicodeDecodeError:
                    text_value = None

            if text_value:
                collect_uuid_candidates_from_text(
                    text_value,
                    headers_by_id,
                )

            collect_uuid_candidates_from_text(
                key,
                headers_by_id,
            )

        return (
            list(
                headers_by_id.values()
            ),
            relevant_record_count,
        )

    finally:
        connection.close()


def load_global_headers(
    global_database_path: Path,
) -> list[dict[str, Any]]:
    connection = sqlite3.connect(
        create_read_only_uri(
            global_database_path
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

        return get_composer_headers(
            connection
        )

    finally:
        connection.close()


def global_conversation_record_exists(
    connection: sqlite3.Connection,
    composer_id: str,
) -> bool:
    composer_data_row = (
        connection.execute(
            """
            SELECT 1
            FROM cursorDiskKV
            WHERE key = ?
            LIMIT 1
            """,
            (
                f"composerData:{composer_id}",
            ),
        ).fetchone()
    )

    if composer_data_row is not None:
        return True

    direct_record_row = (
        connection.execute(
            """
            SELECT 1
            FROM cursorDiskKV
            WHERE typeof(key) = 'text'
              AND (
                    key LIKE ?
                 OR key LIKE ?
              )
            LIMIT 1
            """,
            (
                f"bubbleId:{composer_id}:%",
                f"checkpointId:{composer_id}:%",
            ),
        ).fetchone()
    )

    return direct_record_row is not None


def load_global_composer_data_header(
    connection: sqlite3.Connection,
    composer_id: str,
) -> dict[str, Any]:
    row = connection.execute(
        """
        SELECT value
        FROM cursorDiskKV
        WHERE key = ?
        LIMIT 1
        """,
        (
            f"composerData:{composer_id}",
        ),
    ).fetchone()

    if row is None:
        return {
            "composerId":
                composer_id,
        }

    parsed_value = parse_json_value(
        row[
            "value"
        ]
    )

    result: dict[str, Any] = {
        "composerId":
            composer_id,
    }

    if not isinstance(
        parsed_value,
        dict,
    ):
        return result

    for field_name in (
        HEADER_COPY_FIELDS
    ):
        if field_name in parsed_value:
            result[
                field_name
            ] = copy.deepcopy(
                parsed_value[
                    field_name
                ]
            )

    return result


def filter_valid_workspace_headers(
    global_database_path: Path,
    workspace_headers:
        list[dict[str, Any]],
) -> tuple[
    list[dict[str, Any]],
    list[str],
]:
    connection = sqlite3.connect(
        create_read_only_uri(
            global_database_path
        ),
        uri=True,
        timeout=10.0,
    )

    connection.row_factory = (
        sqlite3.Row
    )

    valid_headers: list[
        dict[str, Any]
    ] = []

    rejected_ids: list[str] = []

    try:
        connection.execute(
            "PRAGMA query_only = ON"
        )

        seen_ids: set[str] = set()

        for workspace_header in (
            workspace_headers
        ):
            composer_id = get_composer_id(
                workspace_header
            )

            if (
                composer_id is None
                or composer_id
                in seen_ids
            ):
                continue

            seen_ids.add(
                composer_id
            )

            if not global_conversation_record_exists(
                connection,
                composer_id,
            ):
                rejected_ids.append(
                    composer_id
                )

                continue

            composer_data_header = (
                load_global_composer_data_header(
                    connection,
                    composer_id,
                )
            )

            valid_headers.append(
                merge_nested_dict(
                    composer_data_header,
                    workspace_header,
                )
            )

    finally:
        connection.close()

    return (
        valid_headers,
        rejected_ids,
    )


def project_uri_values(
    project_path: str,
) -> dict[str, str]:
    resolved_path = Path(
        project_path
    ).resolve()

    external_uri = (
        resolved_path.as_uri()
    )

    parsed_uri = urlparse(
        external_uri
    )

    return {
        "fsPath":
            str(
                resolved_path
            ),

        "external":
            external_uri,

        "path":
            parsed_uri.path,
    }


def merge_nested_dict(
    base_value: Any,
    overlay_value: Any,
) -> Any:
    if (
        isinstance(
            base_value,
            dict,
        )
        and isinstance(
            overlay_value,
            dict,
        )
    ):
        result = copy.deepcopy(
            base_value
        )

        for (
            key,
            value,
        ) in overlay_value.items():
            result[
                key
            ] = merge_nested_dict(
                result.get(
                    key
                ),
                value,
            )

        return result

    return copy.deepcopy(
        overlay_value
    )


def prepare_workspace_header(
    header: dict[str, Any],
    composer_id: str,
    workspace_id: str,
    project_path: str,
) -> dict[str, Any]:
    result = copy.deepcopy(
        header
    )

    result[
        "composerId"
    ] = composer_id

    result[
        "type"
    ] = (
        get_string(
            result.get(
                "type"
            )
        )
        or "head"
    )

    result[
        "hasBeenInSidebar"
    ] = True

    result[
        "isArchived"
    ] = bool(
        result.get(
            "isArchived",
            False,
        )
    )

    result[
        "isDraft"
    ] = bool(
        result.get(
            "isDraft",
            False,
        )
    )

    workspace_identifier = (
        result.get(
            "workspaceIdentifier"
        )
    )

    if not isinstance(
        workspace_identifier,
        dict,
    ):
        workspace_identifier = {}

        result[
            "workspaceIdentifier"
        ] = workspace_identifier

    workspace_identifier[
        "id"
    ] = workspace_id

    uri_value = (
        workspace_identifier.get(
            "uri"
        )
    )

    if not isinstance(
        uri_value,
        dict,
    ):
        uri_value = {}

        workspace_identifier[
            "uri"
        ] = uri_value

    uri_value[
        "scheme"
    ] = "file"

    uri_value[
        "authority"
    ] = ""

    for (
        field_name,
        field_value,
    ) in project_uri_values(
        project_path
    ).items():
        uri_value[
            field_name
        ] = field_value

    draft_target = result.get(
        "draftTarget"
    )

    if isinstance(
        draft_target,
        dict,
    ):
        environment = (
            draft_target.get(
                "environment"
            )
        )

        if isinstance(
            environment,
            dict,
        ):
            environment[
                "id"
            ] = workspace_id

            environment_uri = (
                environment.get(
                    "uri"
                )
            )

            if not isinstance(
                environment_uri,
                dict,
            ):
                environment_uri = {}

                environment[
                    "uri"
                ] = environment_uri

            environment_uri[
                "scheme"
            ] = "file"

            environment_uri[
                "authority"
            ] = ""

            for (
                field_name,
                field_value,
            ) in project_uri_values(
                project_path
            ).items():
                environment_uri[
                    field_name
                ] = field_value

    return result


def header_sort_time(
    header: dict[str, Any],
) -> float:
    for field_name in (
        "lastUpdatedAt",
        "createdAt",
    ):
        value = get_number(
            header.get(
                field_name
            )
        )

        if value is not None:
            return float(
                value
            )

    return 0.0


def resolve_project_headers(
    global_database_path_string: str,
    project_path: str,
) -> dict[str, Any]:
    global_database_path = Path(
        global_database_path_string
    ).expanduser()

    if not global_database_path.is_file():
        raise FileNotFoundError(
            "Global Cursor database was not found: "
            f"{global_database_path}"
        )

    (
        workspace_id,
        workspace_database_path,
    ) = locate_workspace_database(
        global_database_path,
        project_path,
    )

    (
        raw_workspace_headers,
        relevant_workspace_record_count,
    ) = load_workspace_candidate_headers(
        workspace_database_path
    )

    (
        workspace_headers,
        rejected_workspace_ids,
    ) = filter_valid_workspace_headers(
        global_database_path,
        raw_workspace_headers,
    )

    if not workspace_headers:
        raise RuntimeError(
            "No complete Cursor Agent conversations "
            "were found for the current workspace. "
            "Create or continue an Agent conversation "
            "and wait until Cursor has saved its "
            "composerData or message records."
        )

    global_headers = (
        load_global_headers(
            global_database_path
        )
    )

    global_headers_by_id: dict[
        str,
        dict[str, Any],
    ] = {}

    for global_header in global_headers:
        composer_id = get_composer_id(
            global_header
        )

        if composer_id is None:
            continue

        global_headers_by_id[
            composer_id
        ] = global_header

    merged_headers: list[
        dict[str, Any]
    ] = []

    workspace_only_ids: list[str] = []

    for workspace_header in workspace_headers:
        composer_id = get_composer_id(
            workspace_header
        )

        if composer_id is None:
            continue

        global_header = (
            global_headers_by_id.get(
                composer_id
            )
        )

        if global_header is None:
            merged_header = copy.deepcopy(
                workspace_header
            )

            workspace_only_ids.append(
                composer_id
            )

        else:
            merged_header = merge_nested_dict(
                global_header,
                workspace_header,
            )

        merged_headers.append(
            prepare_workspace_header(
                merged_header,
                composer_id,
                workspace_id,
                project_path,
            )
        )

    deduplicated_headers: dict[
        str,
        dict[str, Any],
    ] = {}

    for header in merged_headers:
        composer_id = get_composer_id(
            header
        )

        if composer_id is None:
            continue

        existing = (
            deduplicated_headers.get(
                composer_id
            )
        )

        if existing is None:
            deduplicated_headers[
                composer_id
            ] = header

            continue

        deduplicated_headers[
            composer_id
        ] = merge_nested_dict(
            existing,
            header,
        )

    final_headers = list(
        deduplicated_headers.values()
    )

    final_headers.sort(
        key=header_sort_time,
        reverse=True,
    )

    return {
        "workspaceId":
            workspace_id,

        "workspaceDatabasePath":
            str(
                workspace_database_path.resolve()
            ),

        "globalHeaderCount":
            len(
                global_headers
            ),

        "workspaceHeaderCount":
            len(
                raw_workspace_headers
            ),

        "validatedWorkspaceHeaderCount":
            len(
                workspace_headers
            ),

        "resolvedHeaderCount":
            len(
                final_headers
            ),

        "workspaceOnlyComposerIds":
            sorted(
                workspace_only_ids
            ),

        "rejectedWorkspaceComposerIds":
            sorted(
                rejected_workspace_ids
            ),

        "workspaceRelevantRecordCount":
            relevant_workspace_record_count,

        "headers":
            final_headers,
    }