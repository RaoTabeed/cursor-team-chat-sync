import * as vscode from "vscode";

import type {
  CloudProjectDescriptorService
} from "../cloud/cloudProjectDescriptorService";

import type {
  CloudVaultCredentialStore
} from "../cloud/cloudVaultCredentialStore";

import type {
  CursorSyncKeyService
} from "../crypto/cursorSyncKeyService";

import type {
  OutputLogger
} from "../logging/outputLogger";

import type {
  CurrentProjectInspector
} from "../projects/currentProjectInspector";

export class CopySavedSyncKeyCommand {
  public constructor(
    private readonly projectInspector:
      CurrentProjectInspector,

    private readonly projectDescriptorService:
      CloudProjectDescriptorService,

    private readonly credentialStore:
      CloudVaultCredentialStore,

    private readonly syncKeyService:
      CursorSyncKeyService,

    private readonly logger:
      OutputLogger
  ) {}

  public async execute():
    Promise<void> {
    this.logger.show();

    this.logger.info(
      "Copying the saved Cursor Sync Key for the current project."
    );

    try {
      const project =
        await this.projectInspector
          .inspect();

      const descriptor =
        await this.projectDescriptorService
          .inspect(
            project.projectPath
          );

      const savedSyncKey =
        await this.credentialStore
          .get(
            descriptor.stableProjectId
          );

      if (!savedSyncKey) {
        throw new Error(
          [
            "No saved Cursor Sync Key exists for this project.",
            "Upload the project using a new or existing Sync Vault first."
          ].join(" ")
        );
      }

      const parsedKey =
        this.syncKeyService
          .parse(
            savedSyncKey
          );

      await vscode.env.clipboard
        .writeText(
          parsedKey.syncKey
        );

      this.logger.info(
        "========================================"
      );

      this.logger.info(
        "SAVED SYNC KEY COPIED"
      );

      this.logger.info(
        `Project ID: ${descriptor.stableProjectId}`
      );

      this.logger.info(
        `Vault ID: ${parsedKey.vaultId}`
      );

      this.logger.info(
        "Cursor Sync Key: [COPIED TO CLIPBOARD, NOT LOGGED]"
      );

      await vscode.window
        .showInformationMessage(
          [
            "The saved Cursor Sync Key was copied to your clipboard.",
            "Store it securely and do not share it publicly."
          ].join(" ")
        );
    } catch (error) {
      this.logger.error(
        "Copying the saved Cursor Sync Key failed.",
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

  private getErrorMessage(
    error: unknown
  ): string {
    return error instanceof Error
      ? error.message
      : "Copying the saved Cursor Sync Key failed.";
  }
}