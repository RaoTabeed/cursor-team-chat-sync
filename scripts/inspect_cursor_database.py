from __future__ import annotations

import hashlib
import json
import sqlite3
import sys
from collections import Counter
from pathlib import Path
from typing import Any


CONVERSATION_PATTERNS: dict[str, str] = {
    "composer": "%composer%",
    "composerData": "composerData:%",
    "bubbleId": "bubbleId:%",
    "checkpointId": "checkpointId:%",
    "messageRequestContext": "messageRequestContext:%",
    "conversation": "%conversation%",
    "chat": "%chat%",
    "agent": "%agent%",
    "head": "%head%",
}


RECORD_FAMILY_SPECS: list[dict[str, Any]] = [
    {
        "name": "composerHeaders",
        "matchMode": "exact",
        "pattern": "composer.composerHeaders",
        "sampleLimit": 1,
    },
    {
        "name": "composerMetadata",
        "matchMode": "like",
        "pattern": "composer.%",
        "sampleLimit": 8,
    },
    {
        "name": "composerData",
        "matchMode": "like",
        "pattern": "composerData:%",
        "sampleLimit": 8,
    },
    {
        "name": "bubbleId",
        "matchMode": "like",
        "pattern": "bubbleId:%",
        "sampleLimit": 10,
    },
    {
        "name": "checkpointId",
        "matchMode": "like",
        "pattern": "checkpointId:%",
        "sampleLimit": 8,
    },
    {
        "name": "agentKvBlob",
        "matchMode": "like",
        "pattern": "agentKv:blob:%",
        "sampleLimit": 10,
    },
]


def quote_identifier(identifier: str) -> str:
    """
    Safely quote an SQLite identifier.
    """
    return '"' + identifier.replace('"', '""') + '"'


def create_read_only_uri(
    database_path: Path,
) -> str:
    """
    Create a read-only SQLite URI.
    """
    return (
        f"{database_path.resolve().as_uri()}"
        "?mode=ro"
    )


def get_table_columns(
    connection: sqlite3.Connection,
    table_name: str,
) -> list[dict[str, Any]]:
    quoted_table_name = quote_identifier(
        table_name
    )

    rows = connection.execute(
        f"PRAGMA table_info({quoted_table_name})"
    ).fetchall()

    return [
        {
            "cid": int(row["cid"]),
            "name": str(row["name"]),
            "type": str(row["type"]),
            "notNull": bool(row["notnull"]),
            "defaultValue": row["dflt_value"],
            "primaryKey": bool(row["pk"]),
        }
        for row in rows
    ]


def get_key_prefix(key: str) -> str:
    for separator in (
        ":",
        "|",
        "/",
        ".",
    ):
        if separator in key:
            first_part = key.split(
                separator,
                1,
            )[0]

            return f"{first_part}{separator}"

    return key[:80]


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


def parse_json_value(
    value: Any,
) -> tuple[
    bool,
    bool,
    Any | None,
]:
    """
    Return:
    - whether the value is valid UTF-8
    - whether it is valid JSON
    - the parsed JSON value
    """
    if isinstance(value, str):
        text_value = value

    elif isinstance(value, bytes):
        try:
            text_value = value.decode(
                "utf-8"
            )
        except UnicodeDecodeError:
            return False, False, None

    else:
        return False, False, None

    try:
        parsed_value = json.loads(
            text_value
        )

        return True, True, parsed_value

    except json.JSONDecodeError:
        return True, False, None


def json_type_name(
    value: Any,
) -> str:
    if value is None:
        return "null"

    if isinstance(value, bool):
        return "boolean"

    if isinstance(value, dict):
        return "object"

    if isinstance(value, list):
        return "array"

    if isinstance(value, str):
        return "string"

    if isinstance(value, (int, float)):
        return "number"

    return type(value).__name__


def collect_json_schema_paths(
    value: Any,
    max_depth: int = 5,
    max_paths: int = 150,
) -> list[str]:
    """
    Collect JSON paths and value types without including
    any actual values.

    Example:
    $.messages[]:object
    $.messages[].id:string
    $.messages[].role:string
    """
    paths: set[str] = set()

    def walk(
        current_value: Any,
        current_path: str,
        depth: int,
    ) -> None:
        if len(paths) >= max_paths:
            return

        paths.add(
            f"{current_path}:"
            f"{json_type_name(current_value)}"
        )

        if depth >= max_depth:
            return

        if isinstance(current_value, dict):
            for key in sorted(
                current_value.keys(),
                key=str,
            )[:80]:
                child_path = (
                    f"{current_path}.{key}"
                )

                walk(
                    current_value[key],
                    child_path,
                    depth + 1,
                )

        elif isinstance(current_value, list):
            for item in current_value[:4]:
                walk(
                    item,
                    f"{current_path}[]",
                    depth + 1,
                )

    walk(
        value,
        "$",
        0,
    )

    return sorted(paths)


