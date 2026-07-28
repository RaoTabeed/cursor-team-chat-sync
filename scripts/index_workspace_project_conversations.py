from __future__ import annotations

import json
import sys
from typing import Any

import index_project_conversations

from workspace_conversation_header_resolver import (
    resolve_project_headers,
)


def index_workspace_project_conversations(
    global_database_path: str,
    project_path: str,
) -> dict[str, Any]:
    resolution = resolve_project_headers(
        global_database_path,
        project_path,
    )

    resolved_headers = resolution[
        "headers"
    ]

    if not isinstance(
        resolved_headers,
        list,
    ):
        raise RuntimeError(
            "Workspace header resolution "
            "returned an invalid result."
        )

    original_header_loader = (
        index_project_conversations
        .get_composer_headers
    )

    def workspace_header_loader(
        _connection: Any,
    ) -> list[dict[str, Any]]:
        return resolved_headers

    index_project_conversations.get_composer_headers = (
        workspace_header_loader
    )

    try:
        result = (
            index_project_conversations
            .inspect_project_conversations(
                global_database_path,
                project_path,
            )
        )

    finally:
        index_project_conversations.get_composer_headers = (
            original_header_loader
        )

    result[
        "workspaceId"
    ] = resolution[
        "workspaceId"
    ]

    result[
        "workspaceDatabasePath"
    ] = resolution[
        "workspaceDatabasePath"
    ]

    result[
        "globalHeaderCount"
    ] = resolution[
        "globalHeaderCount"
    ]

    result[
        "workspaceHeaderCount"
    ] = resolution[
        "workspaceHeaderCount"
    ]

    result[
        "resolvedHeaderCount"
    ] = resolution[
        "resolvedHeaderCount"
    ]

    result[
        "workspaceOnlyComposerIds"
    ] = resolution[
        "workspaceOnlyComposerIds"
    ]

    result[
        "conversationDetectionSource"
    ] = (
        "workspace-composer-data"
    )

    return result


def main() -> int:
    if len(sys.argv) != 3:
        print(
            json.dumps(
                {
                    "ok":
                        False,

                    "error":
                        (
                            "Expected a global database "
                            "path and project path."
                        ),
                }
            )
        )

        return 2

    try:
        result = (
            index_workspace_project_conversations(
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
                    "ok":
                        False,

                    "error":
                        str(
                            error
                        ),
                },
                ensure_ascii=False,
            )
        )

        return 1


if __name__ == "__main__":
    raise SystemExit(
        main()
    )