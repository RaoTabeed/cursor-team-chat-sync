import * as path from "node:path";

import * as vscode from "vscode";

import type {
  CloudProjectDescriptorService
} from "../cloud/cloudProjectDescriptorService";

import type {
  CloudVaultCredentialStore
} from "../cloud/cloudVaultCredentialStore";

import type {
  CursorCloudStorageService
} from "../cloud/cursorCloudStorageService";

import type {
  CursorCloudSyncApiService
} from "../cloud/cursorCloudSyncApiService";

import type {
  CursorSyncKeyService
} from "../crypto/cursorSyncKeyService";

import type {
  ParsedCursorSyncKey
} from "../crypto/cursorSyncKeyTypes";

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
  ConversationImportJobService
} from "../import/conversationImportJobService";

import type {
  ConversationImportValidationResult
} from "../import/conversationImportValidationTypes";

import type {
  ConversationImportValidationService
} from "../import/conversationImportValidationService";

import type {
  OutputLogger
} from "../logging/outputLogger";

import type {
  CurrentProjectInspector
} from "../projects/currentProjectInspector";

export class ImportChatsFromCloudCommand {
  public constructor(
    private readonly projectInspector:
      CurrentProjectInspector,

    private readonly storageLocator:
      CursorStorageLocator,

    private readonly projectDescriptorService:
      CloudProjectDescriptorService,

    private readonly syncKeyService:
      CursorSyncKeyService,

    private readonly credentialStore:
      CloudVaultCredentialStore,

    private readonly cloudApiService:
      CursorCloudSyncApiService,

    private readonly cloudStorageService:
      CursorCloudStorageService,

    private readonly decryptionService:
      EncryptedBundleDecryptionService,

    private readonly validationService:
      ConversationImportValidationService,

    private readonly importJobService:
      ConversationImportJobService,

    private readonly downloadRoot:
      string,

    private readonly logger:
      OutputLogger
  ) {}

