import * as vscode from "vscode";

import type {
  ConversationImportJobService
} from "./conversationImportJobService";

import type {
  ConversationImportWorkerResult
} from "./conversationImportJobTypes";

import type {
  OutputLogger
} from "../logging/outputLogger";

export class ConversationImportResultReporter {
  public constructor(
    private readonly jobService:
      ConversationImportJobService,

    private readonly logger:
      OutputLogger
  ) {}

  public async reportLatest():
    Promise<void> {
    try {
      const result =
        await this.jobService
          .consumeLatestResult();

      if (!result) {
        return;
      }

      this.logResult(result);

      if (result.ok) {
        await vscode.window
          .showInformationMessage(
            [
              "Cursor conversations imported successfully.",
              `${result.importedConversationCount}`,
              "conversation(s) imported.",
              "They should now appear in Cursor’s native chat sidebar."
            ].join(" ")
          );

        return;
      }

      await vscode.window
        .showErrorMessage(
          `Cursor conversation import failed: ${result.error}`
        );
    } catch (error) {
      this.logger.error(
        "Could not report the latest conversation import result.",
        error
      );
    }
  }

  private logResult(
    result:
      ConversationImportWorkerResult
  ): void {
    this.logger.info(
      "========================================"
    );

    this.logger.info(
      "CONVERSATION IMPORT RESULT"
    );

    this.logger.info(
      `Completed at: ${result.completedAt}`
    );

    this.logger.info(
      `Job ID: ${
        result.jobId ??
        "Not available"
      }`
    );

    if (!result.ok) {
      this.logger.error(
        `Import failed: ${result.error}`
      );

      return;
    }

    this.logger.info(
      `Imported conversations: ${result.importedConversationCount}`
    );

    this.logger.info(
      `Skipped conversations: ${result.skippedConversationCount}`
    );

    this.logger.info(
      `Inserted records: ${result.insertedRecordCount}`
    );

    this.logger.info(
      `Skipped records: ${result.skippedRecordCount}`
    );

    this.logger.info(
      `Final identical conversations: ${result.finalIdenticalCount}`
    );

    this.logger.info(
      `Final conflicts: ${result.finalConflictCount}`
    );

    this.logger.info(
      `Destination workspace ID: ${result.destinationWorkspaceId}`
    );

    this.logger.info(
      `Database backup: ${result.backupDirectory}`
    );
  }
}