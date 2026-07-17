import * as vscode from "vscode";

import type {
  CursorStorageLocator
} from "../cursor/cursorStorageLocator";

import type {
  ConversationBundleManifestEntry,
  ProjectConversationBundleManifest
} from "../export/conversationBundleManifestTypes";

import type {
  ConversationBundleManifestService
} from "../export/conversationBundleManifestService";

import type {
  ManifestFileWriterService
} from "../export/manifestFileWriterService";

import type {
  OutputLogger
} from "../logging/outputLogger";

import type {
  CurrentProjectInspector
} from "../projects/currentProjectInspector";

export class BuildConversationBundleManifestCommand {
  public constructor(
    private readonly projectInspector:
      CurrentProjectInspector,

    private readonly storageLocator:
      CursorStorageLocator,

    private readonly manifestService:
      ConversationBundleManifestService,

    private readonly manifestFileWriter:
      ManifestFileWriterService,

    private readonly logger:
      OutputLogger
  ) {}

  public async execute(): Promise<void> {
    this.logger.show();

    this.logger.info(
      "Building exact conversation bundle manifest in read-only mode..."
    );

    try {
      const project =
        await this.projectInspector
          .inspect();

      const storage =
        await this.storageLocator
          .inspect();

      const manifest =
        await this.manifestService
          .build(
            storage.globalDatabasePath,
            project.projectPath
          );

      const manifestPath =
        await this.manifestFileWriter
          .write(manifest);

      this.logManifest(
        manifest,
        manifestPath
      );

      const selectedAction =
        await vscode.window
          .showInformationMessage(
            [
              "Conversation manifest created.",
              `${manifest.summary.uploadCandidateCount}`,
              "conversations are selected",
              "for the future upload bundle."
            ].join(" "),
            "Open Manifest"
          );

      if (
        selectedAction ===
        "Open Manifest"
      ) {
        const document =
          await vscode.workspace
            .openTextDocument(
              vscode.Uri.file(
                manifestPath
              )
            );

        await vscode.window
          .showTextDocument(
            document,
            {
              preview: false
            }
          );
      }
    } catch (error) {
      if (
        this.isCancellationError(
          error
        )
      ) {
        this.logger.info(
          "Conversation manifest creation was cancelled."
        );

        return;
      }

      this.logger.error(
        "Conversation manifest creation failed.",
        error
      );

      await vscode.window
        .showErrorMessage(
          "Conversation manifest creation failed. Check the Output panel."
        );
    }
  }

  private logManifest(
    manifest:
      ProjectConversationBundleManifest,

    manifestPath: string
  ): void {
    this.logger.info(
      "========================================"
    );

    this.logger.info(
      "CONVERSATION BUNDLE MANIFEST"
    );

    this.logger.info(
      `Manifest version: ${manifest.manifestVersion}`
    );

    this.logger.info(
      `Generated at: ${manifest.generatedAt}`
    );

    this.logger.info(
      `Project path: ${manifest.projectPath}`
    );

    this.logger.info(
      `Headers scanned: ${manifest.headersScanned}`
    );

    this.logger.info(
      `Matched project headers: ${manifest.matchedHeaderCount}`
    );

    this.logger.info(
      `Conversations: ${manifest.summary.conversationCount}`
    );

    this.logger.info(
      `Upload candidates: ${manifest.summary.uploadCandidateCount}`
    );

    this.logger.info(
      `System placeholders ignored: ${manifest.summary.systemPlaceholderCount}`
    );

    this.logger.info(
      `Total inventoried records: ${manifest.summary.totalRecordCount}`
    );

    this.logger.info(
      `Total source bytes: ${this.formatBytes(
        manifest.summary
          .totalByteLength
      )}`
    );

    this.logger.info(
      `Unresolved hash references: ${manifest.summary.unresolvedHashReferenceCount}`
    );

    this.logger.info(
      `Manifest saved: ${manifestPath}`
    );

    manifest.conversations.forEach(
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
      ConversationBundleManifestEntry,

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
      `Should upload: ${this.yesNo(
        conversation.shouldUpload
      )}`
    );

    this.logger.info(
      `Type: ${
        conversation.type ??
        "Not available"
      }`
    );

    this.logger.info(
      `Mode: ${
        conversation.unifiedMode ??
        "Not available"
      }`
    );

    this.logger.info(
      `Archived: ${this.yesNo(
        conversation.isArchived
      )}`
    );

    this.logger.info(
      `Draft: ${this.yesNo(
        conversation.isDraft
      )}`
    );

    this.logger.info(
      `Direct records: ${conversation.directRecordCount}`
    );

    this.logger.info(
      `Referenced records: ${conversation.referencedRecordCount}`
    );

    this.logger.info(
      `Total records: ${conversation.totalRecordCount}`
    );

    this.logger.info(
      `Source size: ${this.formatBytes(
        conversation.totalByteLength
      )}`
    );

    this.logger.info(
      `Unresolved hashes: ${conversation.unresolvedHashReferenceCount}`
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