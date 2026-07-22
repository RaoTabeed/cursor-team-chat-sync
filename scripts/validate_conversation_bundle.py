from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

from build_conversation_bundle_manifest import (
    DATABASE_TABLES,
)

from index_project_conversations import (
    create_read_only_uri,
    get_composer_headers,
    get_project_match_sources,
    normalize_local_path,
)


BUNDLE_MANIFEST_NAME = (
    "bundle-manifest.json"
)

EXPECTED_BUNDLE_FORMAT = (
    "cursor-team-chat-sync"
)

EXPECTED_BUNDLE_VERSION = 1

SHA256_PATTERN = re.compile(
    r"^[0-9a-f]{64}$",
    re.IGNORECASE,
)


def utc_now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(
        value
    ).hexdigest()


def canonical_json_bytes(
    value: Any,
) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def normalize_sqlite_blob(
    value: Any,
) -> bytes:
    if value is None:
        return b""

    if isinstance(value, bytes):
        return value

    if isinstance(value, memoryview):
        return value.tobytes()

    if isinstance(value, str):
        return value.encode("utf-8")

    return str(value).encode(
        "utf-8"
    )


def get_string(
    value: Any,
) -> str | None:
    return (
        value
        if isinstance(value, str)
        else None
    )


def get_number(
    value: Any,
) -> int | float | None:
    if isinstance(value, bool):
        return None

    return (
        value
        if isinstance(
            value,
            (int, float),
        )
        else None
    )


def validate_table_name(
    table_name: str,
) -> None:
    if table_name not in DATABASE_TABLES:
        raise ValueError(
            "Unsupported SQLite table: "
            f"{table_name}"
        )


def validate_archive_path(
    archive_path: str,
) -> None:
    parsed_path = PurePosixPath(
        archive_path
    )

    if parsed_path.is_absolute():
        raise ValueError(
            "Bundle payload contains "
            "an absolute archive path."
        )

    if ".." in parsed_path.parts:
        raise ValueError(
            "Bundle payload contains "
            "an unsafe archive path."
        )

    if "\\" in archive_path:
        raise ValueError(
            "Bundle payload contains "
            "an invalid path separator."
        )


def read_bundle_manifest(
    archive: zipfile.ZipFile,
) -> tuple[
    dict[str, Any],
    bytes,
]:
    try:
        manifest_bytes = archive.read(
            BUNDLE_MANIFEST_NAME
        )
    except KeyError as error:
        raise ValueError(
            "The conversation bundle "
            "does not contain its manifest."
        ) from error

    try:
        parsed_manifest = json.loads(
            manifest_bytes.decode(
                "utf-8"
            )
        )
    except (
        UnicodeDecodeError,
        json.JSONDecodeError,
    ) as error:
        raise ValueError(
            "The conversation bundle "
            "manifest is invalid."
        ) from error

    if not isinstance(
        parsed_manifest,
        dict,
    ):
        raise ValueError(
            "The conversation bundle "
            "manifest must be an object."
        )

    if (
        parsed_manifest.get(
            "bundleFormat"
        )
        != EXPECTED_BUNDLE_FORMAT
    ):
        raise ValueError(
            "The conversation bundle "
            "format is not supported."
        )

    if (
        parsed_manifest.get(
            "bundleVersion"
        )
        != EXPECTED_BUNDLE_VERSION
    ):
        raise ValueError(
            "The conversation bundle "
            "version is not supported."
        )

    return (
        parsed_manifest,
        manifest_bytes,
    )


