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
  ConversationImportValidationResult
} from "../import/conversationImportValidationTypes";

import type {
  ConversationImportValidationService
} from "../import/conversationImportValidationService";

import type {
  ConversationImportJobService
} from "../import/conversationImportJobService";

import type {
  OutputLogger
} from "../logging/outputLogger";

import type {
  CurrentProjectInspector
} from "../projects/currentProjectInspector";

export class ImportEncryptedConversationBundleCommand {
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

    private readonly importJobService:
      ConversationImportJobService,

    private readonly logger:
      OutputLogger
  ) {}

  public async execute(): Promise<void> {
    this.logger.show();

    this.logger.info(
      "Preparing encrypted conversation bundle for transactional import..."
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
            "Paste the complete CTS1 Sync Key for this bundle.",

          placeHolder:
            "CTS1.<vault-id>.<secret>.<checksum>",

          password: true,

          ignoreFocusOut: true
        }
      );

    if (!syncKeyInput) {
      this.logger.info(
        "Cursor Sync Key entry was cancelled."
      );

      return;
    }

    let decryptedResult:
      DecryptedBundleFileResult
      | undefined;

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

      const validationResult =
        await this.validationService.validate(
          decryptedResult
            .temporaryBundlePath,

          storage.globalDatabasePath,

          project.projectPath
        );

      if (
        validationResult
          .summary
          .conflictCount > 0
      ) {
        await this.decryptionService
          .deleteTemporaryBundle(
            decryptedResult
              .temporaryBundlePath
          );

        decryptedResult =
          undefined;

        throw new Error(
          [
            "Import stopped because",
            `${validationResult.summary.conflictCount}`,
            "conversation conflict(s) require review."
          ].join(" ")
        );
      }

      if (
        validationResult
          .summary
          .newCount === 0
      ) {
        await this.decryptionService
          .deleteTemporaryBundle(
            decryptedResult
              .temporaryBundlePath
          );

        decryptedResult =
          undefined;

        await vscode.window
          .showInformationMessage(
            [
              "Nothing needs to be imported.",
              `${validationResult.summary.identicalCount}`,
              "conversation(s) are already identical on this device."
            ].join(" ")
          );

        return;
      }

      const workspaceId =
        await this.selectWorkspaceId(
          validationResult
        );

      if (!workspaceId) {
        await this.decryptionService
          .deleteTemporaryBundle(
            decryptedResult
              .temporaryBundlePath
          );

        decryptedResult =
          undefined;

        return;
      }

      const confirmation =
        await vscode.window
          .showWarningMessage(
            [
              `${validationResult.summary.newCount}`,
              "new conversation(s) will be imported.",
              "Cursor will close so the database can be backed up and updated transactionally.",
              "Reopen Cursor after the import worker finishes."
            ].join(" "),
            {
              modal: true
            },
            "Import and Close Cursor"
          );

      if (
        confirmation !==
        "Import and Close Cursor"
      ) {
        await this.decryptionService
          .deleteTemporaryBundle(
            decryptedResult
              .temporaryBundlePath
          );

        decryptedResult =
          undefined;

        this.logger.info(
          "Transactional import was cancelled."
        );

        return;
      }

      const launchResult =
        await this.importJobService
          .stageAndLaunch(
            {
              bundlePath:
                decryptedResult
                  .temporaryBundlePath,

              bundleSha256:
                decryptedResult
                  .plaintextSha256,

              encryptedBundlePath:
                encryptedBundle.fsPath,

              destinationDatabasePath:
                storage.globalDatabasePath,

              destinationProjectPath:
                project.projectPath,

              destinationWorkspaceId:
                workspaceId
            }
          );

      decryptedResult =
        undefined;

      this.logger.info(
        "========================================"
      );

      this.logger.info(
        "TRANSACTIONAL IMPORT SCHEDULED"
      );

      this.logger.info(
        `Job ID: ${launchResult.jobId}`
      );

      this.logger.info(
        `Workspace ID: ${workspaceId}`
      );

      this.logger.info(
        `Result file: ${launchResult.resultPath}`
      );

      this.logger.info(
        `Backup root: ${launchResult.backupRoot}`
      );

      this.logger.info(
        "Cursor is closing. The external worker will import after every Cursor process exits."
      );

      await vscode.commands
        .executeCommand(
          "workbench.action.quit"
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
        "Transactional conversation import preparation failed.",
        error
      );

      await vscode.window
        .showErrorMessage(
          this.getErrorMessage(
            error
          )
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
            "Import Bundle"
        }
      );

    return selection?.[0];
  }

  private async selectWorkspaceId(
    validation:
      ConversationImportValidationResult
  ): Promise<string | undefined> {
    const workspaceIds =
      validation.destination
        .workspaceIds;

    if (
      workspaceIds.length === 1
    ) {
      return workspaceIds[0];
    }

    if (
      workspaceIds.length === 0
    ) {
      throw new Error(
        "No valid Cursor workspace ID was found for the currently open project."
      );
    }

    return vscode.window.showQuickPick(
      workspaceIds,
      {
        title:
          "Select Destination Workspace",

        placeHolder:
          "Choose the workspace where imported chats should appear.",

        ignoreFocusOut: true
      }
    );
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
      "Transactional conversation import preparation failed. "
      + "Check the Output panel."
    );
  }
}