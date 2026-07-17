import * as vscode from "vscode";

import type {
  CursorStorageLocator
} from "../cursor/cursorStorageLocator";

import type {
  CursorWorkspaceStorage
} from "../cursor/cursorStorageTypes";

import type {
  OutputLogger
} from "../logging/outputLogger";

export class InspectCursorStorageCommand {
  public constructor(
    private readonly storageLocator:
      CursorStorageLocator,
    private readonly logger:
      OutputLogger
  ) {}

  public async execute(): Promise<void> {
    this.logger.show();

    this.logger.info(
      "Inspecting local Cursor storage in read-only mode..."
    );

    try {
      const result =
        await this.storageLocator.inspect();

      this.logger.info(
        `Platform: ${result.platform}`
      );

      this.logger.info(
        `Cursor user-data directory: ${result.userDataDirectory}`
      );

      this.logger.info(
        `Global database: ${result.globalDatabasePath}`
      );

      this.logger.info(
        `Global database found: ${
          result.globalDatabaseExists
            ? "Yes"
            : "No"
        }`
      );

      this.logger.info(
        `Workspace storage directory: ${result.workspaceStorageDirectory}`
      );

      this.logger.info(
        `Workspace storage found: ${
          result.workspaceStorageExists
            ? "Yes"
            : "No"
        }`
      );

      this.logger.info(
        `Workspace databases found: ${
          result.workspaces.length
        }`
      );

      for (
        const workspace of
        result.workspaces
      ) {
        this.logWorkspace(workspace);
      }

      if (!result.globalDatabaseExists) {
        await vscode.window.showWarningMessage(
          "Cursor Team Chat Sync could not find the global Cursor database. Check the Output panel."
        );

        return;
      }

      const mappedWorkspaceCount =
        result.workspaces.filter(
          (workspace) =>
            workspace.projectPath !==
            undefined
        ).length;

      await vscode.window.showInformationMessage(
        `Cursor storage detected. Mapped ${mappedWorkspaceCount} of ${result.workspaces.length} workspace database(s) to local projects.`
      );
    } catch (error) {
      this.logger.error(
        "Cursor storage inspection failed.",
        error
      );

      await vscode.window.showErrorMessage(
        "Cursor storage inspection failed. Check the Output panel."
      );
    }
  }

  private logWorkspace(
    workspace: CursorWorkspaceStorage
  ): void {
    this.logger.info(
      "----------------------------------------"
    );

    this.logger.info(
      `Workspace ID: ${workspace.workspaceId}`
    );

    this.logger.info(
      `Workspace kind: ${workspace.workspaceKind}`
    );

    this.logger.info(
      `Project URI: ${
        workspace.projectUri ??
        "Not available"
      }`
    );

    this.logger.info(
      `Project path: ${
        workspace.projectPath ??
        "Not mapped"
      }`
    );

    this.logger.info(
      `Database: ${workspace.databasePath}`
    );

    this.logger.info(
      `workspace.json found: ${
        workspace.workspaceJsonExists
          ? "Yes"
          : "No"
      }`
    );

    if (workspace.mappingError) {
      this.logger.error(
        `Workspace mapping failed for ${workspace.workspaceId}: ${workspace.mappingError}`
      );
    }
  }
}