def collect_json_field_names(
    value: Any,
    counter: Counter[str],
    depth: int = 0,
    max_depth: int = 8,
) -> None:
    if depth > max_depth:
        return

    if isinstance(value, dict):
        for key, child_value in value.items():
            counter[str(key)] += 1

            collect_json_field_names(
                child_value,
                counter,
                depth + 1,
                max_depth,
            )

    elif isinstance(value, list):
        for child_value in value[:20]:
            collect_json_field_names(
                child_value,
                counter,
                depth + 1,
                max_depth,
            )


def detect_encoding_hint(
    raw_bytes: bytes,
    is_utf8: bool,
    is_json: bool,
    value: Any,
) -> str:
    if value is None:
        return "null"

    if is_json:
        return "utf8-json"

    if is_utf8:
        return "utf8-text"

    if raw_bytes.startswith(b"\x1f\x8b"):
        return "gzip"

    if raw_bytes.startswith(
        b"\x28\xb5\x2f\xfd"
    ):
        return "zstd"

    if raw_bytes.startswith(b"PK"):
        return "zip"

    return "binary-unknown"


def inspect_record(
    key: str,
    value: Any,
    storage_type: str,
) -> dict[str, Any]:
    raw_bytes = value_to_bytes(value)

    (
        is_utf8,
        is_json,
        parsed_json,
    ) = parse_json_value(value)

    json_schema_paths: list[str] = []
    json_top_level_type: str | None = None

    if is_json:
        json_top_level_type = (
            json_type_name(parsed_json)
        )

        json_schema_paths = (
            collect_json_schema_paths(
                parsed_json
            )
        )

    encoding_hint = detect_encoding_hint(
        raw_bytes,
        is_utf8,
        is_json,
        value,
    )

    first_bytes_hex = (
        None
        if is_utf8
        else raw_bytes[:16].hex()
    )

    return {
        "key": key,
        "storageType": storage_type,
        "byteLength": len(raw_bytes),
        "valueSha256": hashlib.sha256(
            raw_bytes
        ).hexdigest(),
        "encodingHint": encoding_hint,
        "isUtf8": is_utf8,
        "isJson": is_json,
        "jsonTopLevelType":
            json_top_level_type,
        "jsonSchemaPaths":
            json_schema_paths,
        "firstBytesHex":
            first_bytes_hex,
    }


def get_pattern_counts(
    connection: sqlite3.Connection,
    table_name: str,
) -> dict[str, int]:
    quoted_table_name = quote_identifier(
        table_name
    )

    counts: dict[str, int] = {}

    for (
        pattern_name,
        pattern_value,
    ) in CONVERSATION_PATTERNS.items():
        row = connection.execute(
            f"""
            SELECT COUNT(*) AS count
            FROM {quoted_table_name}
            WHERE typeof(key) = 'text'
              AND key LIKE ?
            """,
            (pattern_value,),
        ).fetchone()

        counts[pattern_name] = (
            int(row["count"])
            if row is not None
            else 0
        )

    return counts


def inspect_record_family(
    connection: sqlite3.Connection,
    table_name: str,
    family_spec: dict[str, Any],
) -> dict[str, Any]:
    quoted_table_name = quote_identifier(
        table_name
    )

    match_mode = str(
        family_spec["matchMode"]
    )

    pattern = str(
        family_spec["pattern"]
    )

    sample_limit = int(
        family_spec["sampleLimit"]
    )

    operator = (
        "="
        if match_mode == "exact"
        else "LIKE"
    )

    rows = connection.execute(
        f"""
        SELECT
            key,
            value,
            typeof(value) AS storage_type
        FROM {quoted_table_name}
        WHERE typeof(key) = 'text'
          AND key {operator} ?
        ORDER BY key
        """,
        (pattern,),
    ).fetchall()

    utf8_record_count = 0
    json_record_count = 0

    field_name_counter: Counter[str] = Counter()

    samples: list[dict[str, Any]] = []

    for index, row in enumerate(rows):
        value = row["value"]

        (
            is_utf8,
            is_json,
            parsed_json,
        ) = parse_json_value(value)

        if is_utf8:
            utf8_record_count += 1

        if is_json:
            json_record_count += 1

            collect_json_field_names(
                parsed_json,
                field_name_counter,
            )

        if index < sample_limit:
            samples.append(
                inspect_record(
                    str(row["key"]),
                    value,
                    str(row["storage_type"]),
                )
            )

    top_json_field_names = [
        {
            "name": field_name,
            "count": count,
        }
        for (
            field_name,
            count,
        ) in field_name_counter.most_common(
            40
        )
    ]

    return {
        "name": str(
            family_spec["name"]
        ),
        "matchMode": match_mode,
        "pattern": pattern,
        "rowCount": len(rows),
        "utf8RecordCount":
            utf8_record_count,
        "jsonRecordCount":
            json_record_count,
        "topJsonFieldNames":
            top_json_field_names,
        "samples": samples,
    }


