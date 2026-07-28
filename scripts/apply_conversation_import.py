from __future__ import annotations

import copy
import csv
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from build_conversation_bundle_manifest import DATABASE_TABLES
from index_project_conversations import (
    create_read_only_uri,
    get_composer_headers,
    parse_json_value,
)
from validate_conversation_bundle import (
    get_string,
    normalize_sqlite_blob,
    read_bundle_manifest,
    validate_bundle,
    validate_payload_entry,
)


JOB_VERSION = 4
RESULT_VERSION = 3
DEFAULT_WAIT_TIMEOUT_SECONDS = 300
GLOBAL_HEADERS_KEY = "composer.composerHeaders"
WORKSPACE_COMPOSER_DATA_KEY = "composer.composerData"


def utc_now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )


def safe_timestamp() -> str:
    return datetime.now(
        timezone.utc
    ).strftime(
        "%Y-%m-%dT%H-%M-%S-%fZ"
    )


def sha256_file(
    file_path: Path,
) -> str:
    digest = hashlib.sha256()

    with file_path.open(
        "rb"
    ) as file:
        while True:
            chunk = file.read(
                1024 * 1024
            )

            if not chunk:
                break

            digest.update(
                chunk
            )

    return digest.hexdigest()


def write_json_atomic(
    destination_path: Path,
    value: dict[str, Any],
) -> None:
    destination_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    temporary_path = (
        destination_path.parent
        / (
            f".{destination_path.name}."
            f"tmp-{os.getpid()}-"
            f"{uuid.uuid4().hex}"
        )
    )

    temporary_path.write_text(
        json.dumps(
            value,
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    os.replace(
        temporary_path,
        destination_path,
    )


def load_job(
    job_path: Path,
) -> dict[str, Any]:
    parsed_value = json.loads(
        job_path.read_text(
            encoding="utf-8"
        )
    )

    if not isinstance(
        parsed_value,
        dict,
    ):
        raise ValueError(
            "The import job must be a JSON object."
        )

    if (
        parsed_value.get(
            "version"
        )
        != JOB_VERSION
    ):
        raise ValueError(
            "The import job version is not supported. "
            f"Expected {JOB_VERSION}."
        )

    return parsed_value


def is_process_running_windows(
    process_id: int,
) -> bool:
    completed_process = subprocess.run(
        [
            "tasklist",
            "/FI",
            f"PID eq {process_id}",
            "/FO",
            "CSV",
            "/NH",
        ],
        capture_output=True,
        text=True,
        check=False,
        creationflags=(
            subprocess.CREATE_NO_WINDOW
            if hasattr(
                subprocess,
                "CREATE_NO_WINDOW",
            )
            else 0
        ),
    )

    if (
        completed_process.returncode
        != 0
    ):
        return True

    for row in csv.reader(
        completed_process.stdout
        .splitlines()
    ):
        if len(row) < 2:
            continue

        raw_process_id = (
            row[1].strip()
        )

        if (
            raw_process_id.isdigit()
            and int(
                raw_process_id
            )
            == process_id
        ):
            return True

    return False


def is_process_running_unix(
    process_id: int,
) -> bool:
    try:
        os.kill(
            process_id,
            0,
        )

    except ProcessLookupError:
        return False

    except PermissionError:
        return True

    return True


def is_process_running(
    process_id: int,
) -> bool:
    if process_id <= 0:
        return False

    if os.name == "nt":
        return (
            is_process_running_windows(
                process_id
            )
        )

    return is_process_running_unix(
        process_id
    )


def wait_for_process_to_exit(
    process_id: int,
    timeout_seconds: int,
) -> None:
    deadline = (
        time.monotonic()
        + timeout_seconds
    )

    while is_process_running(
        process_id
    ):
        if (
            time.monotonic()
            >= deadline
        ):
            raise TimeoutError(
                "The Cursor extension host did not close "
                "before the import timeout expired."
            )

        time.sleep(
            0.5
        )

    time.sleep(
        1.0
    )


def can_acquire_database_write_lock(
    database_path: Path,
) -> bool:
    connection: (
        sqlite3.Connection
        | None
    ) = None

    try:
        connection = sqlite3.connect(
            database_path,
            timeout=1.0,
            isolation_level=None,
        )

        connection.execute(
            "PRAGMA busy_timeout = 1000"
        )

        connection.execute(
            "BEGIN IMMEDIATE"
        )

        connection.execute(
            "ROLLBACK"
        )

        return True

    except sqlite3.OperationalError as error:
        if (
            connection is not None
            and connection.in_transaction
        ):
            try:
                connection.execute(
                    "ROLLBACK"
                )

            except sqlite3.Error:
                pass

        message = str(
            error
        ).lower()

        if (
            "locked" in message
            or "busy" in message
        ):
            return False

        raise

    finally:
        if connection is not None:
            connection.close()


def wait_for_database_write_access(
    database_paths: list[Path],
    timeout_seconds: int,
) -> None:
    deadline = (
        time.monotonic()
        + timeout_seconds
    )

    while True:
        unavailable = [
            database_path
            for database_path
            in database_paths
            if not can_acquire_database_write_lock(
                database_path
            )
        ]

        if not unavailable:
            time.sleep(
                0.5
            )

            return

        if (
            time.monotonic()
            >= deadline
        ):
            rendered_paths = ", ".join(
                str(path)
                for path in unavailable
            )

            raise TimeoutError(
                "The Cursor databases did not become "
                "writable before the import timeout "
                f"expired: {rendered_paths}"
            )

        time.sleep(
            0.5
        )


def validate_table_name(
    table_name: str,
) -> None:
    if (
        table_name
        not in DATABASE_TABLES
    ):
        raise ValueError(
            "Unsupported SQLite table: "
            f"{table_name}"
        )


def get_existing_database_tables(
    connection: sqlite3.Connection,
) -> set[str]:
    rows = connection.execute(
        """
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
        """
    ).fetchall()

    return {
        str(
            row[0]
        )
        for row in rows
    }


def ensure_database_tables(
    connection: sqlite3.Connection,
    required_tables: set[str],
) -> None:
    missing_tables = (
        required_tables
        - get_existing_database_tables(
            connection
        )
    )

    if missing_tables:
        raise RuntimeError(
            "The destination Cursor database is "
            "missing required tables: "
            + ", ".join(
                sorted(
                    missing_tables
                )
            )
        )


def get_fingerprint_tables(
    connection: sqlite3.Connection,
) -> list[str]:
    existing_tables = (
        get_existing_database_tables(
            connection
        )
    )

    table_names = sorted(
        table_name
        for table_name
        in DATABASE_TABLES
        if table_name
        in existing_tables
    )

    if (
        "ItemTable"
        not in table_names
    ):
        raise RuntimeError(
            "The Cursor database does not "
            "contain ItemTable."
        )

    return table_names


def verify_database_integrity(
    connection: sqlite3.Connection,
    database_label: str,
) -> None:
    results = [
        str(
            row[0]
        )
        for row in connection.execute(
            "PRAGMA integrity_check"
        ).fetchall()
    ]

    if (
        len(results) != 1
        or results[0].lower()
        != "ok"
    ):
        details = (
            "; ".join(
                results
            )
            or "No result returned."
        )

        raise RuntimeError(
            f"The {database_label} database failed "
            "SQLite integrity verification: "
            f"{details}"
        )


def update_fingerprint(
    digest: Any,
    value: bytes,
) -> None:
    digest.update(
        len(value).to_bytes(
            8,
            byteorder="big",
            signed=False,
        )
    )

    digest.update(
        value
    )


def database_content_fingerprint(
    connection: sqlite3.Connection,
) -> dict[str, Any]:
    digest = hashlib.sha256()

    total_row_count = 0

    table_row_counts: dict[
        str,
        int,
    ] = {}

    table_names = (
        get_fingerprint_tables(
            connection
        )
    )

    for table_name in table_names:
        validate_table_name(
            table_name
        )

        rows = connection.execute(
            f"""
            SELECT
                key,
                typeof(value) AS sqlite_type,
                CAST(value AS BLOB) AS raw_value
            FROM {table_name}
            ORDER BY key
            """
        ).fetchall()

        table_row_count = 0

        update_fingerprint(
            digest,
            table_name.encode(
                "utf-8"
            ),
        )

        for (
            key,
            sqlite_type,
            raw_value,
        ) in rows:
            payload = (
                b""
                if raw_value
                is None
                else normalize_sqlite_blob(
                    raw_value
                )
            )

            update_fingerprint(
                digest,
                str(
                    key
                ).encode(
                    "utf-8"
                ),
            )

            update_fingerprint(
                digest,
                str(
                    sqlite_type
                ).encode(
                    "ascii"
                ),
            )

            update_fingerprint(
                digest,
                payload,
            )

            table_row_count += 1

            total_row_count += 1

        table_row_counts[
            table_name
        ] = table_row_count

    return {
        "sha256":
            digest.hexdigest(),

        "rowCount":
            total_row_count,

        "tableNames":
            table_names,

        "tableRowCounts":
            table_row_counts,
    }


def create_verified_database_backup(
    source_database_path: Path,
    backup_database_path: Path,
    database_label: str,
) -> dict[str, Any]:
    source_connection: (
        sqlite3.Connection
        | None
    ) = None

    backup_connection: (
        sqlite3.Connection
        | None
    ) = None

    try:
        source_connection = sqlite3.connect(
            create_read_only_uri(
                source_database_path
            ),
            uri=True,
            timeout=30.0,
        )

        backup_connection = sqlite3.connect(
            backup_database_path,
            timeout=30.0,
        )

        source_connection.execute(
            "PRAGMA busy_timeout = 30000"
        )

        backup_connection.execute(
            "PRAGMA busy_timeout = 30000"
        )

        verify_database_integrity(
            source_connection,
            f"source {database_label}",
        )

        source_connection.backup(
            backup_connection
        )

        backup_connection.commit()

        verify_database_integrity(
            backup_connection,
            f"backup {database_label}",
        )

        source_fingerprint = (
            database_content_fingerprint(
                source_connection
            )
        )

        backup_fingerprint = (
            database_content_fingerprint(
                backup_connection
            )
        )

    finally:
        if (
            backup_connection
            is not None
        ):
            backup_connection.close()

        if (
            source_connection
            is not None
        ):
            source_connection.close()

    if (
        source_fingerprint
        != backup_fingerprint
    ):
        raise RuntimeError(
            f"The {database_label} database backup "
            "failed logical content verification."
        )

    return {
        "sourceDatabasePath":
            str(
                source_database_path.resolve()
            ),

        "backupDatabasePath":
            str(
                backup_database_path.resolve()
            ),

        "sourceDatabaseFileSha256":
            sha256_file(
                source_database_path
            ),

        "backupDatabaseFileSha256":
            sha256_file(
                backup_database_path
            ),

        "contentFingerprint":
            source_fingerprint,

        "verified":
            True,
    }


def create_backup_directory(
    global_database_path: Path,
    workspace_database_path: Path,
    backup_root: Path,
    job_id: str,
) -> tuple[
    Path,
    Path,
    Path,
]:
    backup_directory = (
        backup_root
        / (
            f"{safe_timestamp()}-"
            f"{job_id}"
        )
    )

    backup_directory.mkdir(
        parents=True,
        exist_ok=False,
    )

    global_backup_path = (
        backup_directory
        / "global-state.vscdb"
    )

    workspace_backup_path = (
        backup_directory
        / "workspace-state.vscdb"
    )

    global_metadata = (
        create_verified_database_backup(
            global_database_path,
            global_backup_path,
            "global Cursor",
        )
    )

    workspace_metadata = (
        create_verified_database_backup(
            workspace_database_path,
            workspace_backup_path,
            "workspace Cursor",
        )
    )

    write_json_atomic(
        backup_directory
        / "backup-metadata.json",
        {
            "version":
                4,

            "createdAt":
                utc_now_iso(),

            "jobId":
                job_id,

            "verified":
                True,

            "globalDatabase":
                global_metadata,

            "workspaceDatabase":
                workspace_metadata,
        },
    )

    return (
        backup_directory,
        global_backup_path,
        workspace_backup_path,
    )


def remove_sqlite_sidecars(
    database_path: Path,
) -> None:
    for suffix in (
        "-wal",
        "-shm",
    ):
        Path(
            f"{database_path}{suffix}"
        ).unlink(
            missing_ok=True
        )


def restore_database(
    backup_database_path: Path,
    destination_database_path: Path,
) -> None:
    remove_sqlite_sidecars(
        destination_database_path
    )

    temporary_restore_path = Path(
        (
            f"{destination_database_path}"
            f".restore-{uuid.uuid4().hex}"
        )
    )

    shutil.copy2(
        backup_database_path,
        temporary_restore_path,
    )

    os.replace(
        temporary_restore_path,
        destination_database_path,
    )


def destination_uri_values(
    destination_project_path: str,
) -> dict[str, str]:
    resolved_path = Path(
        destination_project_path
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


def remap_uri_object(
    value: Any,
    destination_project_path: str,
) -> None:
    if not isinstance(
        value,
        dict,
    ):
        return

    value[
        "scheme"
    ] = "file"

    if (
        "authority"
        in value
    ):
        value[
            "authority"
        ] = ""

    for (
        field_name,
        field_value,
    ) in destination_uri_values(
        destination_project_path
    ).items():
        value[
            field_name
        ] = field_value


def prepare_imported_header(
    original_header: dict[str, Any],
    destination_project_path: str,
    destination_workspace_id: str,
) -> dict[str, Any]:
    header = copy.deepcopy(
        original_header
    )

    header[
        "type"
    ] = "head"

    header[
        "hasBeenInSidebar"
    ] = True

    header[
        "isArchived"
    ] = False

    header[
        "isDraft"
    ] = False

    workspace_identifier = (
        header.get(
            "workspaceIdentifier"
        )
    )

    if not isinstance(
        workspace_identifier,
        dict,
    ):
        workspace_identifier = {}

        header[
            "workspaceIdentifier"
        ] = workspace_identifier

    workspace_identifier[
        "id"
    ] = destination_workspace_id

    workspace_uri = (
        workspace_identifier.get(
            "uri"
        )
    )

    if not isinstance(
        workspace_uri,
        dict,
    ):
        workspace_uri = {}

        workspace_identifier[
            "uri"
        ] = workspace_uri

    remap_uri_object(
        workspace_uri,
        destination_project_path,
    )

    draft_target = (
        header.get(
            "draftTarget"
        )
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
            ] = destination_workspace_id

            environment_uri = (
                environment.get(
                    "uri"
                )
            )

            if isinstance(
                environment_uri,
                dict,
            ):
                remap_uri_object(
                    environment_uri,
                    destination_project_path,
                )

    return header


def get_composer_id(
    header: Any,
) -> str | None:
    if not isinstance(
        header,
        dict,
    ):
        return None

    composer_id = get_string(
        header.get(
            "composerId"
        )
    )

    if not composer_id:
        return None

    cleaned = composer_id.strip()

    if (
        not cleaned
        or cleaned
        == "empty-state-draft"
    ):
        return None

    return cleaned


def get_header_time(
    header: dict[str, Any],
) -> float:
    for field_name in (
        "lastUpdatedAt",
        "createdAt",
    ):
        value = header.get(
            field_name
        )

        if (
            isinstance(
                value,
                (
                    int,
                    float,
                ),
            )
            and not isinstance(
                value,
                bool,
            )
        ):
            return float(
                value
            )

    return 0.0


def get_workspace_id(
    header: dict[str, Any],
) -> str | None:
    workspace_identifier = (
        header.get(
            "workspaceIdentifier"
        )
    )

    if not isinstance(
        workspace_identifier,
        dict,
    ):
        return None

    return get_string(
        workspace_identifier.get(
            "id"
        )
    )


def deduplicate_strings(
    values: list[Any],
) -> list[str]:
    result: list[str] = []

    seen: set[str] = set()

    for value in values:
        if not isinstance(
            value,
            str,
        ):
            continue

        cleaned = value.strip()

        if (
            not cleaned
            or cleaned in seen
        ):
            continue

        seen.add(
            cleaned
        )

        result.append(
            cleaned
        )

    return result


def read_payload(
    archive: zipfile.ZipFile,
    payload_entry: dict[str, Any],
) -> bytes:
    validation_result = (
        validate_payload_entry(
            archive,
            payload_entry,
        )
    )

    return archive.read(
        str(
            validation_result[
                "payloadPath"
            ]
        )
    )


def sqlite_value_from_payload(
    sqlite_type: str,
    payload: bytes,
) -> Any:
    if (
        sqlite_type
        == "text"
    ):
        return payload.decode(
            "utf-8"
        )

    if (
        sqlite_type
        == "blob"
    ):
        return sqlite3.Binary(
            payload
        )

    if (
        sqlite_type
        == "integer"
    ):
        return int(
            payload.decode(
                "ascii"
            )
        )

    if (
        sqlite_type
        == "real"
    ):
        return float(
            payload.decode(
                "ascii"
            )
        )

    if (
        sqlite_type
        == "null"
    ):
        return None

    raise ValueError(
        "Unsupported SQLite value type "
        f"in import bundle: {sqlite_type}"
    )


def fetch_existing_record(
    connection: sqlite3.Connection,
    table_name: str,
    key: str,
) -> sqlite3.Row | None:
    validate_table_name(
        table_name
    )

    return connection.execute(
        f"""
        SELECT
            typeof(value) AS sqlite_type,
            CAST(value AS BLOB) AS raw_value
        FROM {table_name}
        WHERE key = ?
        LIMIT 1
        """,
        (
            key,
        ),
    ).fetchone()


def verify_existing_record(
    existing_row: sqlite3.Row,
    expected_sqlite_type: str,
    expected_payload: bytes,
) -> bool:
    return (
        str(
            existing_row[
                "sqlite_type"
            ]
        )
        == expected_sqlite_type
        and normalize_sqlite_blob(
            existing_row[
                "raw_value"
            ]
        )
        == expected_payload
    )


def insert_bundle_record(
    connection: sqlite3.Connection,
    archive: zipfile.ZipFile,
    record: dict[str, Any],
) -> str:
    table_name = get_string(
        record.get(
            "tableName"
        )
    )

    key = get_string(
        record.get(
            "key"
        )
    )

    sqlite_type = get_string(
        record.get(
            "sqliteType"
        )
    )

    if (
        table_name is None
        or key is None
        or sqlite_type is None
    ):
        raise ValueError(
            "A bundle record contains "
            "incomplete SQLite metadata."
        )

    validate_table_name(
        table_name
    )

    payload = read_payload(
        archive,
        record,
    )

    existing_row = (
        fetch_existing_record(
            connection,
            table_name,
            key,
        )
    )

    if (
        existing_row
        is not None
    ):
        if verify_existing_record(
            existing_row,
            sqlite_type,
            payload,
        ):
            return (
                "skipped-identical"
            )

        raise RuntimeError(
            "The destination database already "
            "contains a different record: "
            f"{table_name}:{key}"
        )

    connection.execute(
        f"""
        INSERT INTO {table_name}
            (key, value)
        VALUES
            (?, ?)
        """,
        (
            key,
            sqlite_value_from_payload(
                sqlite_type,
                payload,
            ),
        ),
    )

    inserted_row = (
        fetch_existing_record(
            connection,
            table_name,
            key,
        )
    )

    if (
        inserted_row is None
        or not verify_existing_record(
            inserted_row,
            sqlite_type,
            payload,
        )
    ):
        raise RuntimeError(
            "The imported record failed "
            "verification after insertion: "
            f"{table_name}:{key}"
        )

    return "inserted"


def load_json_item(
    connection: sqlite3.Connection,
    key: str,
    *,
    allow_missing: bool = False,
) -> dict[str, Any]:
    row = connection.execute(
        """
        SELECT value
        FROM ItemTable
        WHERE key = ?
        LIMIT 1
        """,
        (
            key,
        ),
    ).fetchone()

    if row is None:
        if allow_missing:
            return {}

        raise RuntimeError(
            "ItemTable key was not found: "
            f"{key}"
        )

    parsed_value = parse_json_value(
        row[
            "value"
        ]
    )

    if not isinstance(
        parsed_value,
        dict,
    ):
        raise RuntimeError(
            "ItemTable key is not valid JSON: "
            f"{key}"
        )

    return parsed_value


def write_json_item(
    connection: sqlite3.Connection,
    key: str,
    value: dict[str, Any],
) -> None:
    connection.execute(
        """
        INSERT OR REPLACE INTO ItemTable
            (key, value)
        VALUES
            (?, ?)
        """,
        (
            key,
            json.dumps(
                value,
                ensure_ascii=False,
                separators=(",", ":"),
            ),
        ),
    )


def merge_headers(
    existing_headers: list[
        dict[str, Any]
    ],
    incoming_headers: list[
        dict[str, Any]
    ],
) -> list[
    dict[str, Any]
]:
    headers_by_id: dict[
        str,
        dict[str, Any],
    ] = {}

    for header in existing_headers:
        composer_id = get_composer_id(
            header
        )

        if composer_id is None:
            continue

        headers_by_id[
            composer_id
        ] = copy.deepcopy(
            header
        )

    for header in incoming_headers:
        composer_id = get_composer_id(
            header
        )

        if composer_id is None:
            raise ValueError(
                "An imported composer header "
                "does not contain composerId."
            )

        headers_by_id[
            composer_id
        ] = copy.deepcopy(
            header
        )

    merged_headers = list(
        headers_by_id.values()
    )

    merged_headers.sort(
        key=get_header_time,
        reverse=True,
    )

    return merged_headers


def merge_global_composer_headers(
    connection: sqlite3.Connection,
    imported_headers: list[
        dict[str, Any]
    ],
) -> None:
    root_value = load_json_item(
        connection,
        GLOBAL_HEADERS_KEY,
        allow_missing=True,
    )

    all_composers = root_value.get(
        "allComposers"
    )

    existing_headers = (
        [
            item
            for item
            in all_composers
            if isinstance(
                item,
                dict,
            )
        ]
        if isinstance(
            all_composers,
            list,
        )
        else []
    )

    root_value[
        "allComposers"
    ] = merge_headers(
        existing_headers,
        imported_headers,
    )

    write_json_item(
        connection,
        GLOBAL_HEADERS_KEY,
        root_value,
    )


def read_bundle_headers(
    bundle_path: Path,
    destination_project_path: str,
    destination_workspace_id: str,
) -> dict[
    str,
    dict[str, Any],
]:
    result: dict[
        str,
        dict[str, Any],
    ] = {}

    with zipfile.ZipFile(
        bundle_path,
        mode="r",
    ) as archive:
        (
            bundle_manifest,
            _,
        ) = read_bundle_manifest(
            archive
        )

        conversations = (
            bundle_manifest.get(
                "conversations"
            )
        )

        if not isinstance(
            conversations,
            list,
        ):
            raise RuntimeError(
                "The bundle does not contain "
                "a valid conversation list."
            )

        for conversation in conversations:
            if not isinstance(
                conversation,
                dict,
            ):
                raise RuntimeError(
                    "The bundle contains an "
                    "invalid conversation entry."
                )

            composer_id = get_string(
                conversation.get(
                    "composerId"
                )
            )

            header_entry = (
                conversation.get(
                    "header"
                )
            )

            if (
                not composer_id
                or not isinstance(
                    header_entry,
                    dict,
                )
            ):
                raise RuntimeError(
                    "A bundle conversation is missing "
                    "its composer ID or header."
                )

            header_payload = read_payload(
                archive,
                header_entry,
            )

            try:
                original_header = json.loads(
                    header_payload.decode(
                        "utf-8"
                    )
                )

            except (
                UnicodeDecodeError,
                json.JSONDecodeError,
            ) as error:
                raise RuntimeError(
                    "A composer header payload "
                    "is not valid JSON."
                ) from error

            if not isinstance(
                original_header,
                dict,
            ):
                raise RuntimeError(
                    "A composer header payload "
                    "must be a JSON object."
                )

            if (
                get_string(
                    original_header.get(
                        "composerId"
                    )
                )
                != composer_id
            ):
                raise RuntimeError(
                    "A composer header does not "
                    "match its conversation ID."
                )

            result[
                composer_id
            ] = prepare_imported_header(
                original_header,
                destination_project_path,
                destination_workspace_id,
            )

    return result


def import_bundle_conversations(
    connection: sqlite3.Connection,
    bundle_path: Path,
    validation_result: dict[str, Any],
    prepared_headers_by_id: dict[
        str,
        dict[str, Any],
    ],
) -> tuple[
    dict[str, int],
    list[str],
    list[dict[str, Any]],
]:
    status_by_composer_id = {
        str(
            item[
                "composerId"
            ]
        ):
        str(
            item[
                "status"
            ]
        )
        for item in validation_result[
            "conversations"
        ]
    }

    inserted_record_count = 0
    skipped_record_count = 0
    imported_conversation_count = 0
    skipped_conversation_count = 0

    imported_composer_ids: list[
        str
    ] = []

    workspace_headers: list[
        dict[str, Any]
    ] = []

    global_headers_to_merge: list[
        dict[str, Any]
    ] = []

    with zipfile.ZipFile(
        bundle_path,
        mode="r",
    ) as archive:
        (
            bundle_manifest,
            _,
        ) = read_bundle_manifest(
            archive
        )

        conversations = (
            bundle_manifest.get(
                "conversations"
            )
        )

        if not isinstance(
            conversations,
            list,
        ):
            raise RuntimeError(
                "The bundle does not contain "
                "a valid conversation list."
            )

        for conversation in conversations:
            if not isinstance(
                conversation,
                dict,
            ):
                raise RuntimeError(
                    "The bundle contains an "
                    "invalid conversation entry."
                )

            composer_id = get_string(
                conversation.get(
                    "composerId"
                )
            )

            if not composer_id:
                raise RuntimeError(
                    "The bundle contains a conversation "
                    "without composerId."
                )

            conversation_status = (
                status_by_composer_id.get(
                    composer_id
                )
            )

            prepared_header = (
                prepared_headers_by_id.get(
                    composer_id
                )
            )

            if prepared_header is None:
                raise RuntimeError(
                    "The prepared composer header "
                    "is missing for: "
                    f"{composer_id}"
                )

            workspace_headers.append(
                copy.deepcopy(
                    prepared_header
                )
            )

            global_headers_to_merge.append(
                copy.deepcopy(
                    prepared_header
                )
            )

            imported_composer_ids.append(
                composer_id
            )

            if (
                conversation_status
                == "identical"
            ):
                skipped_conversation_count += 1

                continue

            if (
                conversation_status
                != "new"
            ):
                raise RuntimeError(
                    "The import contains a conversation "
                    "requiring review: "
                    f"{composer_id}"
                )

            records = conversation.get(
                "records"
            )

            if not isinstance(
                records,
                list,
            ):
                raise RuntimeError(
                    "A new conversation contains "
                    "an invalid record list."
                )

            for record in records:
                if not isinstance(
                    record,
                    dict,
                ):
                    raise RuntimeError(
                        "A new conversation contains "
                        "an invalid SQLite record."
                    )

                record_result = (
                    insert_bundle_record(
                        connection,
                        archive,
                        record,
                    )
                )

                if (
                    record_result
                    == "inserted"
                ):
                    inserted_record_count += 1

                else:
                    skipped_record_count += 1

            imported_conversation_count += 1

    if global_headers_to_merge:
        merge_global_composer_headers(
            connection,
            global_headers_to_merge,
        )

    return (
        {
            "importedConversationCount":
                imported_conversation_count,

            "skippedConversationCount":
                skipped_conversation_count,

            "insertedRecordCount":
                inserted_record_count,

            "skippedRecordCount":
                skipped_record_count,
        },
        deduplicate_strings(
            imported_composer_ids
        ),
        workspace_headers,
    )


def choose_workspace_anchor(
    root_value: dict[str, Any],
    existing_headers: list[
        dict[str, Any]
    ],
    merged_headers: list[
        dict[str, Any]
    ],
) -> str | None:
    merged_ids = {
        composer_id
        for composer_id in (
            get_composer_id(
                header
            )
            for header
            in merged_headers
        )
        if composer_id
    }

    candidates: list[Any] = [
        root_value.get(
            "selectedComposerId"
        ),
        root_value.get(
            "lastFocusedComposerId"
        ),
    ]

    selected_ids = root_value.get(
        "selectedComposerIds"
    )

    focused_ids = root_value.get(
        "lastFocusedComposerIds"
    )

    if isinstance(
        selected_ids,
        list,
    ):
        candidates.extend(
            selected_ids
        )

    if isinstance(
        focused_ids,
        list,
    ):
        candidates.extend(
            focused_ids
        )

    candidates.extend(
        get_composer_id(
            header
        )
        for header in sorted(
            existing_headers,
            key=get_header_time,
            reverse=True,
        )
    )

    candidates.extend(
        get_composer_id(
            header
        )
        for header
        in merged_headers
    )

    for candidate in candidates:
        if isinstance(
            candidate,
            str,
        ):
            cleaned = (
                candidate.strip()
            )

            if cleaned in merged_ids:
                return cleaned

    return None


def update_workspace_composer_metadata(
    connection: sqlite3.Connection,
    imported_headers: list[
        dict[str, Any]
    ],
) -> dict[str, Any]:
    root_value = load_json_item(
        connection,
        WORKSPACE_COMPOSER_DATA_KEY,
        allow_missing=True,
    )

    existing_all_composers = (
        root_value.get(
            "allComposers"
        )
    )

    existing_headers = (
        [
            item
            for item
            in existing_all_composers
            if isinstance(
                item,
                dict,
            )
        ]
        if isinstance(
            existing_all_composers,
            list,
        )
        else []
    )

    merged_headers = merge_headers(
        existing_headers,
        imported_headers,
    )

    anchor_id = (
        choose_workspace_anchor(
            root_value,
            existing_headers,
            merged_headers,
        )
    )

    root_value[
        "allComposers"
    ] = merged_headers

    root_value[
        "hasMigratedComposerData"
    ] = False

    root_value[
        "hasMigratedMultipleComposers"
    ] = False

    if anchor_id is not None:
        root_value[
            "selectedComposerId"
        ] = anchor_id

        root_value[
            "lastFocusedComposerId"
        ] = anchor_id

        root_value[
            "selectedComposerIds"
        ] = [
            anchor_id
        ]

        root_value[
            "lastFocusedComposerIds"
        ] = [
            anchor_id
        ]

    write_json_item(
        connection,
        WORKSPACE_COMPOSER_DATA_KEY,
        root_value,
    )

    return {
        "updated":
            True,

        "sidebarCount":
            len(
                merged_headers
            ),

        "anchorComposerId":
            anchor_id,
    }


def verify_import_visibility_metadata(
    global_database_path: Path,
    workspace_database_path: Path,
    imported_composer_ids: list[str],
    destination_workspace_id: str,
) -> dict[str, Any]:
    expected_ids = set(
        imported_composer_ids
    )

    global_connection = (
        sqlite3.connect(
            create_read_only_uri(
                global_database_path
            ),
            uri=True,
            timeout=10.0,
        )
    )

    global_connection.row_factory = (
        sqlite3.Row
    )

    try:
        header_map = {
            composer_id:
                header
            for header
            in get_composer_headers(
                global_connection
            )
            if (
                composer_id
                := get_composer_id(
                    header
                )
            )
        }

        missing_global_ids = sorted(
            expected_ids
            - set(
                header_map
            )
        )

        if missing_global_ids:
            raise RuntimeError(
                "Imported conversation headers are "
                "missing from the global sidebar index: "
                + ", ".join(
                    missing_global_ids
                )
            )

        for composer_id in expected_ids:
            header = header_map[
                composer_id
            ]

            workspace_identifier = (
                header.get(
                    "workspaceIdentifier"
                )
            )

            if (
                not isinstance(
                    workspace_identifier,
                    dict,
                )
                or get_string(
                    workspace_identifier.get(
                        "id"
                    )
                )
                != destination_workspace_id
            ):
                raise RuntimeError(
                    "Imported conversation has the "
                    "wrong destination workspace: "
                    f"{composer_id}"
                )

            if (
                header.get(
                    "hasBeenInSidebar"
                )
                is not True
            ):
                raise RuntimeError(
                    "Imported conversation is not marked "
                    "for sidebar visibility: "
                    f"{composer_id}"
                )

    finally:
        global_connection.close()

    workspace_connection = (
        sqlite3.connect(
            create_read_only_uri(
                workspace_database_path
            ),
            uri=True,
            timeout=10.0,
        )
    )

    workspace_connection.row_factory = (
        sqlite3.Row
    )

    try:
        workspace_data = load_json_item(
            workspace_connection,
            WORKSPACE_COMPOSER_DATA_KEY,
        )

        all_composers = (
            workspace_data.get(
                "allComposers"
            )
        )

        if not isinstance(
            all_composers,
            list,
        ):
            raise RuntimeError(
                "Workspace composer metadata does "
                "not contain allComposers."
            )

        workspace_ids = {
            composer_id
            for composer_id in (
                get_composer_id(
                    item
                )
                for item
                in all_composers
            )
            if composer_id
        }

        missing_workspace_ids = sorted(
            expected_ids
            - workspace_ids
        )

        if missing_workspace_ids:
            raise RuntimeError(
                "Imported conversations are missing "
                "from the workspace sidebar index: "
                + ", ".join(
                    missing_workspace_ids
                )
            )

        if (
            workspace_data.get(
                "hasMigratedComposerData"
            )
            is not False
        ):
            raise RuntimeError(
                "Workspace migration flag "
                "hasMigratedComposerData "
                "is not false."
            )

        if (
            workspace_data.get(
                "hasMigratedMultipleComposers"
            )
            is not False
        ):
            raise RuntimeError(
                "Workspace migration flag "
                "hasMigratedMultipleComposers "
                "is not false."
            )

        return {
            "workspaceSidebarCount":
                len(
                    workspace_ids
                ),

            "workspaceIndexVerified":
                True,
        }

    finally:
        workspace_connection.close()


def execute_import_job(
    job: dict[str, Any],
) -> dict[str, Any]:
    job_id = str(
        job[
            "jobId"
        ]
    )

    bundle_path = Path(
        str(
            job[
                "bundlePath"
            ]
        )
    )

    expected_bundle_sha256 = str(
        job[
            "bundleSha256"
        ]
    )

    global_database_path = Path(
        str(
            job[
                "destinationDatabasePath"
            ]
        )
    )

    workspace_database_path = Path(
        str(
            job[
                "destinationWorkspaceDatabasePath"
            ]
        )
    )

    destination_project_path = str(
        job[
            "destinationProjectPath"
        ]
    )

    destination_workspace_id = str(
        job[
            "destinationWorkspaceId"
        ]
    )

    backup_root = Path(
        str(
            job[
                "backupRoot"
            ]
        )
    )

    wait_timeout_seconds = int(
        job.get(
            "waitTimeoutSeconds",
            DEFAULT_WAIT_TIMEOUT_SECONDS,
        )
    )

    extension_host_process_id = int(
        job[
            "extensionHostProcessId"
        ]
    )

    if (
        extension_host_process_id
        <= 0
    ):
        raise ValueError(
            "The import job contains an invalid "
            "extension-host process ID."
        )

    for (
        database_path,
        label,
    ) in (
        (
            global_database_path,
            "global Cursor",
        ),
        (
            workspace_database_path,
            "workspace Cursor",
        ),
    ):
        if not database_path.is_file():
            raise FileNotFoundError(
                f"The {label} database was not found: "
                f"{database_path}"
            )

    if not bundle_path.is_file():
        raise FileNotFoundError(
            "The staged plaintext bundle "
            f"was not found: {bundle_path}"
        )

    actual_bundle_sha256 = (
        sha256_file(
            bundle_path
        )
    )

    if (
        actual_bundle_sha256
        != expected_bundle_sha256
    ):
        raise RuntimeError(
            "The staged conversation bundle "
            "failed SHA-256 verification."
        )

    wait_for_process_to_exit(
        extension_host_process_id,
        wait_timeout_seconds,
    )

    wait_for_database_write_access(
        [
            global_database_path,
            workspace_database_path,
        ],
        wait_timeout_seconds,
    )

    (
        backup_directory,
        global_backup_path,
        workspace_backup_path,
    ) = create_backup_directory(
        global_database_path,
        workspace_database_path,
        backup_root,
        job_id,
    )

    any_database_committed = False

    try:
        validation_result = validate_bundle(
            str(
                bundle_path
            ),
            str(
                global_database_path
            ),
            destination_project_path,
        )

        conflict_count = int(
            validation_result[
                "summary"
            ][
                "conflictCount"
            ]
        )

        if conflict_count > 0:
            raise RuntimeError(
                "The destination database contains "
                f"{conflict_count} conversation "
                "conflict(s) before import."
            )

        prepared_headers_by_id = (
            read_bundle_headers(
                bundle_path,
                destination_project_path,
                destination_workspace_id,
            )
        )

        global_connection = (
            sqlite3.connect(
                global_database_path,
                timeout=30.0,
                isolation_level=None,
            )
        )

        global_connection.row_factory = (
            sqlite3.Row
        )

        try:
            ensure_database_tables(
                global_connection,
                {
                    "ItemTable",
                    "cursorDiskKV",
                },
            )

            global_connection.execute(
                "PRAGMA foreign_keys = ON"
            )

            global_connection.execute(
                "PRAGMA busy_timeout = 30000"
            )

            global_connection.execute(
                "BEGIN IMMEDIATE"
            )

            try:
                (
                    import_counts,
                    imported_composer_ids,
                    workspace_headers,
                ) = import_bundle_conversations(
                    global_connection,
                    bundle_path,
                    validation_result,
                    prepared_headers_by_id,
                )

                if not workspace_headers:
                    raise RuntimeError(
                        "The bundle did not provide any "
                        "conversation headers for the "
                        "workspace sidebar."
                    )

                global_connection.execute(
                    "COMMIT"
                )

                any_database_committed = True

            except Exception:
                global_connection.execute(
                    "ROLLBACK"
                )

                raise

        finally:
            global_connection.close()

        workspace_connection = (
            sqlite3.connect(
                workspace_database_path,
                timeout=30.0,
                isolation_level=None,
            )
        )

        workspace_connection.row_factory = (
            sqlite3.Row
        )

        try:
            ensure_database_tables(
                workspace_connection,
                {
                    "ItemTable",
                },
            )

            workspace_connection.execute(
                "PRAGMA busy_timeout = 30000"
            )

            workspace_connection.execute(
                "BEGIN IMMEDIATE"
            )

            try:
                workspace_result = (
                    update_workspace_composer_metadata(
                        workspace_connection,
                        workspace_headers,
                    )
                )

                workspace_connection.execute(
                    "COMMIT"
                )

                any_database_committed = True

            except Exception:
                workspace_connection.execute(
                    "ROLLBACK"
                )

                raise

        finally:
            workspace_connection.close()

        final_validation = validate_bundle(
            str(
                bundle_path
            ),
            str(
                global_database_path
            ),
            destination_project_path,
        )

        final_new_count = int(
            final_validation[
                "summary"
            ][
                "newCount"
            ]
        )

        final_conflict_count = int(
            final_validation[
                "summary"
            ][
                "conflictCount"
            ]
        )

        if final_new_count != 0:
            raise RuntimeError(
                "The imported database still reports "
                f"{final_new_count} new conversation(s) "
                "after import."
            )

        if final_conflict_count != 0:
            raise RuntimeError(
                "The imported database still reports "
                f"{final_conflict_count} conversation "
                "conflict(s) after import."
            )

        visibility_result = (
            verify_import_visibility_metadata(
                global_database_path,
                workspace_database_path,
                imported_composer_ids,
                destination_workspace_id,
            )
        )

        return {
            "ok":
                True,

            "resultVersion":
                RESULT_VERSION,

            "jobId":
                job_id,

            "completedAt":
                utc_now_iso(),

            "destinationDatabasePath":
                str(
                    global_database_path.resolve()
                ),

            "destinationWorkspaceDatabasePath":
                str(
                    workspace_database_path.resolve()
                ),

            "destinationProjectPath":
                os.path.abspath(
                    destination_project_path
                ),

            "destinationWorkspaceId":
                destination_workspace_id,

            "backupDirectory":
                str(
                    backup_directory.resolve()
                ),

            "bundleSha256":
                actual_bundle_sha256,

            **import_counts,

            "finalIdenticalCount":
                int(
                    final_validation[
                        "summary"
                    ][
                        "identicalCount"
                    ]
                ),

            "finalConflictCount":
                final_conflict_count,

            "workspaceMetadataUpdated":
                bool(
                    workspace_result[
                        "updated"
                    ]
                ),

            "workspaceSidebarCount":
                int(
                    workspace_result[
                        "sidebarCount"
                    ]
                ),

            "workspaceAnchorComposerId":
                workspace_result[
                    "anchorComposerId"
                ],

            **visibility_result,
        }

    except Exception as import_error:
        if not any_database_committed:
            raise

        restore_errors: list[str] = []

        for (
            backup_path,
            destination_path,
            database_label,
        ) in (
            (
                global_backup_path,
                global_database_path,
                "global Cursor",
            ),
            (
                workspace_backup_path,
                workspace_database_path,
                "workspace Cursor",
            ),
        ):
            try:
                restore_database(
                    backup_path,
                    destination_path,
                )

            except Exception as restore_error:
                restore_errors.append(
                    (
                        f"{database_label}: "
                        f"{restore_error}"
                    )
                )

        if restore_errors:
            raise RuntimeError(
                "Conversation import failed and one "
                "or more database restores also failed. "
                f"Import error: {import_error}. "
                "Restore errors: "
                + "; ".join(
                    restore_errors
                )
            ) from import_error

        raise


def main() -> int:
    if len(sys.argv) != 2:
        return 2

    job_path = Path(
        sys.argv[
            1
        ]
    ).expanduser()

    job: (
        dict[str, Any]
        | None
    ) = None

    result_path: (
        Path
        | None
    ) = None

    staged_bundle_path: (
        Path
        | None
    ) = None

    try:
        job = load_job(
            job_path
        )

        result_path = Path(
            str(
                job[
                    "resultPath"
                ]
            )
        )

        staged_bundle_path = Path(
            str(
                job[
                    "bundlePath"
                ]
            )
        )

        result = execute_import_job(
            job
        )

        write_json_atomic(
            result_path,
            result,
        )

        return 0

    except Exception as error:
        if result_path is not None:
            failure_result = {
                "ok":
                    False,

                "resultVersion":
                    RESULT_VERSION,

                "jobId":
                    (
                        str(
                            job.get(
                                "jobId"
                            )
                        )
                        if job
                        is not None
                        else None
                    ),

                "completedAt":
                    utc_now_iso(),

                "error":
                    str(
                        error
                    ),
            }

            try:
                write_json_atomic(
                    result_path,
                    failure_result,
                )

            except Exception:
                pass

        return 1

    finally:
        if (
            staged_bundle_path
            is not None
        ):
            try:
                staged_bundle_path.unlink(
                    missing_ok=True
                )

            except Exception:
                pass

        try:
            job_path.unlink(
                missing_ok=True
            )

        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(
        main()
    )