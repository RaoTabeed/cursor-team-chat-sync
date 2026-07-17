from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from build_conversation_bundle_manifest import (
    DATABASE_TABLES,
    build_project_manifest,
    classify_record_family,
)

from index_project_conversations import (
    create_read_only_uri,
    get_composer_headers,
)


BUNDLE_FORMAT = "cursor-team-chat-sync"
BUNDLE_VERSION = 1

MANIFEST_ENTRY_NAME = "bundle-manifest.json"


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


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(
        value
    ).hexdigest()


def sha256_file(file_path: Path) -> str:
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


def validate_table_name(
    table_name: str,
) -> None:
    if table_name not in DATABASE_TABLES:
        raise ValueError(
            "Unsupported SQLite table: "
            f"{table_name}"
        )


def get_string(value: Any) -> str | None:
    return value if isinstance(
        value,
        str,
    ) else None


def get_number(
    value: Any,
) -> int | float | None:
    if isinstance(value, bool):
        return None

    if isinstance(
        value,
        (int, float),
    ):
        return value

    return None


def get_boolean(value: Any) -> bool:
    return value if isinstance(
        value,
        bool,
    ) else False


def normalize_raw_value(
    value: Any,
) -> bytes:
    """
    Convert the result of CAST(value AS BLOB) into bytes.

    Cursor conversation values are normally TEXT or BLOB.
    """
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


def value_encoding(
    sqlite_type: str,
) -> str:
    if sqlite_type == "text":
        return "utf8"

    if sqlite_type == "blob":
        return "binary"

    if sqlite_type in (
        "integer",
        "real",
        "null",
    ):
        return "sqlite-cast"

    return "unknown"


def canonical_json_bytes(
    value: Any,
) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def project_directory_name(
    project_path: str,
) -> str:
    return hashlib.sha256(
        project_path.lower().encode(
            "utf-8"
        )
    ).hexdigest()[:24]


def conversation_directory_name(
    position: int,
    composer_id: str,
) -> str:
    composer_hash = hashlib.sha256(
        composer_id.encode("utf-8")
    ).hexdigest()[:16]

    return (
        f"conversations/"
        f"{position:04d}-{composer_hash}"
    )


def fetch_exact_record(
    connection: sqlite3.Connection,
    table_name: str,
    key: str,
) -> sqlite3.Row | None:
    """
    Retrieve the SQLite value as a BLOB.

    CAST(value AS BLOB) avoids returning raw chat text through
    the JSON response and gives the exporter binary payload data.
    """
    validate_table_name(table_name)

    return connection.execute(
        f"""
        SELECT
            key,
            typeof(value) AS sqlite_type,
            CAST(value AS BLOB) AS raw_value
        FROM {table_name}
        WHERE key = ?
        LIMIT 1
        """,
        (key,),
    ).fetchone()


def build_header_map(
    connection: sqlite3.Connection,
) -> dict[
    str,
    tuple[int, dict[str, Any]],
]:
    header_map: dict[
        str,
        tuple[int, dict[str, Any]],
    ] = {}

    headers = get_composer_headers(
        connection
    )

    for index, header in enumerate(
        headers
    ):
        composer_id = get_string(
            header.get("composerId")
        )

        if not composer_id:
            continue

        if composer_id in header_map:
            continue

        header_map[composer_id] = (
            index,
            header,
        )

    return header_map


def create_header_entry(
    archive: zipfile.ZipFile,
    conversation_directory: str,
    composer_id: str,
    original_index: int,
    header: dict[str, Any],
) -> dict[str, Any]:
    payload = canonical_json_bytes(
        header
    )

    payload_path = (
        f"{conversation_directory}/"
        "composer-header.json"
    )

    archive.writestr(
        payload_path,
        payload,
        compress_type=
            zipfile.ZIP_DEFLATED,
        compresslevel=9,
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
        "valueEncoding":
            "utf8-json",
        "originalIndex":
            original_index,
        "payloadPath":
            payload_path,
        "byteLength":
            len(payload),
        "sha256":
            sha256_bytes(payload),
    }