def inspect_key_value_table(
    connection: sqlite3.Connection,
    table_name: str,
) -> dict[str, Any]:
    quoted_table_name = quote_identifier(
        table_name
    )

    columns = get_table_columns(
        connection,
        table_name,
    )

    row_count_row = connection.execute(
        f"""
        SELECT COUNT(*) AS count
        FROM {quoted_table_name}
        """
    ).fetchone()

    row_count = (
        int(row_count_row["count"])
        if row_count_row is not None
        else 0
    )

    key_rows = connection.execute(
        f"""
        SELECT key
        FROM {quoted_table_name}
        WHERE typeof(key) = 'text'
        """
    ).fetchall()

    prefix_counts = Counter(
        get_key_prefix(
            str(row["key"])
        )
        for row in key_rows
    )

    top_key_prefixes = [
        {
            "prefix": prefix,
            "count": count,
        }
        for (
            prefix,
            count,
        ) in prefix_counts.most_common(
            30
        )
    ]

    storage_rows = connection.execute(
        f"""
        SELECT
            typeof(value) AS storage_type,
            COUNT(*) AS count
        FROM {quoted_table_name}
        GROUP BY typeof(value)
        ORDER BY storage_type
        """
    ).fetchall()

    value_storage_counts = {
        str(row["storage_type"]):
            int(row["count"])
        for row in storage_rows
    }

    record_families = [
        inspect_record_family(
            connection,
            table_name,
            family_spec,
        )
        for family_spec
        in RECORD_FAMILY_SPECS
    ]

    return {
        "name": table_name,
        "columns": columns,
        "rowCount": row_count,
        "patternCounts":
            get_pattern_counts(
                connection,
                table_name,
            ),
        "valueStorageCounts":
            value_storage_counts,
        "topKeyPrefixes":
            top_key_prefixes,
        "recordFamilies":
            record_families,
    }


def inspect_database(
    database_path_string: str,
) -> dict[str, Any]:
    database_path = Path(
        database_path_string
    ).expanduser()

    if not database_path.exists():
        raise FileNotFoundError(
            f"Database file does not exist: "
            f"{database_path}"
        )

    if not database_path.is_file():
        raise ValueError(
            f"Database path is not a file: "
            f"{database_path}"
        )

    database_uri = create_read_only_uri(
        database_path
    )

    connection = sqlite3.connect(
        database_uri,
        uri=True,
        timeout=5.0,
    )

    connection.row_factory = sqlite3.Row

    try:
        connection.execute(
            "PRAGMA query_only = ON"
        )

        journal_mode_row = connection.execute(
            "PRAGMA journal_mode"
        ).fetchone()

        journal_mode = (
            str(journal_mode_row[0])
            if journal_mode_row is not None
            else "unknown"
        )

        schema_rows = connection.execute(
            """
            SELECT
                name,
                type,
                sql
            FROM sqlite_master
            WHERE type IN ('table', 'view')
              AND name NOT LIKE 'sqlite_%'
            ORDER BY type, name
            """
        ).fetchall()

        tables: list[dict[str, Any]] = []
        table_names: set[str] = set()

        for schema_row in schema_rows:
            object_name = str(
                schema_row["name"]
            )

            object_type = str(
                schema_row["type"]
            )

            table_names.add(object_name)

            tables.append(
                {
                    "name": object_name,
                    "type": object_type,
                    "columns":
                        get_table_columns(
                            connection,
                            object_name,
                        )
                        if object_type == "table"
                        else [],
                }
            )

        key_value_tables = []

        for table_name in (
            "ItemTable",
            "cursorDiskKV",
        ):
            if table_name in table_names:
                key_value_tables.append(
                    inspect_key_value_table(
                        connection,
                        table_name,
                    )
                )

        return {
            "ok": True,
            "databasePath":
                str(database_path.resolve()),
            "databaseSizeBytes":
                database_path.stat().st_size,
            "journalMode": journal_mode,
            "tables": tables,
            "keyValueTables":
                key_value_tables,
        }

    finally:
        connection.close()


def main() -> int:
    if len(sys.argv) != 2:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error":
                        "Expected one database path.",
                }
            )
        )

        return 2

    try:
        result = inspect_database(
            sys.argv[1]
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