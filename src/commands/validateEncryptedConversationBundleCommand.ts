import * as vscode from "vscode";

import type {
  CursorSyncKeyService
} from "../crypto/cursorSyncKeyService";

import type {
  EncryptedBundleDecryptionService
} from "../crypto/encryptedBundleDecryptionService";

import type {
  DecryptedBundleFileResult
} from "../crypto/encryptedBundleDecryptionTypes";

import type {
  CursorStorageLocator
} from "../cursor/cursorStorageLocator";

import type {
  ConversationImportPlanEntry,
  ConversationImportValidationResult
} from "../import/conversationImportValidationTypes";

import type {
  ConversationImportValidationService
} from "../import/conversationImportValidationService";

import type {
  ImportValidationReportWriterService
} from "../import/importValidationReportWriterService";

import type {
  OutputLogger
} from "../logging/outputLogger";

import type {
  CurrentProjectInspector
} from "../projects/currentProjectInspector";

export class ValidateEncryptedConversationBundleCommand {
  public constructor(
    private readonly projectInspector:
      CurrentProjectInspector,

    private readonly storageLocator:
      CursorStorageLocator,

    private readonly syncKeyService:
      CursorSyncKeyService,

    private readonly decryptionService:
      EncryptedBundleDecryptionService,

    private readonly validationService:
      ConversationImportValidationService,

    private readonly reportWriter:
      ImportValidationReportWriterService,

    private readonly logger:
      OutputLogger
  ) {}

  public async execute(): Promise<void> {
    this.logger.show();

    this.logger.info(
      "Validating encrypted conversation bundle for safe import..."
    );

    const encryptedBundle =
      await this.selectEncryptedBundle();

    if (!encryptedBundle) {
      this.logger.info(
        "Encrypted bundle selection was cancelled."
      );

      return;
    }

    const syncKeyInput =
      await vscode.window.showInputBox(
        {
          title:
            "Enter Cursor Sync Key",

          prompt:
            "Paste the complete CTS1 Cursor Sync Key for this encrypted bundle.",

          placeHolder:
            "CTS1.<vault-id>.<secret>.<checksum>",

          password: true,

          ignoreFocusOut: true,

          validateInput:
            value => {
              if (
                value.trim().length === 0
              ) {
                return "Cursor Sync Key is required.";
              }

              return undefined;
            }
        }
      );

    if (!syncKeyInput) {
      this.logger.info(
        "Cursor Sync Key entry was cancelled."
      );

      return;
    }

    let decryptedResult:
      DecryptedBundleFileResult | undefined;

    try {
      const parsedSyncKey =
        this.syncKeyService.parse(
          syncKeyInput
        );

      const project =
        await this.projectInspector.inspect();

      const storage =
        await this.storageLocator.inspect();

      decryptedResult =
        await this.decryptionService
          .decryptToTemporaryBundle(
            encryptedBundle.fsPath,
            parsedSyncKey
          );

      let validationResult:
        ConversationImportValidationResult;

      try {
        validationResult =
          await this.validationService.validate(
            decryptedResult
              .temporaryBundlePath,

            storage.globalDatabasePath,

            project.projectPath
          );
      } finally {
        await this.decryptionService
          .deleteTemporaryBundle(
            decryptedResult
              .temporaryBundlePath
          );

        decryptedResult =
          undefined;
      }

      const reportPath =
        await this.reportWriter.write(
          validationResult
        );

      this.logValidation(
        validationResult,
        reportPath
      );

      await this.showResultActions(
        validationResult,
        reportPath,
        encryptedBundle
      );
    } catch (error) {
      if (decryptedResult) {
        await this.decryptionService
          .deleteTemporaryBundle(
            decryptedResult
              .temporaryBundlePath
          )
          .catch(
            () => undefined
          );
      }

      this.logger.error(
        "Encrypted conversation import validation failed.",
        error
      );

      await vscode.window.showErrorMessage(
        this.getErrorMessage(error)
      );
    }
  }

  private async selectEncryptedBundle():
    Promise<vscode.Uri | undefined> {
    const selection =
      await vscode.window.showOpenDialog(
        {
          title:
            "Select Encrypted Conversation Bundle",

          canSelectFiles: true,

          canSelectFolders: false,

          canSelectMany: false,

          filters: {
            "Encrypted Conversation Bundle": [
              "enc"
            ]
          },

          openLabel:
            "Validate Bundle"
        }
      );

    return selection?.[0];
  }