def validate_payload_entry(
    archive: zipfile.ZipFile,
    payload_entry: dict[str, Any],
) -> dict[str, Any]:
    payload_path = get_string(
        payload_entry.get(
            "payloadPath"
        )
    )

    if not payload_path:
        raise ValueError(
            "A conversation payload "
            "does not have a path."
        )

    validate_archive_path(
        payload_path
    )

    expected_byte_length = (
        payload_entry.get(
            "byteLength"
        )
    )

    if (
        not isinstance(
            expected_byte_length,
            int,
        )
        or isinstance(
            expected_byte_length,
            bool,
        )
        or expected_byte_length < 0
    ):
        raise ValueError(
            "A conversation payload "
            "has an invalid byte length."
        )

    expected_sha256 = get_string(
        payload_entry.get(
            "sha256"
        )
    )

    if (
        expected_sha256 is None
        or not SHA256_PATTERN.fullmatch(
            expected_sha256
        )
    ):
        raise ValueError(
            "A conversation payload "
            "has an invalid SHA-256."
        )

    try:
        payload = archive.read(
            payload_path
        )
    except KeyError as error:
        raise ValueError(
            "A referenced conversation "
            "payload is missing: "
            f"{payload_path}"
        ) from error

    actual_byte_length = len(
        payload
    )

    actual_sha256 = sha256_bytes(
        payload
    )

    if (
        actual_byte_length !=
        expected_byte_length
    ):
        raise ValueError(
            "Conversation payload size "
            "verification failed: "
            f"{payload_path}"
        )

    if (
        actual_sha256.lower()
        != expected_sha256.lower()
    ):
        raise ValueError(
            "Conversation payload hash "
            "verification failed: "
            f"{payload_path}"
        )

    return {
        "payloadPath":
            payload_path,
        "byteLength":
            actual_byte_length,
        "sha256":
            actual_sha256,
    }


