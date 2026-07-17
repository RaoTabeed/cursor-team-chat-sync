import * as vscode from "vscode";

import type {
  CursorStorageLocator
} from "../cursor/cursorStorageLocator";

import type {
  CursorDatabaseInspection,
  KeyValueTableInspection,
  RecordFamilyInspection,
  RecordSampleInspection
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
      "Inspecting Cursor database record families in read-only mode..."
    );

    try {
      const project =
        await this.projectInspector.inspect();

      if (!project.cursorWorkspace) {
        this.logger.info(
          "No matching Cursor workspace database was found."
        );

        await vscode.window
          .showWarningMessage(
            "No Cursor workspace database was matched to the selected project."
          );

        return;
      }

      const storage =
        await this.storageLocator.inspect();

      const globalInspection =
        await this.databaseInspector.inspect(
          storage.globalDatabasePath
        );

      this.logDatabaseInspection(
        "GLOBAL CURSOR DATABASE",
        globalInspection
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
          "Cursor record families inspected successfully in read-only mode."
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

    for (
      const table of
      inspection.keyValueTables
    ) {
      this.logKeyValueTable(
        table
      );
    }
  }

  private logKeyValueTable(
    table: KeyValueTableInspection
  ): void {
    this.logger.info(
      "----------------------------------------"
    );

    this.logger.info(
      `KEY-VALUE TABLE: ${table.name}`
    );

    this.logger.info(
      `Rows: ${table.rowCount}`
    );

    this.logger.info(
      "Conversation-related key counts:"
    );

    for (
      const [
        patternName,
        count
      ] of Object.entries(
        table.patternCounts
      )
    ) {
      this.logger.info(
        `  ${patternName}: ${count ?? 0}`
      );
    }

    for (
      const family of
      table.recordFamilies
    ) {
      if (family.rowCount === 0) {
        continue;
      }

      this.logRecordFamily(
        family
      );
    }
  }

  private logRecordFamily(
    family: RecordFamilyInspection
  ): void {
    this.logger.info(
      "........................................"
    );

    this.logger.info(
      `RECORD FAMILY: ${family.name}`
    );

    this.logger.info(
      `Pattern: ${family.pattern}`
    );

    this.logger.info(
      `Rows: ${family.rowCount}`
    );

    this.logger.info(
      `UTF-8 records: ${family.utf8RecordCount}`
    );

    this.logger.info(
      `JSON records: ${family.jsonRecordCount}`
    );

    if (
      family.topJsonFieldNames
        .length > 0
    ) {
      const fieldSummary =
        family.topJsonFieldNames
          .slice(0, 25)
          .map(
            (field) =>
              `${field.name}:${field.count}`
          )
          .join(", ");

      this.logger.info(
        `Top JSON field names: ${fieldSummary}`
      );
    }

    this.logger.info(
      `Samples inspected: ${family.samples.length}`
    );

    for (
      const sample of
      family.samples
    ) {
      this.logRecordSample(
        sample
      );
    }
  }

  private logRecordSample(
    sample: RecordSampleInspection
  ): void {
    this.logger.info(
      `  Key: ${sample.key}`
    );

    this.logger.info(
      `    Storage: ${sample.storageType}`
    );

    this.logger.info(
      `    Size: ${this.formatBytes(
        sample.byteLength
      )}`
    );

    this.logger.info(
      `    Encoding: ${sample.encodingHint}`
    );

    this.logger.info(
      `    SHA-256: ${sample.valueSha256.slice(
        0,
        16
      )}...`
    );

    if (sample.firstBytesHex) {
      this.logger.info(
        `    First bytes: ${sample.firstBytesHex}`
      );
    }

    if (
      sample.jsonTopLevelType
    ) {
      this.logger.info(
        `    JSON type: ${sample.jsonTopLevelType}`
      );
    }

    if (
      sample.jsonSchemaPaths
        .length > 0
    ) {
      this.logger.info(
        "    JSON schema:"
      );

      for (
        const schemaPath of
        sample.jsonSchemaPaths.slice(
          0,
          60
        )
      ) {
        this.logger.info(
          `      ${schemaPath}`
        );
      }

      if (
        sample.jsonSchemaPaths
          .length > 60
      ) {
        this.logger.info(
          `      ... ${
            sample.jsonSchemaPaths.length -
            60
          } more schema paths`
        );
      }
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

    return `${(
      megabytes / 1024
    ).toFixed(2)} GB`;
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