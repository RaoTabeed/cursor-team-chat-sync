from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import build_conversation_bundle_manifest
import export_conversation_bundle

from workspace_conversation_header_resolver import (
    resolve_project_headers,
)


def delete_empty_bundle(
    result: dict[str, Any],
) -> None:
    bundle_path_value = result.get(
        "bundlePath"
    )

    if not isinstance(
        bundle_path_value,
        str,
    ):
        return

    try:
        Path(
            bundle_path_value
        ).unlink(
            missing_ok=True
        )
    except OSError:
        pass


def export_workspace_bundle(
    global_database_path: str,
    project_path: str,
    output_root: str,
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

    original_manifest_header_loader = (
        build_conversation_bundle_manifest
        .get_composer_headers
    )

    original_export_header_loader = (
        export_conversation_bundle
        .get_composer_headers
    )

    def workspace_header_loader(
        _connection: Any,
    ) -> list[dict[str, Any]]:
        return resolved_headers

    build_conversation_bundle_manifest.get_composer_headers = (
        workspace_header_loader
    )

    export_conversation_bundle.get_composer_headers = (
        workspace_header_loader
    )

    try:
        result = (
            export_conversation_bundle
            .export_bundle(
                global_database_path,
                project_path,
                output_root,
            )
        )

    finally:
        build_conversation_bundle_manifest.get_composer_headers = (
            original_manifest_header_loader
        )

        export_conversation_bundle.get_composer_headers = (
            original_export_header_loader
        )

    conversation_count = int(
        result.get(
            "conversationCount",
            0,
        )
    )

    if conversation_count <= 0:
        delete_empty_bundle(
            result
        )

        raise RuntimeError(
            "No synchronized conversations were "
            "exported. The upload was stopped before "
            "encryption and cloud storage. Open the "
            "project in Cursor, create or continue an "
            "Agent conversation, wait for the response, "
            "close Cursor normally, reopen the project "
            "and retry."
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
    if len(sys.argv) != 4:
        print(
            json.dumps(
                {
                    "ok":
                        False,

                    "error":
                        (
                            "Expected a global database "
                            "path, project path and output "
                            "directory."
                        ),
                }
            )
        )

        return 2

    try:
        result = export_workspace_bundle(
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