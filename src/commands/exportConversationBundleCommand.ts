import * as vscode from "vscode";

import type {
  CursorStorageLocator
} from "../cursor/cursorStorageLocator";

import type {
  ConversationBundleExportResult
} from "../export/conversationBundleExportTypes";

import type {
  ConversationBundleExportService
} from "../export/conversationBundleExportService";

import type {
  OutputLogger
} from "../logging/outputLogger";

import type {
  CurrentProjectInspector
} from "../projects/currentProjectInspector";

export class ExportConversationBundleCommand {
  public constructor(
    private readonly projectInspector:
      CurrentProjectInspector,

    private readonly storageLocator:
      CursorStorageLocator,

    private readonly bundleExportService:
      ConversationBundleExportService,

    private readonly logger:
      OutputLogger
  ) {}

  public async execute(): Promise<void> {
    this.logger.show();

    this.logger.info(
      "Exporting all exact project conversations in read-only mode..."
    );

    try {
      const project =
        await this.projectInspector
          .inspect();

      const storage =
        await this.storageLocator
          .inspect();

      const result =
        await this.bundleExportService
          .createBundle(
            storage.globalDatabasePath,
            project.projectPath
          );

      this.logResult(result);

      const selectedAction =
        await vscode.window
          .showWarningMessage(
            [
              "Exact conversation bundle created.",
              "This local bundle is not encrypted yet",
              "and contains sensitive chat data."
            ].join(" "),
            "Reveal Bundle"
          );

      if (
        selectedAction ===
        "Reveal Bundle"
      ) {
        await vscode.commands
          .executeCommand(
            "revealFileInOS",
            vscode.Uri.file(
              result.bundlePath
            )
          );
      }
    } catch (error) {
      if (
        this.isCancellationError(
          error
        )
      ) {
        this.logger.info(
          "Conversation bundle export was cancelled."
        );

        return;
      }

      this.logger.error(
        "Conversation bundle export failed.",
        error
      );

      await vscode.window
        .showErrorMessage(
          "Conversation bundle export failed. Check the Output panel."
        );
    }
  }

  private logResult(
    result:
      ConversationBundleExportResult
  ): void {
    this.logger.info(
      "========================================"
    );

    this.logger.info(
      "EXACT CONVERSATION BUNDLE"
    );

    this.logger.info(
      `Bundle format: ${result.bundleFormat}`
    );

    this.logger.info(
      `Bundle version: ${result.bundleVersion}`
    );

    this.logger.info(
      `Generated at: ${result.generatedAt}`
    );

    this.logger.info(
      `Conversations: ${result.conversationCount}`
    );

    this.logger.info(
      `Header fragments: ${result.headerFragmentCount}`
    );

    this.logger.info(
      `SQLite records: ${result.sqliteRecordCount}`
    );

    this.logger.info(
      `Total payloads: ${result.totalPayloadCount}`
    );

    this.logger.info(
      `Verified payloads: ${result.verifiedPayloadCount}`
    );

    this.logger.info(
      `Original payload size: ${this.formatBytes(
        result.totalPayloadByteLength
      )}`
    );

    this.logger.info(
      `Compressed bundle size: ${this.formatBytes(
        result.bundleByteLength
      )}`
    );

    this.logger.info(
      `Bundle SHA-256: ${result.bundleSha256}`
    );

    this.logger.info(
      `Manifest SHA-256: ${result.manifestSha256}`
    );

    this.logger.info(
      `Integrity verified: ${this.yesNo(
        result.verified
      )}`
    );

    this.logger.info(
      `Encrypted: ${this.yesNo(
        result.encrypted
      )}`
    );

    this.logger.info(
      `Bundle saved: ${result.bundlePath}`
    );

    this.logger.info(
      "WARNING: This bundle contains exact chat records and is not encrypted yet."
    );
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

  private yesNo(
    value: boolean
  ): string {
    return value
      ? "Yes"
      : "No";
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