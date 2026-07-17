import * as vscode from "vscode";

import type {
  CursorStorageLocator
} from "../cursor/cursorStorageLocator";

import type {
  CursorDatabaseInspection
} from "../database/databaseInspectionTypes";

import type {
  CursorDatabaseInspectorService
} from "../database/cursorDatabaseInspectorService";

import type {
  OutputLogger
} from "../logging/outputLogger";

import type {
  CurrentProjectInspector
} from "../projects/currentProjectInspector";

export class InspectCursorDatabasesCommand {
  public constructor(
    private readonly projectInspector:
      CurrentProjectInspector,

    private readonly storageLocator:
      CursorStorageLocator,

    private readonly databaseInspector:
      CursorDatabaseInspectorService,

    private readonly logger:
      OutputLogger
  ) {}

  public async execute(): Promise<void> {
    this.logger.show();

    this.logger.info(
      "Inspecting Cursor databases in read-only mode..."
    );

    try {
      const project =
        await this.projectInspector.inspect();

      if (!project.cursorWorkspace) {
        await vscode.window
          .showWarningMessage(
            "No Cursor workspace database was matched to the selected project."
          );

        this.logger.info(
          "Database inspection stopped because no matching project workspace database was found."
        );

        return;
      }

      const storage =
        await this.storageLocator.inspect();

      this.logger.info(
        "Inspecting global Cursor database..."
      );

      const globalInspection =
        await this.databaseInspector.inspect(
          storage.globalDatabasePath
        );

      this.logDatabaseInspection(
        "GLOBAL CURSOR DATABASE",
        globalInspection
      );

      this.logger.info(
        "Inspecting current project workspace database..."
      );

      const workspaceInspection =
        await this.databaseInspector.inspect(
          project.cursorWorkspace
            .databasePath
        );

      this.logDatabaseInspection(
        "CURRENT PROJECT WORKSPACE DATABASE",
        workspaceInspection
      );

      await vscode.window
        .showInformationMessage(
          "Cursor databases inspected successfully in read-only mode."
        );
    } catch (error) {
      if (
        this.isCancellationError(error)
      ) {
        this.logger.info(
          "Database inspection was cancelled."
        );

        return;
      }

      this.logger.error(
        "Cursor database inspection failed.",
        error
      );

      await vscode.window
        .showErrorMessage(
          "Cursor database inspection failed. Check the Output panel."
        );
    }
  }

  private logDatabaseInspection(
    heading: string,
    inspection:
      CursorDatabaseInspection
  ): void {
    this.logger.info(
      "========================================"
    );

    this.logger.info(heading);

    this.logger.info(
      `Database path: ${inspection.databasePath}`
    );

    this.logger.info(
      `Database size: ${this.formatBytes(
        inspection.databaseSizeBytes
      )}`
    );

    this.logger.info(
      `Journal mode: ${inspection.journalMode}`
    );

    this.logger.info(
      `Tables/views found: ${inspection.tables.length}`
    );

    for (
      const table of
      inspection.tables
    ) {
      const columns =
        table.columns
          .map(
            (column) =>
              `${column.name}:${column.type || "untyped"}`
          )
          .join(", ");

      this.logger.info(
        `${table.type}: ${table.name}`
      );

      if (columns) {
        this.logger.info(
          `  Columns: ${columns}`
        );
      }
    }

    if (!inspection.itemTable) {
      this.logger.info(
        "ItemTable was not found."
      );

      return;
    }

    this.logger.info(
      `ItemTable rows: ${inspection.itemTable.rowCount}`
    );

    this.logger.info(
      "Conversation-related key counts:"
    );

    const patternEntries =
      Object.entries(
        inspection.itemTable
          .patternCounts
      );

    for (
      const [
        patternName,
        count
      ] of patternEntries
    ) {
      this.logger.info(
        `  ${patternName}: ${count ?? 0}`
      );
    }

    this.logger.info(
      `Conversation-related key samples: ${
        inspection.itemTable
          .conversationKeySamples
          .length
      }`
    );

    for (
      const key of
      inspection.itemTable
        .conversationKeySamples
    ) {
      this.logger.info(
        `  Key: ${key}`
      );
    }
  }

  private formatBytes(
    bytes: number
  ): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }

    const kilobytes =
      bytes / 1024;

    if (kilobytes < 1024) {
      return `${kilobytes.toFixed(
        2
      )} KB`;
    }

    const megabytes =
      kilobytes / 1024;

    if (megabytes < 1024) {
      return `${megabytes.toFixed(
        2
      )} MB`;
    }

    const gigabytes =
      megabytes / 1024;

    return `${gigabytes.toFixed(
      2
    )} GB`;
  }

  private isCancellationError(
    error: unknown
  ): boolean {
    return (
      error instanceof Error &&
      error.message.includes(
        "inspection was cancelled"
      )
    );
  }
}