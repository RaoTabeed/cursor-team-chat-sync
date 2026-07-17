from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path
from typing import Any


def quote_identifier(identifier: str) -> str:
    """
    Safely quote an SQLite identifier such as a table name.

    SQL parameters can protect values, but they cannot be used
    for table or column names. We therefore escape embedded
    double quotes and wrap the identifier in double quotes.
    """
    return '"' + identifier.replace('"', '""') + '"'


def create_read_only_uri(database_path: Path) -> str:
    """
    Convert a normal local path into a read-only SQLite URI.

    Example:
    C:\\Data\\state.vscdb

    becomes:
    file:///C:/Data/state.vscdb?mode=ro
    """
    return f"{database_path.resolve().as_uri()}?mode=ro"


def get_table_columns(
    connection: sqlite3.Connection,
    table_name: str,
) -> list[dict[str, Any]]:
    quoted_table_name = quote_identifier(table_name)

    rows = connection.execute(
        f"PRAGMA table_info({quoted_table_name})"
    ).fetchall()

    return [
        {
            "cid": row["cid"],
            "name": row["name"],
            "type": row["type"],
            "notNull": bool(row["notnull"]),
            "defaultValue": row["dflt_value"],
            "primaryKey": bool(row["pk"]),
        }
        for row in rows
    ]


def get_item_table_inspection(
    connection: sqlite3.Connection,
    table_names: set[str],
) -> dict[str, Any] | None:
    if "ItemTable" not in table_names:
        return None

    columns = get_table_columns(
        connection,
        "ItemTable",
    )

    column_names = {
        str(column["name"])
        for column in columns
    }

    result: dict[str, Any] = {
        "columns": columns,
        "rowCount": 0,
        "keySamples": [],
        "conversationKeySamples": [],
        "patternCounts": {},
    }

    row_count = connection.execute(
        'SELECT COUNT(*) AS count FROM "ItemTable"'
    ).fetchone()

    result["rowCount"] = (
        int(row_count["count"])
        if row_count is not None
        else 0
    )

    if "key" not in column_names:
        return result

    key_rows = connection.execute(
        """
        SELECT key
        FROM ItemTable
        WHERE typeof(key) = 'text'
        ORDER BY key
        LIMIT 60
        """
    ).fetchall()

    result["keySamples"] = [
        str(row["key"])
        for row in key_rows
    ]

    conversation_rows = connection.execute(
        """
        SELECT key
        FROM ItemTable
        WHERE typeof(key) = 'text'
          AND (
            key LIKE '%composer%'
            OR key LIKE 'bubbleId:%'
            OR key LIKE 'checkpointId:%'
            OR key LIKE 'messageRequestContext:%'
            OR key LIKE '%conversation%'
            OR key LIKE '%chat%'
          )
        ORDER BY key
        LIMIT 100
        """
    ).fetchall()

    result["conversationKeySamples"] = [
        str(row["key"])
        for row in conversation_rows
    ]

    patterns = {
        "composer": "%composer%",
        "bubbleId": "bubbleId:%",
        "checkpointId": "checkpointId:%",
        "messageRequestContext":
            "messageRequestContext:%",
        "conversation": "%conversation%",
        "chat": "%chat%",
    }

    pattern_counts: dict[str, int] = {}

    for pattern_name, pattern_value in patterns.items():
        row = connection.execute(
            """
            SELECT COUNT(*) AS count
            FROM ItemTable
            WHERE typeof(key) = 'text'
              AND key LIKE ?
            """,
            (pattern_value,),
        ).fetchone()

        pattern_counts[pattern_name] = (
            int(row["count"])
            if row is not None
            else 0
        )

    result["patternCounts"] = pattern_counts

    return result


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
        # This adds another layer of protection.
        # SQLite rejects INSERT, UPDATE, DELETE and
        # other write operations on this connection.
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

        return {
            "ok": True,
            "databasePath":
                str(database_path.resolve()),
            "databaseSizeBytes":
                database_path.stat().st_size,
            "journalMode": journal_mode,
            "tables": tables,
            "itemTable":
                get_item_table_inspection(
                    connection,
                    table_names,
                ),
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