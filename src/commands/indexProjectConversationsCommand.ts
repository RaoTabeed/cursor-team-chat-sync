import * as vscode from "vscode";

import type {
  CursorStorageLocator
} from "../cursor/cursorStorageLocator";

import type {
  ProjectConversationMetadata
} from "../conversations/projectConversationTypes";

import type {
  ProjectConversationIndexService
} from "../conversations/projectConversationIndexService";

import type {
  OutputLogger
} from "../logging/outputLogger";

import type {
  CurrentProjectInspector
} from "../projects/currentProjectInspector";

export class IndexProjectConversationsCommand {
  public constructor(
    private readonly projectInspector:
      CurrentProjectInspector,

    private readonly storageLocator:
      CursorStorageLocator,

    private readonly conversationIndexService:
      ProjectConversationIndexService,

    private readonly logger:
      OutputLogger
  ) {}

  public async execute(): Promise<void> {
    this.logger.show();

    this.logger.info(
      "Building metadata-only project conversation index..."
    );

    try {
      const project =
        await this.projectInspector.inspect();

      const storage =
        await this.storageLocator.inspect();

      const index =
        await this.conversationIndexService
          .index(
            storage.globalDatabasePath,
            project.projectPath
          );

      this.logger.info(
        "========================================"
      );

      this.logger.info(
        "PROJECT CONVERSATION INDEX"
      );

      this.logger.info(
        `Project path: ${index.projectPath}`
      );

      this.logger.info(
        `Global database: ${index.databasePath}`
      );

      this.logger.info(
        `Composer headers scanned: ${index.headersScanned}`
      );

      this.logger.info(
        `Matched conversations: ${index.matchedConversationCount}`
      );
      this.logger.info(
        `Sync eligible: ${index.summary.syncEligibleCount}`
      );

      this.logger.info(
        `Active: ${index.summary.activeCount}`
      );

      this.logger.info(
        `Archived: ${index.summary.archivedCount}`
      );

      this.logger.info(
        `Drafts: ${index.summary.draftCount}`
      );

      this.logger.info(
        `Unread: ${index.summary.unreadCount}`
      );

      this.logger.info(
        `With composer data: ${index.summary.withComposerDataCount}`
      );

      this.logger.info(
        `Total bubbles: ${index.summary.totalBubbleCount}`
      );

      this.logger.info(
        `Total checkpoints: ${index.summary.totalCheckpointCount}`
      );

      index.conversations.forEach(
        (
          conversation,
          indexPosition
        ) => {
          this.logConversation(
            conversation,
            indexPosition + 1
          );
        }
      );

      await vscode.window
        .showInformationMessage(
          `Found ${index.matchedConversationCount} project conversations with ${index.summary.totalBubbleCount} bubbles.`
        );
    } catch (error) {
      if (
        this.isCancellationError(error)
      ) {
        this.logger.info(
          "Conversation indexing was cancelled."
        );

        return;
      }

      this.logger.error(
        "Project conversation indexing failed.",
        error
      );

      await vscode.window
        .showErrorMessage(
          "Project conversation indexing failed. Check the Output panel."
        );
    }
  }

  private logConversation(
    conversation:
      ProjectConversationMetadata,

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
      `Workspace ID: ${
        conversation.workspaceId ??
        "Not available"
      }`
    );

    this.logger.info(
      `Workspace match: ${
        conversation.matchSources.join(
          ", "
        ) || "Not available"
      }`
    );

    this.logger.info(
      `Created: ${this.formatTimestamp(
        conversation.createdAt
      )}`
    );

    this.logger.info(
      `Last updated: ${this.formatTimestamp(
        conversation.lastUpdatedAt
      )}`
    );

    this.logger.info(
      `Type: ${
        conversation.type ??
        "Not available"
      }`
    );

    this.logger.info(
      `Unified mode: ${
        conversation.unifiedMode ??
        "Not available"
      }`
    );

    this.logger.info(
      `Force mode: ${
        conversation.forceMode ??
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
      `Worktree: ${this.yesNo(
        conversation.isWorktree
      )}`
    );

    this.logger.info(
      `Spec: ${this.yesNo(
        conversation.isSpec
      )}`
    );

    this.logger.info(
      `Project conversation: ${this.yesNo(
        conversation.isProject
      )}`
    );

    this.logger.info(
      `Unread: ${this.yesNo(
        conversation.hasUnreadMessages
      )}`
    );

    this.logger.info(
      `Bubbles: ${conversation.bubbleCount}`
    );

    this.logger.info(
      `Checkpoints: ${conversation.checkpointCount}`
    );

    this.logger.info(
      `Sub-composers: ${
        conversation.numSubComposers ??
        0
      }`
    );

    this.logger.info(
      `Lines added: ${
        conversation.totalLinesAdded ??
        0
      }`
    );

    this.logger.info(
      `Lines removed: ${
        conversation.totalLinesRemoved ??
        0
      }`
    );

    this.logger.info(
      `Composer data exists: ${this.yesNo(
        conversation.composerData.exists
      )}`
    );

    this.logger.info(
      `Composer data size: ${this.formatBytes(
        conversation.composerData
          .byteLength
      )}`
    );

    this.logger.info(
      `Composer data JSON: ${this.yesNo(
        conversation.composerData.isJson
      )}`
    );

    this.logger.info(
        `Sync eligible: ${this.yesNo(
          conversation.syncEligible
        )}`
      );
      
      this.logger.info(
        `Conversation state present: ${this.yesNo(
          conversation.composerData
            .conversationStatePresent
        )}`
      );
      
      this.logger.info(
        `Conversation state size: ${this.formatBytes(
          conversation.composerData
            .conversationStateByteLength
        )}`
      );
      
      this.logger.info(
        `Conversation state format: ${
          conversation.composerData
            .conversationStateFormat ??
          "Not available"
        }`
      );
      
      this.logger.info(
        `Conversation state SHA-256: ${
          conversation.composerData
            .conversationStateSha256 ??
          "Not available"
        }`
      );

    this.logger.info(
      `Conversation-map entries: ${
        conversation.composerData
          .conversationMapEntryCount
      }`
    );

    this.logger.info(
      `Capabilities: ${
        conversation.composerData
          .capabilityCount
      }`
    );

    this.logger.info(
      `Encryption key present: ${this.yesNo(
        conversation.composerData
          .blobEncryptionKeyPresent
      )}`
    );
  }

  private formatTimestamp(
    timestamp:
      number | null
  ): string {
    if (timestamp === null) {
      return "Not available";
    }

    const milliseconds =
      timestamp <
      10_000_000_000
        ? timestamp * 1000
        : timestamp;

    const date =
      new Date(milliseconds);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return String(timestamp);
    }

    return date.toISOString();
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

    return `${(
      kilobytes / 1024
    ).toFixed(2)} MB`;
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