def create_record_entry(
    archive: zipfile.ZipFile,
    connection: sqlite3.Connection,
    conversation_directory: str,
    record_position: int,
    discovery_record:
        dict[str, Any],
) -> dict[str, Any]:
    table_name = str(
        discovery_record["tableName"]
    )

    key = str(
        discovery_record["key"]
    )

    row = fetch_exact_record(
        connection,
        table_name,
        key,
    )

    if row is None:
        raise RuntimeError(
            "A discovered SQLite record "
            "disappeared during export: "
            f"{table_name}:{key}"
        )

    sqlite_type = str(
        row["sqlite_type"]
    )

    raw_value = normalize_raw_value(
        row["raw_value"]
    )

    payload_path = (
        f"{conversation_directory}/"
        f"records/"
        f"{record_position:04d}.bin"
    )

    archive.writestr(
        payload_path,
        raw_value,
        compress_type=
            zipfile.ZIP_DEFLATED,
        compresslevel=9,
    )

    return {
        "recordKind":
            "sqlite-record",
        "tableName":
            table_name,
        "key":
            key,
        "recordFamily":
            classify_record_family(key),
        "sqliteType":
            sqlite_type,
        "valueEncoding":
            value_encoding(
                sqlite_type
            ),
        "payloadPath":
            payload_path,
        "byteLength":
            len(raw_value),
        "sha256":
            sha256_bytes(raw_value),
        "source":
            discovery_record.get(
                "source"
            ),
        "referenceDepth":
            discovery_record.get(
                "referenceDepth",
                0,
            ),
        "referencedBy":
            discovery_record.get(
                "referencedBy",
                [],
            ),
    }


def create_bundle_manifest(
    archive: zipfile.ZipFile,
    connection: sqlite3.Connection,
    project_manifest:
        dict[str, Any],
) -> dict[str, Any]:
    header_map = build_header_map(
        connection
    )

    exported_conversations: list[
        dict[str, Any]
    ] = []

    total_record_count = 0
    total_payload_byte_length = 0
    header_fragment_count = 0

    conversations = project_manifest.get(
        "conversations"
    )

    if not isinstance(
        conversations,
        list,
    ):
        raise RuntimeError(
            "Project manifest did not "
            "contain conversations."
        )

    for (
        conversation_position,
        discovered_conversation,
    ) in enumerate(
        conversations,
        start=1,
    ):
        if not isinstance(
            discovered_conversation,
            dict,
        ):
            continue

        composer_id = get_string(
            discovered_conversation.get(
                "composerId"
            )
        )

        if not composer_id:
            continue

        header_match = header_map.get(
            composer_id
        )

        if header_match is None:
            raise RuntimeError(
                "Composer header disappeared "
                "during export: "
                f"{composer_id}"
            )

        (
            original_header_index,
            composer_header,
        ) = header_match

        conversation_directory = (
            conversation_directory_name(
                conversation_position,
                composer_id,
            )
        )

        header_entry = (
            create_header_entry(
                archive,
                conversation_directory,
                composer_id,
                original_header_index,
                composer_header,
            )
        )

        header_fragment_count += 1

        total_payload_byte_length += int(
            header_entry["byteLength"]
        )

        discovered_records = (
            discovered_conversation.get(
                "records"
            )
        )

        if not isinstance(
            discovered_records,
            list,
        ):
            discovered_records = []

        exported_records: list[
            dict[str, Any]
        ] = []

        for (
            record_position,
            discovery_record,
        ) in enumerate(
            discovered_records,
            start=1,
        ):
            if not isinstance(
                discovery_record,
                dict,
            ):
                continue

            exported_record = (
                create_record_entry(
                    archive,
                    connection,
                    conversation_directory,
                    record_position,
                    discovery_record,
                )
            )

            exported_records.append(
                exported_record
            )

            total_record_count += 1

            total_payload_byte_length += int(
                exported_record[
                    "byteLength"
                ]
            )

        exported_conversations.append(
            {
                "composerId":
                    composer_id,
                "shouldUpload":
                    True,
                "isSystemPlaceholder":
                    False,
                "createdAt":
                    get_number(
                        discovered_conversation
                        .get("createdAt")
                    ),
                "lastUpdatedAt":
                    get_number(
                        discovered_conversation
                        .get(
                            "lastUpdatedAt"
                        )
                    ),
                "type":
                    get_string(
                        discovered_conversation
                        .get("type")
                    ),
                "unifiedMode":
                    get_string(
                        discovered_conversation
                        .get(
                            "unifiedMode"
                        )
                    ),
                "forceMode":
                    get_string(
                        discovered_conversation
                        .get(
                            "forceMode"
                        )
                    ),
                "isArchived":
                    get_boolean(
                        discovered_conversation
                        .get(
                            "isArchived"
                        )
                    ),
                "isDraft":
                    get_boolean(
                        discovered_conversation
                        .get("isDraft")
                    ),
                "isWorktree":
                    get_boolean(
                        discovered_conversation
                        .get(
                            "isWorktree"
                        )
                    ),
                "header":
                    header_entry,
                "records":
                    exported_records,
                "recordCount":
                    len(exported_records),
                "payloadByteLength":
                    int(
                        header_entry[
                            "byteLength"
                        ]
                    )
                    + sum(
                        int(
                            record[
                                "byteLength"
                            ]
                        )
                        for record
                        in exported_records
                    ),
            }
        )

    return {
        "bundleFormat":
            BUNDLE_FORMAT,
        "bundleVersion":
            BUNDLE_VERSION,
        "generatedAt":
            utc_now_iso(),
        "encrypted":
            False,
        "compression":
            "zip-deflate",
        "source": {
            "projectPath":
                project_manifest.get(
                    "projectPath"
                ),
            "databasePath":
                project_manifest.get(
                    "databasePath"
                ),
            "headersScanned":
                project_manifest.get(
                    "headersScanned"
                ),
            "matchedHeaderCount":
                project_manifest.get(
                    "matchedHeaderCount"
                ),
        },
        "summary": {
            "conversationCount":
                len(
                    exported_conversations
                ),
            "headerFragmentCount":
                header_fragment_count,
            "sqliteRecordCount":
                total_record_count,
            "totalPayloadCount":
                header_fragment_count
                + total_record_count,
            "totalPayloadByteLength":
                total_payload_byte_length,
            "systemPlaceholderCount":
                project_manifest.get(
                    "summary",
                    {},
                ).get(
                    "systemPlaceholderCount",
                    0,
                ),
        },
        "conversations":
            exported_conversations,
    }