  private logValidation(
    result:
      ConversationImportValidationResult,

    reportPath: string
  ): void {
    this.logger.info(
      "========================================"
    );

    this.logger.info(
      "SAFE IMPORT VALIDATION"
    );

    this.logger.info(
      `Validation version: ${result.validationVersion}`
    );

    this.logger.info(
      `Validated at: ${result.validatedAt}`
    );

    this.logger.info(
      `Bundle format: ${result.bundle.format}`
    );

    this.logger.info(
      `Bundle version: ${result.bundle.version}`
    );

    this.logger.info(
      `Bundle SHA-256: ${result.bundle.sha256}`
    );

    this.logger.info(
      `Manifest SHA-256: ${result.bundle.manifestSha256}`
    );

    this.logger.info(
      `Verified payloads: ${result.bundle.verifiedPayloadCount}`
    );

    this.logger.info(
      `Verified payload bytes: ${this.formatBytes(
        result.bundle
          .verifiedPayloadByteLength
      )}`
    );

    this.logger.info(
      `Source project path: ${
        result.source.projectPath ??
        "Not available"
      }`
    );

    this.logger.info(
      `Destination project path: ${result.destination.projectPath}`
    );

    this.logger.info(
      `Same local project path: ${this.yesNo(
        result.destination
          .sameNormalizedProjectPath
      )}`
    );

    this.logger.info(
      `Destination workspace IDs: ${
        result.destination
          .workspaceIds
          .join(", ") ||
        "Not available"
      }`
    );

    this.logger.info(
      `Conversations: ${result.summary.conversationCount}`
    );

    this.logger.info(
      `New: ${result.summary.newCount}`
    );

    this.logger.info(
      `Identical: ${result.summary.identicalCount}`
    );

    this.logger.info(
      `Conflicts: ${result.summary.conflictCount}`
    );

    this.logger.info(
      `Recommended imports: ${result.summary.recommendedImportCount}`
    );

    this.logger.info(
      `Recommended skips: ${result.summary.recommendedSkipCount}`
    );

    this.logger.info(
      `Require review: ${result.summary.requiresReviewCount}`
    );

    this.logger.info(
      `Temporary plaintext deleted: Yes`
    );

    this.logger.info(
      `Import plan saved: ${reportPath}`
    );

    result.conversations.forEach(
      (
        conversation,
        index
      ) => {
        this.logConversation(
          conversation,
          index + 1
        );
      }
    );
  }

  private logConversation(
    conversation:
      ConversationImportPlanEntry,

    position: number
  ): void {
    this.logger.info(
      "----------------------------------------"
    );

    this.logger.info(
      `CONVERSATION ${position}`
    );

    this.logger.info(
      `Composer ID: ${conversation.composerId}`
    );

    this.logger.info(
      `Status: ${conversation.status}`
    );

    this.logger.info(
      `Recommended action: ${conversation.recommendedAction}`
    );

    this.logger.info(
      `Mode: ${
        conversation.unifiedMode ??
        "Not available"
      }`
    );

    this.logger.info(
      `Bundle records: ${conversation.bundleRecordCount}`
    );

    this.logger.info(
      `Matching records: ${conversation.matchingRecordCount}`
    );

    this.logger.info(
      `Missing records: ${conversation.missingRecordCount}`
    );

    this.logger.info(
      `Changed records: ${conversation.changedRecordCount}`
    );

    this.logger.info(
      `Extra local records: ${conversation.extraDirectRecordCount}`
    );

    this.logger.info(
      `Header matches: ${this.yesNo(
        conversation.headerMatches
      )}`
    );
  }

  private async showResultActions(
    result:
      ConversationImportValidationResult,

    reportPath: string,

    encryptedBundle:
      vscode.Uri
  ): Promise<void> {
    const action =
      await vscode.window.showInformationMessage(
        [
          "Encrypted bundle validated.",
          `${result.summary.newCount} new,`,
          `${result.summary.identicalCount} identical,`,
          `${result.summary.conflictCount} conflicts.`,
          "No Cursor database changes were made."
        ].join(" "),
        "Open Import Plan",
        "Reveal Encrypted Bundle"
      );

    if (
      action ===
      "Open Import Plan"
    ) {
      const document =
        await vscode.workspace
          .openTextDocument(
            vscode.Uri.file(
              reportPath
            )
          );

      await vscode.window
        .showTextDocument(
          document,
          {
            preview: false
          }
        );

      return;
    }

    if (
      action ===
      "Reveal Encrypted Bundle"
    ) {
      await vscode.commands
        .executeCommand(
          "revealFileInOS",
          encryptedBundle
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

  private getErrorMessage(
    error: unknown
  ): string {
    if (
      error instanceof Error
    ) {
      return error.message;
    }

    return (
      "Encrypted conversation import validation failed. "
      + "Check the Output panel."
    );
  }
}