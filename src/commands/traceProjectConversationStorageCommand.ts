import * as vscode from "vscode";

import type {
  CursorStorageLocator
} from "../cursor/cursorStorageLocator";

import type {
  ConversationStorageTraceService
} from "../conversations/conversationStorageTraceService";

import type {
  ConversationStorageTrace,
  HashReferenceTrace,
  StorageRecordMetadata
} from "../conversations/conversationStorageTraceTypes";

import type {
  OutputLogger
} from "../logging/outputLogger";

import type {
  CurrentProjectInspector
} from "../projects/currentProjectInspector";

export class TraceProjectConversationStorageCommand {
  public constructor(
    private readonly projectInspector:
      CurrentProjectInspector,

    private readonly storageLocator:
      CursorStorageLocator,

    private readonly traceService:
      ConversationStorageTraceService,

    private readonly logger:
      OutputLogger
  ) {}

  public async execute(): Promise<void> {
    this.logger.show();

    this.logger.info(
      "Tracing project conversation storage references in read-only mode..."
    );

    try {
      const project =
        await this.projectInspector.inspect();

      const storage =
        await this.storageLocator.inspect();

      const trace =
        await this.traceService.trace(
          storage.globalDatabasePath,
          project.projectPath
        );

      this.logger.info(
        "========================================"
      );

      this.logger.info(
        "PROJECT CONVERSATION STORAGE TRACE"
      );

      this.logger.info(
        `Project path: ${trace.projectPath}`
      );

      this.logger.info(
        `Global database: ${trace.databasePath}`
      );

      this.logger.info(
        `Real project conversations: ${trace.conversationCount}`
      );

      trace.conversations.forEach(
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

      await vscode.window
        .showInformationMessage(
          `Traced storage for ${trace.conversationCount} project conversations.`
        );
    } catch (error) {
      if (
        this.isCancellationError(
          error
        )
      ) {
        this.logger.info(
          "Conversation storage tracing was cancelled."
        );

        return;
      }

      this.logger.error(
        "Conversation storage tracing failed.",
        error
      );

      await vscode.window
        .showErrorMessage(
          "Conversation storage tracing failed. Check the Output panel."
        );
    }
  }

  private logConversation(
    conversation:
      ConversationStorageTrace,

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
      `Header ID: ${
        conversation.headerId ??
        "Not available"
      }`
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
      `Storage model: ${conversation.storageModel}`
    );

    this.logger.info(
      `Workspace match: ${conversation.matchSources.join(
        ", "
      )}`
    );

    this.logger.info(
      `Composer data exists: ${this.yesNo(
        conversation.composerData
          .exists
      )}`
    );

    this.logger.info(
      `Composer data size: ${this.formatBytes(
        conversation.composerData
          .byteLength
      )}`
    );

    this.logger.info(
      `Composer data fields: ${
        conversation.composerData
          .topLevelFields.join(", ") ||
        "None"
      }`
    );

    this.logger.info(
      `Embedded JSON strings: ${
        conversation.composerData
          .embeddedJsonPaths.length
      }`
    );

    for (
      const embeddedPath of
      conversation.composerData
        .embeddedJsonPaths
    ) {
      this.logger.info(
        `  Embedded JSON: ${embeddedPath}`
      );
    }

    this.logger.info(
      `Resolved hash candidates: ${
        conversation.composerData
          .hashReferences.length
      }`
    );

    for (
      const reference of
      conversation.composerData
        .hashReferences
    ) {
      this.logHashReference(
        reference
      );
    }

    if (
      conversation.headerIdReference
    ) {
      this.logger.info(
        "Header ID is a SHA-256 reference:"
      );

      this.logHashReference(
        conversation.headerIdReference
      );
    }

    this.logRecords(
      "Keys containing composer ID",
      conversation
        .keysContainingComposerId
    );

    this.logRecords(
      "Agent blobs mentioning composer ID",
      conversation
        .agentBlobsMentioningComposerId
    );

    this.logRecords(
      "Agent blobs mentioning header ID",
      conversation
        .agentBlobsMentioningHeaderId
    );
  }

  private logHashReference(
    reference:
      HashReferenceTrace
  ): void {
    this.logger.info(
      `  Hash: ${reference.sha256}`
    );

    this.logger.info(
      `    Source paths: ${reference.sourcePaths.join(
        ", "
      )}`
    );

    if (
      reference.targets.length === 0
    ) {
      this.logger.info(
        "    Database target: Not found"
      );

      return;
    }

    for (
      const target of
      reference.targets
    ) {
      this.logger.info(
        `    Target: ${target.key}`
      );

      this.logger.info(
        `      Storage: ${target.storageType}`
      );

      this.logger.info(
        `      Size: ${this.formatBytes(
          target.byteLength
        )}`
      );
    }
  }

  private logRecords(
    heading: string,
    records:
      StorageRecordMetadata[]
  ): void {
    this.logger.info(
      `${heading}: ${records.length}`
    );

    for (
      const record of records
    ) {
      this.logger.info(
        `  Key: ${record.key}`
      );

      this.logger.info(
        `    Storage: ${record.storageType}`
      );

      this.logger.info(
        `    Size: ${this.formatBytes(
          record.byteLength
        )}`
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