def verify_payload(
    archive: zipfile.ZipFile,
    payload_entry:
        dict[str, Any],
) -> None:
    payload_path = str(
        payload_entry["payloadPath"]
    )

    expected_size = int(
        payload_entry["byteLength"]
    )

    expected_sha256 = str(
        payload_entry["sha256"]
    )

    payload = archive.read(
        payload_path
    )

    if len(payload) != expected_size:
        raise RuntimeError(
            "Bundle payload size "
            "verification failed: "
            f"{payload_path}"
        )

    actual_sha256 = sha256_bytes(
        payload
    )

    if actual_sha256 != expected_sha256:
        raise RuntimeError(
            "Bundle payload hash "
            "verification failed: "
            f"{payload_path}"
        )


def verify_bundle(
    bundle_path: Path,
) -> dict[str, Any]:
    with zipfile.ZipFile(
        bundle_path,
        mode="r",
    ) as archive:
        broken_entry = archive.testzip()

        if broken_entry is not None:
            raise RuntimeError(
                "ZIP integrity verification "
                "failed for entry: "
                f"{broken_entry}"
            )

        manifest_bytes = archive.read(
            MANIFEST_ENTRY_NAME
        )

        bundle_manifest = json.loads(
            manifest_bytes.decode(
                "utf-8"
            )
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
                "Bundle manifest does not "
                "contain conversations."
            )

        verified_payload_count = 0

        for conversation in conversations:
            if not isinstance(
                conversation,
                dict,
            ):
                continue

            header_entry = conversation.get(
                "header"
            )

            if not isinstance(
                header_entry,
                dict,
            ):
                raise RuntimeError(
                    "Conversation is missing "
                    "its header payload."
                )

            verify_payload(
                archive,
                header_entry,
            )

            verified_payload_count += 1

            records = conversation.get(
                "records"
            )

            if not isinstance(
                records,
                list,
            ):
                raise RuntimeError(
                    "Conversation records "
                    "are invalid."
                )

            for record in records:
                if not isinstance(
                    record,
                    dict,
                ):
                    continue

                verify_payload(
                    archive,
                    record,
                )

                verified_payload_count += 1

        manifest_sha256 = (
            sha256_bytes(
                manifest_bytes
            )
        )

        return {
            "verified":
                True,
            "verifiedPayloadCount":
                verified_payload_count,
            "manifestSha256":
                manifest_sha256,
            "bundleManifest":
                bundle_manifest,
        }