def fetch_local_record(
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
            key,
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


def fetch_local_direct_record_keys(
    connection: sqlite3.Connection,
    composer_id: str,
) -> set[tuple[str, str]]:
    result: set[
        tuple[str, str]
    ] = set()

    for table_name in DATABASE_TABLES:
        rows = connection.execute(
            f"""
            SELECT key
            FROM {table_name}
            WHERE typeof(key) = 'text'
              AND key LIKE ?
            """,
            (
                f"%{composer_id}%",
            ),
        ).fetchall()

        for row in rows:
            result.add(
                (
                    table_name,
                    str(row["key"]),
                )
            )

    return result


def build_local_header_map(
    connection: sqlite3.Connection,
) -> dict[str, dict[str, Any]]:
    result: dict[
        str,
        dict[str, Any]
    ] = {}

    for header in get_composer_headers(
        connection
    ):
        composer_id = get_string(
            header.get(
                "composerId"
            )
        )

        if not composer_id:
            continue

        if composer_id in result:
            continue

        result[composer_id] = (
            header
        )

    return result


def get_destination_workspace_ids(
    composer_headers:
        list[dict[str, Any]],
    normalized_project_path: str,
) -> list[str]:
    workspace_ids: set[str] = set()

    ignored_workspace_ids = {
        "empty-window",
        "empty",
        "unknown",
    }

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

        workspace_identifier = (
            composer_header.get(
                "workspaceIdentifier"
            )
        )

        if not isinstance(
            workspace_identifier,
            dict,
        ):
            continue

        workspace_id = get_string(
            workspace_identifier.get(
                "id"
            )
        )

        if not workspace_id:
            continue

        normalized_workspace_id = (
            workspace_id
            .strip()
            .lower()
        )

        if (
            normalized_workspace_id
            in ignored_workspace_ids
        ):
            continue

        workspace_ids.add(
            workspace_id
        )

    return sorted(
        workspace_ids
    )


def compare_bundle_conversation(
    connection: sqlite3.Connection,
    local_header_map:
        dict[str, dict[str, Any]],
    bundle_conversation:
        dict[str, Any],
) -> dict[str, Any]:
    composer_id = get_string(
        bundle_conversation.get(
            "composerId"
        )
    )

    if not composer_id:
        raise ValueError(
            "A bundle conversation "
            "does not have a composer ID."
        )

    header_entry = (
        bundle_conversation.get(
            "header"
        )
    )

    if not isinstance(
        header_entry,
        dict,
    ):
        raise ValueError(
            "A bundle conversation "
            "does not contain a header entry."
        )

    expected_header_sha256 = (
        get_string(
            header_entry.get(
                "sha256"
            )
        )
    )

    if (
        expected_header_sha256 is None
        or not SHA256_PATTERN.fullmatch(
            expected_header_sha256
        )
    ):
        raise ValueError(
            "A bundle conversation "
            "header SHA-256 is invalid."
        )

    local_header = (
        local_header_map.get(
            composer_id
        )
    )

    local_header_exists = (
        local_header is not None
    )

    header_matches = False

    if local_header is not None:
        local_header_sha256 = (
            sha256_bytes(
                canonical_json_bytes(
                    local_header
                )
            )
        )

        header_matches = (
            local_header_sha256.lower()
            == expected_header_sha256.lower()
        )

    records = (
        bundle_conversation.get(
            "records"
        )
    )

    if not isinstance(
        records,
        list,
    ):
        raise ValueError(
            "A bundle conversation "
            "contains an invalid record list."
        )

    expected_record_identities: set[
        tuple[str, str]
    ] = set()

    missing_record_keys: list[str] = []
    changed_record_keys: list[str] = []
    matching_record_count = 0

    for record in records:
        if not isinstance(
            record,
            dict,
        ):
            raise ValueError(
                "A bundle conversation "
                "contains an invalid record."
            )

        table_name = get_string(
            record.get(
                "tableName"
            )
        )

        key = get_string(
            record.get("key")
        )

        expected_sqlite_type = (
            get_string(
                record.get(
                    "sqliteType"
                )
            )
        )

        expected_sha256 = (
            get_string(
                record.get(
                    "sha256"
                )
            )
        )

        expected_byte_length = (
            record.get(
                "byteLength"
            )
        )

        if (
            table_name is None
            or key is None
            or expected_sqlite_type
                is None
            or expected_sha256 is None
            or not SHA256_PATTERN
                .fullmatch(
                    expected_sha256
                )
            or not isinstance(
                expected_byte_length,
                int,
            )
            or isinstance(
                expected_byte_length,
                bool,
            )
            or expected_byte_length < 0
        ):
            raise ValueError(
                "A bundle record "
                "contains invalid metadata."
            )

        validate_table_name(
            table_name
        )

        identity = (
            table_name,
            key,
        )

        expected_record_identities.add(
            identity
        )

        local_row = fetch_local_record(
            connection,
            table_name,
            key,
        )

        location = (
            f"{table_name}:{key}"
        )

        if local_row is None:
            missing_record_keys.append(
                location
            )

            continue

        local_raw_value = (
            normalize_sqlite_blob(
                local_row["raw_value"]
            )
        )

        local_sha256 = sha256_bytes(
            local_raw_value
        )

        local_byte_length = len(
            local_raw_value
        )

        local_sqlite_type = str(
            local_row[
                "sqlite_type"
            ]
        )

        if (
            local_sha256.lower()
                != expected_sha256.lower()
            or local_byte_length
                != expected_byte_length
            or local_sqlite_type
                != expected_sqlite_type
        ):
            changed_record_keys.append(
                location
            )

            continue

        matching_record_count += 1

    local_direct_record_identities = (
        fetch_local_direct_record_keys(
            connection,
            composer_id,
        )
    )

    extra_direct_record_keys = sorted(
        (
            f"{table_name}:{key}"
            for (
                table_name,
                key,
            ) in (
                local_direct_record_identities
                - expected_record_identities
            )
        )
    )

    has_any_local_state = (
        local_header_exists
        or len(
            local_direct_record_identities
        ) > 0
    )

    if not has_any_local_state:
        status = "new"
        recommended_action = "import"

    elif (
        header_matches
        and not missing_record_keys
        and not changed_record_keys
        and not extra_direct_record_keys
    ):
        status = "identical"
        recommended_action = "skip"

    else:
        status = "conflict"
        recommended_action = "review"

    return {
        "composerId":
            composer_id,
        "status":
            status,
        "recommendedAction":
            recommended_action,
        "localHeaderExists":
            local_header_exists,
        "headerMatches":
            header_matches,
        "bundleRecordCount":
            len(records),
        "localDirectRecordCount":
            len(
                local_direct_record_identities
            ),
        "matchingRecordCount":
            matching_record_count,
        "missingRecordCount":
            len(
                missing_record_keys
            ),
        "changedRecordCount":
            len(
                changed_record_keys
            ),
        "extraDirectRecordCount":
            len(
                extra_direct_record_keys
            ),
        "missingRecordKeys":
            sorted(
                missing_record_keys
            ),
        "changedRecordKeys":
            sorted(
                changed_record_keys
            ),
        "extraDirectRecordKeys":
            extra_direct_record_keys,
        "createdAt":
            get_number(
                bundle_conversation.get(
                    "createdAt"
                )
            ),
        "lastUpdatedAt":
            get_number(
                bundle_conversation.get(
                    "lastUpdatedAt"
                )
            ),
        "type":
            get_string(
                bundle_conversation.get(
                    "type"
                )
            ),
        "unifiedMode":
            get_string(
                bundle_conversation.get(
                    "unifiedMode"
                )
            ),
    }


def validate_bundle(
    bundle_path_string: str,
    destination_database_path_string:
        str,
    destination_project_path_string:
        str,
) -> dict[str, Any]:
    bundle_path = Path(
        bundle_path_string
    ).expanduser()

    destination_database_path = Path(
        destination_database_path_string
    ).expanduser()

    if not bundle_path.is_file():
        raise FileNotFoundError(
            "The decrypted bundle "
            f"was not found: {bundle_path}"
        )

    if (
        not destination_database_path
        .is_file()
    ):
        raise FileNotFoundError(
            "The destination Cursor "
            "database was not found: "
            f"{destination_database_path}"
        )

    normalized_destination_path = (
        normalize_local_path(
            destination_project_path_string
        )
    )

    if normalized_destination_path is None:
        raise ValueError(
            "The destination project "
            "path is invalid."
        )

    bundle_file_sha256 = hashlib.sha256(
        bundle_path.read_bytes()
    ).hexdigest()

    with zipfile.ZipFile(
        bundle_path,
        mode="r",
    ) as archive:
        broken_entry = archive.testzip()

        if broken_entry is not None:
            raise ValueError(
                "The conversation bundle ZIP "
                "is damaged at: "
                f"{broken_entry}"
            )

        for archive_name in (
            archive.namelist()
        ):
            validate_archive_path(
                archive_name
            )

        (
            bundle_manifest,
            bundle_manifest_bytes,
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
            raise ValueError(
                "The bundle manifest "
                "does not contain conversations."
            )

        verified_payload_count = 0
        verified_payload_byte_length = 0

        for conversation in conversations:
            if not isinstance(
                conversation,
                dict,
            ):
                raise ValueError(
                    "The bundle contains "
                    "an invalid conversation."
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
                raise ValueError(
                    "A bundle conversation "
                    "does not contain a header."
                )

            header_result = (
                validate_payload_entry(
                    archive,
                    header_entry,
                )
            )

            verified_payload_count += 1
            verified_payload_byte_length += (
                int(
                    header_result[
                        "byteLength"
                    ]
                )
            )

            records = conversation.get(
                "records"
            )

            if not isinstance(
                records,
                list,
            ):
                raise ValueError(
                    "A bundle conversation "
                    "contains an invalid record list."
                )

            for record in records:
                if not isinstance(
                    record,
                    dict,
                ):
                    raise ValueError(
                        "A bundle conversation "
                        "contains an invalid record."
                    )

                record_result = (
                    validate_payload_entry(
                        archive,
                        record,
                    )
                )

                verified_payload_count += 1
                verified_payload_byte_length += (
                    int(
                        record_result[
                            "byteLength"
                        ]
                    )
                )

    connection = sqlite3.connect(
        create_read_only_uri(
            destination_database_path
        ),
        uri=True,
        timeout=10.0,
    )

    connection.row_factory = sqlite3.Row

    try:
        connection.execute(
            "PRAGMA query_only = ON"
        )

        local_headers = (
            get_composer_headers(
                connection
            )
        )

        local_header_map = (
            build_local_header_map(
                connection
            )
        )

        destination_workspace_ids = (
            get_destination_workspace_ids(
                local_headers,
                normalized_destination_path,
            )
        )

        import_plan = [
            compare_bundle_conversation(
                connection,
                local_header_map,
                conversation,
            )
            for conversation
            in conversations
            if isinstance(
                conversation,
                dict,
            )
        ]

    finally:
        connection.close()

    source = bundle_manifest.get(
        "source"
    )

    source_project_path: str | None = None

    if isinstance(source, dict):
        source_project_path = get_string(
            source.get(
                "projectPath"
            )
        )

    normalized_source_path = (
        normalize_local_path(
            source_project_path
        )
        if source_project_path
        else None
    )

    same_normalized_project_path = (
        normalized_source_path is not None
        and normalized_source_path
        == normalized_destination_path
    )

    new_count = sum(
        1
        for item in import_plan
        if item["status"] == "new"
    )

    identical_count = sum(
        1
        for item in import_plan
        if item["status"]
        == "identical"
    )

    conflict_count = sum(
        1
        for item in import_plan
        if item["status"]
        == "conflict"
    )

    return {
        "ok":
            True,
        "validationVersion":
            1,
        "validatedAt":
            utc_now_iso(),
        "bundle": {
            "path":
                str(
                    bundle_path.resolve()
                ),
            "sha256":
                bundle_file_sha256,
            "format":
                bundle_manifest[
                    "bundleFormat"
                ],
            "version":
                bundle_manifest[
                    "bundleVersion"
                ],
            "generatedAt":
                bundle_manifest.get(
                    "generatedAt"
                ),
            "manifestSha256":
                sha256_bytes(
                    bundle_manifest_bytes
                ),
            "verifiedPayloadCount":
                verified_payload_count,
            "verifiedPayloadByteLength":
                verified_payload_byte_length,
        },
        "source": {
            "projectPath":
                source_project_path,
        },
        "destination": {
            "projectPath":
                os.path.abspath(
                    destination_project_path_string
                ),
            "databasePath":
                str(
                    destination_database_path
                    .resolve()
                ),
            "workspaceIds":
                destination_workspace_ids,
            "sameNormalizedProjectPath":
                same_normalized_project_path,
        },
        "summary": {
            "conversationCount":
                len(import_plan),
            "newCount":
                new_count,
            "identicalCount":
                identical_count,
            "conflictCount":
                conflict_count,
            "recommendedImportCount":
                new_count,
            "recommendedSkipCount":
                identical_count,
            "requiresReviewCount":
                conflict_count,
            "verifiedPayloadCount":
                verified_payload_count,
            "verifiedPayloadByteLength":
                verified_payload_byte_length,
        },
        "conversations":
            import_plan,
    }


def main() -> int:
    if len(sys.argv) != 4:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": (
                        "Expected a decrypted "
                        "bundle path, destination "
                        "database path and destination "
                        "project path."
                    ),
                }
            )
        )

        return 2

    try:
        result = validate_bundle(
            sys.argv[1],
            sys.argv[2],
            sys.argv[3],
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
                    "error":
                        str(error),
                },
                ensure_ascii=False,
            )
        )

        return 1


if __name__ == "__main__":
    raise SystemExit(main())