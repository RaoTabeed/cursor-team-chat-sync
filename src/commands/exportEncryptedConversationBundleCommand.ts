import * as path from "node:path";

import * as vscode from "vscode";

import type {
  CursorSyncKeyService
} from "../crypto/cursorSyncKeyService";

import type {
  EncryptedBundleResult
} from "../crypto/encryptedBundleTypes";

import type {
  EncryptedBundleService
} from "../crypto/encryptedBundleService";

import type {
  GeneratedCursorSyncKey
} from "../crypto/cursorSyncKeyTypes";

import type {
  SyncKeyRecoveryFileService
} from "../crypto/syncKeyRecoveryFileService";

import type {
  CursorStorageLocator
} from "../cursor/cursorStorageLocator";

import type {
  ConversationBundleExportService
} from "../export/conversationBundleExportService";

import type {
  OutputLogger
} from "../logging/outputLogger";

import type {
  CurrentProjectInspector
} from "../projects/currentProjectInspector";

export class ExportEncryptedConversationBundleCommand {
  public constructor(
    private readonly projectInspector:
      CurrentProjectInspector,

    private readonly storageLocator:
      CursorStorageLocator,

    private readonly bundleExportService:
      ConversationBundleExportService,

    private readonly syncKeyService:
      CursorSyncKeyService,

    private readonly encryptedBundleService:
      EncryptedBundleService,

    private readonly recoveryFileService:
      SyncKeyRecoveryFileService,

    private readonly logger:
      OutputLogger
  ) {}

  public async execute(): Promise<void> {
    this.logger.show();

    this.logger.info(
      "Exporting and encrypting all exact project conversations..."
    );

    try {
      const project =
        await this.projectInspector.inspect();

      const storage =
        await this.storageLocator.inspect();

      const syncKey =
        this.syncKeyService.generate();

      const exportResult =
        await this.bundleExportService.createBundle(
          storage.globalDatabasePath,
          project.projectPath
        );

      const encryptionResult =
        await this.encryptedBundleService
          .encryptAndVerify(
            exportResult.bundlePath,
            syncKey,
            exportResult.bundleSha256,
            exportResult.bundleByteLength
          );

      await vscode.env.clipboard.writeText(
        syncKey.syncKey
      );

      this.logResult(
        exportResult.conversationCount,
        syncKey,
        encryptionResult
      );

      await this.showCompletionActions(
        syncKey,
        encryptionResult
      );
    } catch (error) {
      if (
        this.isCancellationError(error)
      ) {
        this.logger.info(
          "Encrypted conversation export was cancelled."
        );

        return;
      }

      this.logger.error(
        "Encrypted conversation export failed.",
        error
      );

      await vscode.window.showErrorMessage(
        "Encrypted conversation export failed. Check the Output panel."
      );
    }
  }

  private async showCompletionActions(
    syncKey:
      GeneratedCursorSyncKey,

    result:
      EncryptedBundleResult
  ): Promise<void> {
    const selectedAction =
      await vscode.window.showWarningMessage(
        [
          "Encrypted chat bundle created.",
          "The Cursor Sync Key was copied to your clipboard.",
          "Store it safely because it cannot be recovered."
        ].join(" "),
        {
          modal: true
        },
        "Save Recovery Key",
        "Reveal Encrypted Bundle",
        "Copy Key Again"
      );

    if (
      selectedAction ===
      "Save Recovery Key"
    ) {
      await this.saveRecoveryKey(
        syncKey,
        result
      );

      return;
    }

    if (
      selectedAction ===
      "Reveal Encrypted Bundle"
    ) {
      await vscode.commands.executeCommand(
        "revealFileInOS",
        vscode.Uri.file(
          result.encryptedBundlePath
        )
      );

      return;
    }

    if (
      selectedAction ===
      "Copy Key Again"
    ) {
      await vscode.env.clipboard.writeText(
        syncKey.syncKey
      );

      await vscode.window.showInformationMessage(
        "Cursor Sync Key copied to the clipboard."
      );
    }
  }

  private async saveRecoveryKey(
    syncKey:
      GeneratedCursorSyncKey,

    result:
      EncryptedBundleResult
  ): Promise<void> {
    const defaultDirectory =
      path.dirname(
        result.encryptedBundlePath
      );

    const defaultFilename =
      `${syncKey.vaultId}.cursor-sync-key.txt`;

    const destination =
      await vscode.window.showSaveDialog(
        {
          title:
            "Save Cursor Sync Recovery Key",

          defaultUri:
            vscode.Uri.file(
              path.join(
                defaultDirectory,
                defaultFilename
              )
            ),

          filters: {
            "Cursor Sync Key": [
              "txt"
            ]
          },

          saveLabel:
            "Save Recovery Key"
        }
      );

    if (!destination) {
      return;
    }

    await this.recoveryFileService.save(
      destination.fsPath,
      syncKey
    );

    await vscode.window.showInformationMessage(
      "Cursor Sync recovery key saved."
    );
  }

  private logResult(
    conversationCount: number,

    syncKey:
      GeneratedCursorSyncKey,

    result:
      EncryptedBundleResult
  ): void {
    this.logger.info(
      "========================================"
    );

    this.logger.info(
      "ENCRYPTED CONVERSATION BUNDLE"
    );

    this.logger.info(
      `Conversations: ${conversationCount}`
    );

    this.logger.info(
      `Vault ID: ${syncKey.vaultId}`
    );

    this.logger.info(
      `Encryption: ${result.algorithm}`
    );

    this.logger.info(
      `Original size: ${this.formatBytes(
        result.plaintextByteLength
      )}`
    );

    this.logger.info(
      `Encrypted size: ${this.formatBytes(
        result.encryptedBundleByteLength
      )}`
    );

    this.logger.info(
      `Original SHA-256: ${result.plaintextSha256}`
    );

    this.logger.info(
      `Encrypted SHA-256: ${result.encryptedBundleSha256}`
    );

    this.logger.info(
      `Integrity verified: ${this.yesNo(
        result.verified
      )}`
    );

    this.logger.info(
      `Plaintext bundle deleted: ${this.yesNo(
        result.plaintextDeleted
      )}`
    );

    this.logger.info(
      `Encrypted bundle saved: ${result.encryptedBundlePath}`
    );

    this.logger.info(
      "Cursor Sync Key: [NOT LOGGED]"
    );

    this.logger.info(
      "The Cursor Sync Key was copied to the clipboard."
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