import * as vscode from "vscode";

import type {
  CloudProjectDescriptorService
} from "../cloud/cloudProjectDescriptorService";

import type {
  CloudVaultCredentialStore
} from "../cloud/cloudVaultCredentialStore";

import type {
  CursorCloudSyncApiService
} from "../cloud/cursorCloudSyncApiService";

import type {
  CloudBundleListItem
} from "../cloud/cursorCloudSyncTypes";

import type {
  CursorSyncKeyService
} from "../crypto/cursorSyncKeyService";

import type {
  OutputLogger
} from "../logging/outputLogger";

import type {
  CurrentProjectInspector
} from "../projects/currentProjectInspector";

interface BundleQuickPickItem
  extends vscode.QuickPickItem {
  bundle:
    CloudBundleListItem;
}

export class ManageCloudBundlesCommand {
  public constructor(
    private readonly projectInspector:
      CurrentProjectInspector,

    private readonly projectDescriptorService:
      CloudProjectDescriptorService,

    private readonly syncKeyService:
      CursorSyncKeyService,

    private readonly credentialStore:
      CloudVaultCredentialStore,

    private readonly cloudApiService:
      CursorCloudSyncApiService,

    private readonly logger:
      OutputLogger
  ) {}

  public async execute():
    Promise<void> {
    this.logger.show();

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

      const enteredKey =
        savedSyncKey ??
        await vscode.window
          .showInputBox(
            {
              title:
                "Enter Cursor Sync Key",

              prompt:
                "Paste the CTS1 key for the cloud vault.",

              password:
                true,

              ignoreFocusOut:
                true
            }
          );

      if (!enteredKey) {
        return;
      }

      const parsedKey =
        this.syncKeyService
          .parse(
            enteredKey
          );

      const accessToken =
        this.syncKeyService
          .deriveAccessToken(
            parsedKey
          );

      const response =
        await this.cloudApiService
          .listBundles(
            parsedKey.vaultId,
            accessToken,
            descriptor.stableProjectId
          );

      if (
        response.bundles.length ===
        0
      ) {
        await vscode.window
          .showInformationMessage(
            "No cloud bundle versions exist for this project."
          );

        return;
      }

      const items:
        BundleQuickPickItem[] =
        response.bundles.map(
          bundle => ({
            label:
              `Version ${bundle.version_number}`,

            description:
              bundle.status,

            detail: [
              `${bundle.conversation_count} conversations`,

              this.formatBytes(
                bundle.encrypted_size
              ),

              bundle.ready_at ??
              bundle.created_at
            ].join(" • "),

            bundle
          })
        );

      const selected =
        await vscode.window
          .showQuickPick(
            items,
            {
              title:
                "Cloud Bundle Versions",

              placeHolder:
                "Select a version to delete from cloud storage.",

              ignoreFocusOut:
                true
            }
          );

      if (
        !selected ||
        selected.bundle.status ===
          "deleted"
      ) {
        return;
      }

      const confirmation =
        await vscode.window
          .showWarningMessage(
            [
              `Delete cloud bundle version ${selected.bundle.version_number}?`,
              "This removes the encrypted storage object and cannot be undone."
            ].join(" "),
            {
              modal:
                true
            },
            "Delete Cloud Bundle"
          );

      if (
        confirmation !==
        "Delete Cloud Bundle"
      ) {
        return;
      }

      await this.cloudApiService
        .deleteBundle(
          parsedKey.vaultId,
          accessToken,
          selected.bundle.id
        );

      await vscode.window
        .showInformationMessage(
          `Cloud bundle version ${selected.bundle.version_number} was deleted.`
        );
    } catch (error) {
      this.logger.error(
        "Cloud bundle management failed.",
        error
      );

      await vscode.window
        .showErrorMessage(
          error instanceof Error
            ? error.message
            : "Cloud bundle management failed."
        );
    }
  }

  private formatBytes(
    bytes: number
  ): string {
    if (
      bytes < 1024
    ) {
      return `${bytes} B`;
    }

    const kilobytes =
      bytes / 1024;

    if (
      kilobytes < 1024
    ) {
      return `${kilobytes.toFixed(2)} KB`;
    }

    return `${(
      kilobytes / 1024
    ).toFixed(2)} MB`;
  }
}