  public async execute():
    Promise<void> {
    this.logger.show();

    this.logger.info(
      "Downloading the latest encrypted chat bundle from the cloud vault..."
    );

    let downloadedBundlePath:
      string | undefined;

    let decryptedResult:
      DecryptedBundleFileResult |
      undefined;

    try {
      const project =
        await this.projectInspector
          .inspect();

      const storage =
        await this.storageLocator
          .inspect();

      const descriptor =
        await this.projectDescriptorService
          .inspect(
            project.projectPath
          );

      const parsedKey =
        await this.resolveSyncKey(
          descriptor.stableProjectId
        );

      if (!parsedKey) {
        this.logger.info(
          "Cloud import was cancelled."
        );

        return;
      }

      const accessToken =
        this.syncKeyService
          .deriveAccessToken(
            parsedKey
          );
          const vaultInfo =
          await this.cloudApiService
            .getVaultInfo(
              parsedKey.vaultId,
              accessToken
            );
        
        if (!vaultInfo.project) {
          throw new Error(
            "This Cursor Sync Key does not have an uploaded project yet."
          );
        }
        
        if (
          vaultInfo.project
            .stableProjectId !==
              descriptor.stableProjectId
        ) {
          throw new Error(
            [
              "Project mismatch.",
              `This Sync Key belongs to "${vaultInfo.project.projectName}".`,
              `Cloud project ID: ${vaultInfo.project.stableProjectId}.`,
              `Current project ID: ${descriptor.stableProjectId}.`,
              "Open the correct project before importing this key.",
              "No cloud bundle was downloaded and no Cursor database was changed."
            ].join(" ")
          );
        }

      const latest =
        await this.cloudApiService
          .getLatestBundle(
            parsedKey.vaultId,
            accessToken,
            descriptor.stableProjectId
          );

      downloadedBundlePath =
        path.join(
          this.downloadRoot,
          parsedKey.vaultId,
          descriptor.stableProjectId,
          `${latest.bundle.bundleId}.cursor-chat-bundle.enc`
        );

      await this.cloudStorageService
        .downloadAndVerify(
          latest.bundle.downloadUrl,
          downloadedBundlePath,
          latest.bundle.encryptedSize,
          latest.bundle.sha256
        );

      decryptedResult =
        await this.decryptionService
          .decryptToTemporaryBundle(
            downloadedBundlePath,
            parsedKey
          );

      const validation =
        await this.validationService
          .validate(
            decryptedResult
              .temporaryBundlePath,

            storage
              .globalDatabasePath,

            project.projectPath
          );

      if (
        validation
          .summary
          .conflictCount > 0
      ) {
        throw new Error(
          [
            "Cloud import stopped because",
            `${validation.summary.conflictCount}`,
            "conversation conflict(s) require review."
          ].join(" ")
        );
      }

      if (
        validation
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

        await this.cloudStorageService
          .deleteLocalFile(
            downloadedBundlePath
          );

        downloadedBundlePath =
          undefined;

        await this.credentialStore
          .store(
            descriptor
              .stableProjectId,

            parsedKey.syncKey
          );

        await vscode.window
          .showInformationMessage(
            [
              "The latest cloud bundle is already present on this device.",
              `${validation.summary.identicalCount}`,
              "conversation(s) are identical."
            ].join(" ")
          );

        return;
      }

      const workspaceId =
        await this.selectWorkspaceId(
          validation
        );

      if (!workspaceId) {
        await this.cleanup(
          decryptedResult,
          downloadedBundlePath
        );

        decryptedResult =
          undefined;

        downloadedBundlePath =
          undefined;

        return;
      }

      const confirmation =
        await vscode.window
          .showWarningMessage(
            [
              `Cloud bundle version ${latest.bundle.versionNumber} contains`,
              `${validation.summary.newCount}`,
              "new conversation(s).",
              "Cursor will close, back up its database and import them transactionally."
            ].join(" "),
            {
              modal:
                true
            },
            "Import and Close Cursor"
          );

      if (
        confirmation !==
        "Import and Close Cursor"
      ) {
        await this.cleanup(
          decryptedResult,
          downloadedBundlePath
        );

        decryptedResult =
          undefined;

        downloadedBundlePath =
          undefined;

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
                downloadedBundlePath,

              destinationDatabasePath:
                storage
                  .globalDatabasePath,

              destinationProjectPath:
                project.projectPath,

              destinationWorkspaceId:
                workspaceId
            }
          );

      decryptedResult =
        undefined;

      await this.cloudStorageService
        .deleteLocalFile(
          downloadedBundlePath
        );

      downloadedBundlePath =
        undefined;

      await this.credentialStore
        .store(
          descriptor
            .stableProjectId,

          parsedKey.syncKey
        );

      this.logger.info(
        "========================================"
      );

      this.logger.info(
        "CLOUD IMPORT SCHEDULED"
      );

      this.logger.info(
        `Vault ID: ${parsedKey.vaultId}`
      );

      this.logger.info(
        `Cloud bundle version: ${latest.bundle.versionNumber}`
      );

      this.logger.info(
        `New conversations: ${validation.summary.newCount}`
      );

      this.logger.info(
        `Import job ID: ${launchResult.jobId}`
      );

      this.logger.info(
        "Cursor is closing. Reopen it after the external import worker finishes."
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

      if (downloadedBundlePath) {
        await this.cloudStorageService
          .deleteLocalFile(
            downloadedBundlePath
          )
          .catch(
            () => undefined
          );
      }

      this.logger.error(
        "Cloud chat import failed.",
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

  private async resolveSyncKey(
    stableProjectId: string
  ): Promise<
    ParsedCursorSyncKey |
    undefined
  > {
    const savedSyncKey =
      await this.credentialStore
        .get(
          stableProjectId
        );

    if (savedSyncKey) {
      const selected =
        await vscode.window
          .showQuickPick(
            [
              "Use Saved Sync Key",
              "Paste Another Sync Key"
            ],
            {
              title:
                "Import Chats from Cloud",

              placeHolder:
                "Choose the vault key to use.",

              ignoreFocusOut:
                true
            }
          );

      if (!selected) {
        return undefined;
      }

      if (
        selected ===
        "Use Saved Sync Key"
      ) {
        return this.syncKeyService
          .parse(
            savedSyncKey
          );
      }
    }

    const enteredKey =
      await vscode.window
        .showInputBox(
          {
            title:
              "Enter Cursor Sync Key",

            prompt:
              "Paste the complete CTS1 key. The vault ID locates the cloud bundle and the secret decrypts it locally.",

            placeHolder:
              "CTS1.<vault-id>.<secret>.<checksum>",

            password:
              true,

            ignoreFocusOut:
              true
          }
        );

    if (!enteredKey) {
      return undefined;
    }

    return this.syncKeyService
      .parse(
        enteredKey
      );
  }

  private async selectWorkspaceId(
    validation:
      ConversationImportValidationResult
  ): Promise<string | undefined> {
    const workspaceIds =
      validation
        .destination
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

    return vscode.window
      .showQuickPick(
        workspaceIds,
        {
          title:
            "Select Destination Workspace",

          placeHolder:
            "Choose where imported chats should appear.",

          ignoreFocusOut:
            true
        }
      );
  }

  private async cleanup(
    decryptedResult:
      DecryptedBundleFileResult,

    downloadedBundlePath:
      string
  ): Promise<void> {
    await this.decryptionService
      .deleteTemporaryBundle(
        decryptedResult
          .temporaryBundlePath
      );

    await this.cloudStorageService
      .deleteLocalFile(
        downloadedBundlePath
      );
  }

  private getErrorMessage(
    error: unknown
  ): string {
    return error instanceof Error
      ? error.message
      : "Cloud chat import failed. Check the Output panel.";
  }
}