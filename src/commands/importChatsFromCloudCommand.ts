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

      const currentWorkspaceId =
        this.readCurrentWorkspaceId(
          project.cursorWorkspace
        );

      if (!currentWorkspaceId) {
        throw new Error(
          [
            "Cursor has not created a valid local workspace for this project.",
            "Open the project, create one temporary chat, restart Cursor and try again."
          ].join(" ")
        );
      }

      const currentWorkspaceDatabasePath =
        this.readCurrentWorkspaceDatabasePath(
          project.cursorWorkspace,
          currentWorkspaceId
        );

      if (!currentWorkspaceDatabasePath) {
        throw new Error(
          [
            "The current Cursor workspace database could not be resolved.",
            "Run Cursor Team Chat Sync: Inspect Current Project and confirm",
            "that a workspace state.vscdb path is displayed."
          ].join(" ")
        );
      }

      this.logger.info(
        `Matched destination workspace ID: ${currentWorkspaceId}`
      );

      this.logger.info(
        `Matched workspace database: ${currentWorkspaceDatabasePath}`
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
        const conflicts =
          validation
            .conversations
            .filter(
              conversation =>
                conversation.status ===
                "conflict"
            );

        this.logger.info(
          "========================================"
        );

        this.logger.info(
          "CONVERSATION CONFLICT DETAILS"
        );

        this.logger.info(
          `Conflict count: ${conflicts.length}`
        );

        for (
          const conflict of conflicts
        ) {
          this.logger.info(
            JSON.stringify(
              conflict,
              null,
              2
            )
          );
        }

        this.logger.info(
          "========================================"
        );

        throw new Error(
          [
            "Cloud import stopped because",
            `${validation.summary.conflictCount}`,
            "conversation conflict(s) require review.",
            "No database was modified.",
            "See CONVERSATION CONFLICT DETAILS in the Output panel."
          ].join(" ")
        );
      }

      const workspaceId =
        await this.selectWorkspaceId(
          currentWorkspaceId,
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

        this.logger.info(
          "Cloud import was cancelled while selecting the destination workspace."
        );

        return;
      }

      const confirmationButton =
        validation.summary.newCount > 0
          ? "Import and Close Cursor"
          : "Repair Sidebar and Close Cursor";

      const confirmationMessage =
        validation.summary.newCount > 0
          ? [
              `Cloud bundle version ${latest.bundle.versionNumber} contains`,
              `${validation.summary.newCount}`,
              "new conversation(s) and",
              `${validation.summary.identicalCount}`,
              "identical conversation(s).",
              `They will be mapped to workspace ${workspaceId}.`,
              "Cursor will close, both Cursor databases will be backed up,",
              "the conversations will be imported transactionally, and",
              "the native Agent history sidebar index will be rebuilt."
            ].join(" ")
          : [
              `Cloud bundle version ${latest.bundle.versionNumber} is already`,
              "present in the global Cursor database.",
              `${validation.summary.identicalCount}`,
              "conversation(s) will be verified and added to the native",
              `Agent history sidebar for workspace ${workspaceId}.`,
              "Cursor will close and both databases will be backed up first."
            ].join(" ");

      const confirmation =
        await vscode.window
          .showWarningMessage(
            confirmationMessage,
            {
              modal:
                true
            },
            confirmationButton
          );

      if (
        confirmation !==
        confirmationButton
      ) {
        await this.cleanup(
          decryptedResult,
          downloadedBundlePath
        );

        decryptedResult =
          undefined;

        downloadedBundlePath =
          undefined;

        this.logger.info(
          "Cloud import confirmation was cancelled."
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
                downloadedBundlePath,

              destinationDatabasePath:
                storage
                  .globalDatabasePath,

              destinationWorkspaceDatabasePath:
                currentWorkspaceDatabasePath,

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
        `Project ID: ${descriptor.stableProjectId}`
      );

      this.logger.info(
        `Destination workspace ID: ${workspaceId}`
      );

      this.logger.info(
        `Destination workspace database: ${currentWorkspaceDatabasePath}`
      );

      this.logger.info(
        `Cloud bundle version: ${latest.bundle.versionNumber}`
      );

      this.logger.info(
        `New conversations: ${validation.summary.newCount}`
      );

      this.logger.info(
        `Identical conversations: ${validation.summary.identicalCount}`
      );

      this.logger.info(
        `Sidebar repair required: ${validation.summary.identicalCount > 0}`
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
    stableProjectId:
      string
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
              [
                "Paste the complete CTS1 key.",
                "The vault ID locates the cloud bundle",
                "and the secret decrypts it locally."
              ].join(" "),

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

  private readCurrentWorkspaceId(
    cursorWorkspace:
      unknown
  ): string | undefined {
    if (
      typeof cursorWorkspace !==
        "object" ||
      cursorWorkspace === null
    ) {
      return undefined;
    }

    const workspace =
      cursorWorkspace as
        Record<string, unknown>;

    const directCandidates = [
      workspace.workspaceId,
      workspace.id
    ];

    for (
      const candidate of
      directCandidates
    ) {
      const normalized =
        this.normalizeWorkspaceId(
          candidate
        );

      if (normalized) {
        return normalized;
      }
    }

    for (
      const value of
      Object.values(
        workspace
      )
    ) {
      if (
        typeof value !==
        "string"
      ) {
        continue;
      }

      for (
        const segment of
        value.split(
          /[\\/]/
        )
      ) {
        const normalized =
          this.normalizeWorkspaceId(
            segment
          );

        if (normalized) {
          return normalized;
        }
      }
    }

    return undefined;
  }

  private readCurrentWorkspaceDatabasePath(
    cursorWorkspace:
      unknown,

    workspaceId:
      string
  ): string | undefined {
    if (
      typeof cursorWorkspace !==
        "object" ||
      cursorWorkspace === null
    ) {
      return undefined;
    }

    const workspace =
      cursorWorkspace as
        Record<string, unknown>;

    const candidates = [
      workspace.databasePath,
      workspace.workspaceDatabasePath,
      workspace.stateDatabasePath,
      ...Object.values(
        workspace
      )
    ];

    for (
      const candidate of
      candidates
    ) {
      if (
        typeof candidate !==
        "string"
      ) {
        continue;
      }

      const normalizedPath =
        path.normalize(
          candidate.trim()
        );

      if (
        !path.isAbsolute(
          normalizedPath
        )
      ) {
        continue;
      }

      if (
        path.basename(
          normalizedPath
        ).toLowerCase() !==
          "state.vscdb"
      ) {
        continue;
      }

      const lowerPath =
        normalizedPath
          .toLowerCase();

      if (
        !lowerPath.includes(
          `${path.sep}workspacestorage${path.sep}`
        )
      ) {
        continue;
      }

      if (
        !lowerPath.includes(
          `${path.sep}${workspaceId.toLowerCase()}${path.sep}`
        )
      ) {
        continue;
      }

      return normalizedPath;
    }

    return undefined;
  }

  private normalizeWorkspaceId(
    value:
      unknown
  ): string | undefined {
    if (
      typeof value !==
      "string"
    ) {
      return undefined;
    }

    const normalized =
      value
        .trim()
        .toLowerCase();

    return /^[0-9a-f]{32}$/.test(
      normalized
    )
      ? normalized
      : undefined;
  }

  private async selectWorkspaceId(
    currentWorkspaceId:
      string,

    validation:
      ConversationImportValidationResult
  ): Promise<string | undefined> {
    const validationWorkspaceIds =
      validation
        .destination
        .workspaceIds
        .map(
          workspaceId =>
            workspaceId
              .trim()
              .toLowerCase()
        )
        .filter(
          workspaceId =>
            /^[0-9a-f]{32}$/.test(
              workspaceId
            )
        );

    const availableWorkspaceIds =
      [
        currentWorkspaceId,
        ...validationWorkspaceIds
      ].filter(
        (
          workspaceId,
          index,
          allWorkspaceIds
        ) =>
          allWorkspaceIds
            .indexOf(
              workspaceId
            ) === index
      );

    if (
      availableWorkspaceIds
        .includes(
          currentWorkspaceId
        )
    ) {
      return currentWorkspaceId;
    }

    if (
      availableWorkspaceIds
        .length === 1
    ) {
      return availableWorkspaceIds[0];
    }

    if (
      availableWorkspaceIds
        .length === 0
    ) {
      throw new Error(
        "No valid Cursor workspace ID was found for the currently open project."
      );
    }

    return vscode.window
      .showQuickPick(
        availableWorkspaceIds,
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
    error:
      unknown
  ): string {
    return error instanceof Error
      ? error.message
      : "Cloud chat import failed. Check the Output panel.";
  }
}