def export_bundle(
    database_path_string: str,
    project_path_string: str,
    output_root_string: str,
) -> dict[str, Any]:
    database_path = Path(
        database_path_string
    ).expanduser()

    output_root = Path(
        output_root_string
    ).expanduser()

    if not database_path.is_file():
        raise FileNotFoundError(
            "Global Cursor database "
            "was not found: "
            f"{database_path}"
        )

    project_manifest = (
        build_project_manifest(
            str(database_path),
            project_path_string,
        )
    )

    resolved_project_path = str(
        project_manifest[
            "projectPath"
        ]
    )

    bundle_directory = (
        output_root
        / "bundles"
        / project_directory_name(
            resolved_project_path
        )
    )

    bundle_directory.mkdir(
        parents=True,
        exist_ok=True,
    )

    bundle_filename = (
        f"{safe_timestamp()}."
        "cursor-chat-bundle"
    )

    final_bundle_path = (
        bundle_directory
        / bundle_filename
    )

    temporary_bundle_path = (
        bundle_directory
        / (
            f".{bundle_filename}."
            f"tmp-{os.getpid()}"
        )
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

        with zipfile.ZipFile(
            temporary_bundle_path,
            mode="w",
            compression=
                zipfile.ZIP_DEFLATED,
            compresslevel=9,
            allowZip64=True,
        ) as archive:
            bundle_manifest = (
                create_bundle_manifest(
                    archive,
                    connection,
                    project_manifest,
                )
            )

            manifest_bytes = (
                canonical_json_bytes(
                    bundle_manifest
                )
            )

            archive.writestr(
                MANIFEST_ENTRY_NAME,
                manifest_bytes,
                compress_type=
                    zipfile.ZIP_DEFLATED,
                compresslevel=9,
            )

        verification = verify_bundle(
            temporary_bundle_path
        )

        os.replace(
            temporary_bundle_path,
            final_bundle_path,
        )

        bundle_byte_length = (
            final_bundle_path.stat()
            .st_size
        )

        bundle_sha256 = sha256_file(
            final_bundle_path
        )

        verified_manifest = (
            verification[
                "bundleManifest"
            ]
        )

        summary = verified_manifest[
            "summary"
        ]

        return {
            "ok":
                True,
            "bundleFormat":
                BUNDLE_FORMAT,
            "bundleVersion":
                BUNDLE_VERSION,
            "generatedAt":
                verified_manifest[
                    "generatedAt"
                ],
            "bundlePath":
                str(
                    final_bundle_path.resolve()
                ),
            "bundleByteLength":
                bundle_byte_length,
            "bundleSha256":
                bundle_sha256,
            "manifestSha256":
                verification[
                    "manifestSha256"
                ],
            "conversationCount":
                summary[
                    "conversationCount"
                ],
            "headerFragmentCount":
                summary[
                    "headerFragmentCount"
                ],
            "sqliteRecordCount":
                summary[
                    "sqliteRecordCount"
                ],
            "totalPayloadCount":
                summary[
                    "totalPayloadCount"
                ],
            "totalPayloadByteLength":
                summary[
                    "totalPayloadByteLength"
                ],
            "verifiedPayloadCount":
                verification[
                    "verifiedPayloadCount"
                ],
            "verified":
                verification[
                    "verified"
                ],
            "encrypted":
                False,
        }

    except Exception:
        if temporary_bundle_path.exists():
            temporary_bundle_path.unlink(
                missing_ok=True
            )

        raise

    finally:
        connection.close()


def main() -> int:
    if len(sys.argv) != 4:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": (
                        "Expected a database "
                        "path, project path and "
                        "output directory."
                    ),
                }
            )
        )

        return 2

    try:
        result = export_bundle(
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
                    "error": str(error),
                },
                ensure_ascii=False,
            )
        )

        return 1


if __name__ == "__main__":
    raise SystemExit(main())