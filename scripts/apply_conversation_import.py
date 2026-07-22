from __future__ import annotations

import copy
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

from build_conversation_bundle_manifest import (
    DATABASE_TABLES,
)

from index_project_conversations import (
    create_read_only_uri,
    get_composer_headers,
    parse_json_value,
)

from validate_conversation_bundle import (
    BUNDLE_MANIFEST_NAME,
    SHA256_PATTERN,
    get_string,
    normalize_sqlite_blob,
    read_bundle_manifest,
    sha256_bytes,
    validate_bundle,
    validate_payload_entry,
)


RESULT_VERSION = 1

DEFAULT_WAIT_TIMEOUT_SECONDS = 300

CURSOR_PROCESS_NAMES = {
    "cursor.exe",
}


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

    with file_path.open("rb") as file:
        while True:
            chunk = file.read(
                1024 * 1024
            )

            if not chunk:
                break

            digest.update(chunk)

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

    if parsed_value.get("version") != 1:
        raise ValueError(
            "The import job version is not supported."
        )

    return parsed_value


def is_cursor_running_windows() -> bool:
    completed_process = subprocess.run(
        [
            "tasklist",
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

    if completed_process.returncode != 0:
        return True

    for line in (
        completed_process.stdout
        .splitlines()
    ):
        cleaned_line = (
            line.strip().lower()
        )

        if not cleaned_line:
            continue

        for process_name in (
            CURSOR_PROCESS_NAMES
        ):
            quoted_name = (
                f'"{process_name}"'
            )

            if cleaned_line.startswith(
                quoted_name
            ):
                return True

    return False


def is_cursor_running_unix() -> bool:
    completed_process = subprocess.run(
        [
            "pgrep",
            "-f",
            "(^|/)(Cursor|cursor)( |$)",
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    return (
        completed_process.returncode == 0
        and bool(
            completed_process.stdout.strip()
        )
    )


def is_cursor_running() -> bool:
    if os.name == "nt":
        return is_cursor_running_windows()

    return is_cursor_running_unix()


def wait_for_cursor_to_close(
    timeout_seconds: int,
) -> None:
    deadline = (
        time.monotonic()
        + timeout_seconds
    )

    while is_cursor_running():
        if time.monotonic() >= deadline:
            raise TimeoutError(
                "Cursor did not close before "
                "the import timeout expired."
            )

        time.sleep(2.0)

    time.sleep(2.0)


def validate_table_name(
    table_name: str,
) -> None:
    if table_name not in DATABASE_TABLES:
        raise ValueError(
            "Unsupported SQLite table: "
            f"{table_name}"
        )


def ensure_database_tables(
    connection: sqlite3.Connection,
) -> None:
    rows = connection.execute(
        """
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
        """
    ).fetchall()

    existing_tables = {
        str(row[0])
        for row in rows
    }

    required_tables = {
        "ItemTable",
        "cursorDiskKV",
    }

    missing_tables = (
        required_tables
        - existing_tables
    )

    if missing_tables:
        raise RuntimeError(
            "The destination Cursor database "
            "is missing required tables: "
            + ", ".join(
                sorted(missing_tables)
            )
        )


def create_database_backup(
    database_path: Path,
    backup_root: Path,
    job_id: str,
) -> Path:
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

    backup_database_path = (
        backup_directory
        / "state.vscdb"
    )

    source_connection = sqlite3.connect(
        create_read_only_uri(
            database_path
        ),
        uri=True,
        timeout=30.0,
    )

    destination_connection = (
        sqlite3.connect(
            backup_database_path
        )
    )

    try:
        source_connection.backup(
            destination_connection
        )
    finally:
        destination_connection.close()
        source_connection.close()

    for suffix in (
        "-wal",
        "-shm",
    ):
        sidecar_path = Path(
            f"{database_path}{suffix}"
        )

        if sidecar_path.is_file():
            shutil.copy2(
                sidecar_path,
                backup_directory
                / sidecar_path.name,
            )

    metadata = {
        "version": 1,
        "createdAt": utc_now_iso(),
        "jobId": job_id,
        "sourceDatabasePath":
            str(database_path.resolve()),
        "backupDatabasePath":
            str(
                backup_database_path
                .resolve()
            ),
        "sourceDatabaseSha256":
            sha256_file(database_path),
        "backupDatabaseSha256":
            sha256_file(
                backup_database_path
            ),
    }

    write_json_atomic(
        backup_directory
        / "backup-metadata.json",
        metadata,
    )

    if (
        metadata[
            "sourceDatabaseSha256"
        ]
        != metadata[
            "backupDatabaseSha256"
        ]
    ):
        raise RuntimeError(
            "The Cursor database backup "
            "failed SHA-256 verification."
        )

    return backup_directory


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

    uri_path = parsed_uri.path

    return {
        "fsPath":
            str(resolved_path),
        "external":
            external_uri,
        "path":
            uri_path,
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

    destination_values = (
        destination_uri_values(
            destination_project_path
        )
    )

    value["scheme"] = "file"

    if "authority" in value:
        value["authority"] = ""

    for (
        field_name,
        field_value,
    ) in destination_values.items():
        value[field_name] = field_value


def remap_composer_header(
    original_header: dict[str, Any],
    destination_project_path: str,
    destination_workspace_id: str,
) -> dict[str, Any]:
    header = copy.deepcopy(
        original_header
    )

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

    workspace_identifier["id"] = (
        destination_workspace_id
    )

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

    draft_target = header.get(
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

    payload_path = str(
        validation_result[
            "payloadPath"
        ]
    )

    return archive.read(
        payload_path
    )


def sqlite_value_from_payload(
    sqlite_type: str,
    payload: bytes,
) -> Any:
    if sqlite_type == "text":
        return payload.decode(
            "utf-8"
        )

    if sqlite_type == "blob":
        return sqlite3.Binary(
            payload
        )

    if sqlite_type == "integer":
        return int(
            payload.decode(
                "ascii"
            )
        )

    if sqlite_type == "real":
        return float(
            payload.decode(
                "ascii"
            )
        )

    if sqlite_type == "null":
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
            typeof(value)
                AS sqlite_type,
            CAST(value AS BLOB)
                AS raw_value
        FROM {table_name}
        WHERE key = ?
        LIMIT 1
        """,
        (key,),
    ).fetchone()


def verify_existing_record(
    existing_row: sqlite3.Row,
    expected_sqlite_type: str,
    expected_payload: bytes,
) -> bool:
    existing_type = str(
        existing_row[
            "sqlite_type"
        ]
    )

    existing_payload = (
        normalize_sqlite_blob(
            existing_row[
                "raw_value"
            ]
        )
    )

    return (
        existing_type
        == expected_sqlite_type
        and existing_payload
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
        record.get("key")
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

    if existing_row is not None:
        if verify_existing_record(
            existing_row,
            sqlite_type,
            payload,
        ):
            return "skipped-identical"

        raise RuntimeError(
            "The destination database "
            "already contains a different "
            f"record: {table_name}:{key}"
        )

    sqlite_value = (
        sqlite_value_from_payload(
            sqlite_type,
            payload,
        )
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
            sqlite_value,
        ),
    )

    inserted_row = (
        fetch_existing_record(
            connection,
            table_name,
            key,
        )
    )

    if inserted_row is None:
        raise RuntimeError(
            "The imported record could "
            "not be read after insertion: "
            f"{table_name}:{key}"
        )

    if not verify_existing_record(
        inserted_row,
        sqlite_type,
        payload,
    ):
        raise RuntimeError(
            "The imported record failed "
            "verification after insertion: "
            f"{table_name}:{key}"
        )

    return "inserted"


def load_composer_header_state(
    connection: sqlite3.Connection,
) -> tuple[
    dict[str, Any],
    list[dict[str, Any]],
]:
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
        root_value: dict[
            str,
            Any
        ] = {
            "allComposers": [],
        }

        return (
            root_value,
            [],
        )

    parsed_value = parse_json_value(
        row["value"]
    )

    if not isinstance(
        parsed_value,
        dict,
    ):
        raise RuntimeError(
            "The destination composer "
            "header index is not valid JSON."
        )

    all_composers = (
        parsed_value.get(
            "allComposers"
        )
    )

    if not isinstance(
        all_composers,
        list,
    ):
        raise RuntimeError(
            "The destination composer "
            "header index does not contain "
            "allComposers."
        )

    typed_composers = [
        item
        for item in all_composers
        if isinstance(item, dict)
    ]

    return (
        parsed_value,
        typed_composers,
    )


def merge_composer_headers(
    connection: sqlite3.Connection,
    imported_headers:
        list[dict[str, Any]],
) -> None:
    (
        root_value,
        existing_headers,
    ) = load_composer_header_state(
        connection
    )

    existing_ids = {
        composer_id
        for composer_id in (
            get_string(
                header.get(
                    "composerId"
                )
            )
            for header in existing_headers
        )
        if composer_id
    }

    for imported_header in (
        imported_headers
    ):
        composer_id = get_string(
            imported_header.get(
                "composerId"
            )
        )

        if not composer_id:
            raise ValueError(
                "An imported composer header "
                "does not contain composerId."
            )

        if composer_id in existing_ids:
            raise RuntimeError(
                "The destination composer "
                "header index already contains "
                f"{composer_id}."
            )

        existing_ids.add(
            composer_id
        )

    imported_headers.sort(
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

    root_value["allComposers"] = (
        imported_headers
        + existing_headers
    )

    serialized_value = json.dumps(
        root_value,
        ensure_ascii=False,
        separators=(",", ":"),
    )

    connection.execute(
        """
        INSERT OR REPLACE INTO ItemTable
            (key, value)
        VALUES
            (
                'composer.composerHeaders',
                ?
            )
        """,
        (serialized_value,),
    )


def validate_imported_headers(
    connection: sqlite3.Connection,
    imported_composer_ids:
        set[str],
    destination_workspace_id: str,
) -> None:
    current_headers = (
        get_composer_headers(
            connection
        )
    )

    matching_headers = {
        composer_id:
            header
        for header in current_headers
        if (
            composer_id := get_string(
                header.get(
                    "composerId"
                )
            )
        )
        in imported_composer_ids
    }

    if (
        set(matching_headers)
        != imported_composer_ids
    ):
        raise RuntimeError(
            "One or more imported composer "
            "headers could not be verified."
        )

    for (
        composer_id,
        header,
    ) in matching_headers.items():
        workspace_identifier = (
            header.get(
                "workspaceIdentifier"
            )
        )

        if not isinstance(
            workspace_identifier,
            dict,
        ):
            raise RuntimeError(
                "Imported composer header "
                "is missing workspaceIdentifier: "
                f"{composer_id}"
            )

        workspace_id = get_string(
            workspace_identifier.get(
                "id"
            )
        )

        if (
            workspace_id !=
            destination_workspace_id
        ):
            raise RuntimeError(
                "Imported composer header "
                "has the wrong workspace ID: "
                f"{composer_id}"
            )


def import_new_conversations(
    connection: sqlite3.Connection,
    bundle_path: Path,
    validation_result:
        dict[str, Any],
    destination_project_path: str,
    destination_workspace_id: str,
) -> dict[str, int]:
    status_by_composer_id = {
        str(item["composerId"]):
            str(item["status"])
        for item in (
            validation_result[
                "conversations"
            ]
        )
    }

    inserted_record_count = 0
    skipped_record_count = 0
    imported_conversation_count = 0
    skipped_conversation_count = 0

    imported_headers: list[
        dict[str, Any]
    ] = []

    imported_composer_ids: set[
        str
    ] = set()

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

        for conversation in (
            conversations
        ):
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
                    "The bundle contains a "
                    "conversation without "
                    "composerId."
                )

            conversation_status = (
                status_by_composer_id.get(
                    composer_id
                )
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
                    "The import contains a "
                    "conversation requiring review: "
                    f"{composer_id}"
                )

            header_entry = (
                conversation.get(
                    "header"
                )
            )

            if not isinstance(
                header_entry,
                dict,
            ):
                raise RuntimeError(
                    "A new conversation does not "
                    "contain its header payload."
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

            header_composer_id = get_string(
                original_header.get(
                    "composerId"
                )
            )

            if (
                header_composer_id
                != composer_id
            ):
                raise RuntimeError(
                    "A composer header does not "
                    "match its conversation ID."
                )

            remapped_header = (
                remap_composer_header(
                    original_header,
                    destination_project_path,
                    destination_workspace_id,
                )
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

            imported_headers.append(
                remapped_header
            )

            imported_composer_ids.add(
                composer_id
            )

            imported_conversation_count += 1

    if imported_headers:
        merge_composer_headers(
            connection,
            imported_headers,
        )

        validate_imported_headers(
            connection,
            imported_composer_ids,
            destination_workspace_id,
        )

    return {
        "importedConversationCount":
            imported_conversation_count,
        "skippedConversationCount":
            skipped_conversation_count,
        "insertedRecordCount":
            inserted_record_count,
        "skippedRecordCount":
            skipped_record_count,
    }


def execute_import_job(
    job: dict[str, Any],
) -> dict[str, Any]:
    job_id = str(
        job["jobId"]
    )

    bundle_path = Path(
        str(job["bundlePath"])
    )

    expected_bundle_sha256 = str(
        job["bundleSha256"]
    )

    destination_database_path = Path(
        str(
            job[
                "destinationDatabasePath"
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
        str(job["backupRoot"])
    )

    wait_timeout_seconds = int(
        job.get(
            "waitTimeoutSeconds",
            DEFAULT_WAIT_TIMEOUT_SECONDS,
        )
    )

    if not bundle_path.is_file():
        raise FileNotFoundError(
            "The staged plaintext bundle "
            f"was not found: {bundle_path}"
        )

    if (
        not destination_database_path
        .is_file()
    ):
        raise FileNotFoundError(
            "The destination Cursor database "
            f"was not found: "
            f"{destination_database_path}"
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

    wait_for_cursor_to_close(
        wait_timeout_seconds
    )

    backup_directory = (
        create_database_backup(
            destination_database_path,
            backup_root,
            job_id,
        )
    )

    validation_result = validate_bundle(
        str(bundle_path),
        str(
            destination_database_path
        ),
        destination_project_path,
    )

    conflict_count = int(
        validation_result[
            "summary"
        ]["conflictCount"]
    )

    if conflict_count > 0:
        raise RuntimeError(
            "The destination database changed "
            "after validation and now contains "
            f"{conflict_count} conflict(s)."
        )

    connection = sqlite3.connect(
        destination_database_path,
        timeout=30.0,
        isolation_level=None,
    )

    connection.row_factory = (
        sqlite3.Row
    )

    try:
        ensure_database_tables(
            connection
        )

        connection.execute(
            "PRAGMA foreign_keys = ON"
        )

        connection.execute(
            "PRAGMA busy_timeout = 30000"
        )

        connection.execute(
            "BEGIN IMMEDIATE"
        )

        try:
            import_counts = (
                import_new_conversations(
                    connection,
                    bundle_path,
                    validation_result,
                    destination_project_path,
                    destination_workspace_id,
                )
            )

            connection.execute(
                "COMMIT"
            )
        except Exception:
            connection.execute(
                "ROLLBACK"
            )

            raise

    finally:
        connection.close()

    final_validation = validate_bundle(
        str(bundle_path),
        str(
            destination_database_path
        ),
        destination_project_path,
    )

    if (
        int(
            final_validation[
                "summary"
            ]["newCount"]
        )
        != 0
    ):
        raise RuntimeError(
            "The imported database still "
            "reports new conversations after "
            "the transaction completed."
        )

    if (
        int(
            final_validation[
                "summary"
            ]["conflictCount"]
        )
        != 0
    ):
        raise RuntimeError(
            "The imported database contains "
            "conflicts after the transaction."
        )

    return {
        "ok": True,
        "resultVersion":
            RESULT_VERSION,
        "jobId":
            job_id,
        "completedAt":
            utc_now_iso(),
        "destinationDatabasePath":
            str(
                destination_database_path
                .resolve()
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
                ]["identicalCount"]
            ),
        "finalConflictCount":
            int(
                final_validation[
                    "summary"
                ]["conflictCount"]
            ),
    }


def main() -> int:
    if len(sys.argv) != 2:
        return 2

    job_path = Path(
        sys.argv[1]
    ).expanduser()

    job: dict[str, Any] | None = None

    result_path: Path | None = None

    staged_bundle_path: Path | None = None

    try:
        job = load_job(
            job_path
        )

        result_path = Path(
            str(job["resultPath"])
        )

        staged_bundle_path = Path(
            str(job["bundlePath"])
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
                "ok": False,
                "resultVersion":
                    RESULT_VERSION,
                "jobId":
                    (
                        str(
                            job.get("jobId")
                        )
                        if job is not None
                        else None
                    ),
                "completedAt":
                    utc_now_iso(),
                "error":
                    str(error),
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
        if staged_bundle_path is not None:
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
    raise SystemExit(main())