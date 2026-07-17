import * as vscode from "vscode";

import {
  BuildConversationBundleManifestCommand
} from "./commands/buildConversationBundleManifestCommand";

import {
  ExportConversationBundleCommand
} from "./commands/exportConversationBundleCommand";

import {
  ExportEncryptedConversationBundleCommand
} from "./commands/exportEncryptedConversationBundleCommand";

import {
  IndexProjectConversationsCommand
} from "./commands/indexProjectConversationsCommand";

import {
  InspectCurrentProjectCommand
} from "./commands/inspectCurrentProjectCommand";

import {
  InspectCursorDatabasesCommand
} from "./commands/inspectCursorDatabasesCommand";

import {
  InspectCursorStorageCommand
} from "./commands/inspectCursorStorageCommand";

import {
  TraceProjectConversationStorageCommand
} from "./commands/traceProjectConversationStorageCommand";

import {
  COMMANDS
} from "./constants/commands";

import {
  ConversationStorageTraceService
} from "./conversations/conversationStorageTraceService";

import {
  ProjectConversationIndexService
} from "./conversations/projectConversationIndexService";

import {
  CursorSyncKeyService
} from "./crypto/cursorSyncKeyService";

import {
  EncryptedBundleService
} from "./crypto/encryptedBundleService";

import {
  SyncKeyRecoveryFileService
} from "./crypto/syncKeyRecoveryFileService";

import {
  CursorStorageLocator
} from "./cursor/cursorStorageLocator";

import {
  CursorDatabaseInspectorService
} from "./database/cursorDatabaseInspectorService";

import {
  ConversationBundleExportService
} from "./export/conversationBundleExportService";

import {
  ConversationBundleManifestService
} from "./export/conversationBundleManifestService";

import {
  ManifestFileWriterService
} from "./export/manifestFileWriterService";

import {
  GitService
} from "./git/gitService";

import {
  OutputLogger
} from "./logging/outputLogger";

import {
  CurrentProjectInspector
} from "./projects/currentProjectInspector";

import {
  ProjectIdentityService
} from "./projects/projectIdentityService";

import {
  PythonJsonScriptRunner
} from "./runtime/pythonJsonScriptRunner";

export function activate(
  context: vscode.ExtensionContext
): void {
  const logger =
    new OutputLogger();

  const storageLocator =
    new CursorStorageLocator();

  const gitService =
    new GitService();

  const projectIdentityService =
    new ProjectIdentityService();

  const pythonRunner =
    new PythonJsonScriptRunner(
      context.extensionPath
    );

  const databaseInspector =
    new CursorDatabaseInspectorService(
      pythonRunner
    );

  const conversationIndexService =
    new ProjectConversationIndexService(
      pythonRunner
    );

  const conversationStorageTraceService =
    new ConversationStorageTraceService(
      pythonRunner
    );

  const conversationBundleManifestService =
    new ConversationBundleManifestService(
      pythonRunner
    );

  const manifestFileWriter =
    new ManifestFileWriterService(
      context.globalStorageUri.fsPath
    );

  const conversationBundleExportService =
    new ConversationBundleExportService(
      pythonRunner,
      context.globalStorageUri.fsPath
    );

  const cursorSyncKeyService =
    new CursorSyncKeyService();

  const encryptedBundleService =
    new EncryptedBundleService();

  const syncKeyRecoveryFileService =
    new SyncKeyRecoveryFileService();

  const currentProjectInspector =
    new CurrentProjectInspector(
      storageLocator,
      gitService,
      projectIdentityService
    );

  const inspectStorageCommand =
    new InspectCursorStorageCommand(
      storageLocator,
      logger
    );

  const inspectCurrentProjectCommand =
    new InspectCurrentProjectCommand(
      currentProjectInspector,
      logger
    );

  const inspectCursorDatabasesCommand =
    new InspectCursorDatabasesCommand(
      currentProjectInspector,
      storageLocator,
      databaseInspector,
      logger
    );

  const indexProjectConversationsCommand =
    new IndexProjectConversationsCommand(
      currentProjectInspector,
      storageLocator,
      conversationIndexService,
      logger
    );

  const traceProjectConversationStorageCommand =
    new TraceProjectConversationStorageCommand(
      currentProjectInspector,
      storageLocator,
      conversationStorageTraceService,
      logger
    );

  const buildConversationBundleManifestCommand =
    new BuildConversationBundleManifestCommand(
      currentProjectInspector,
      storageLocator,
      conversationBundleManifestService,
      manifestFileWriter,
      logger
    );

  const exportConversationBundleCommand =
    new ExportConversationBundleCommand(
      currentProjectInspector,
      storageLocator,
      conversationBundleExportService,
      logger
    );

  const exportEncryptedConversationBundleCommand =
    new ExportEncryptedConversationBundleCommand(
      currentProjectInspector,
      storageLocator,
      conversationBundleExportService,
      cursorSyncKeyService,
      encryptedBundleService,
      syncKeyRecoveryFileService,
      logger
    );

  context.subscriptions.push(
    logger,

    vscode.commands.registerCommand(
      COMMANDS.inspectStorage,
      () =>
        inspectStorageCommand.execute()
    ),

    vscode.commands.registerCommand(
      COMMANDS.inspectCurrentProject,
      () =>
        inspectCurrentProjectCommand
          .execute()
    ),

    vscode.commands.registerCommand(
      COMMANDS
        .inspectCurrentProjectDatabases,
      () =>
        inspectCursorDatabasesCommand
          .execute()
    ),

    vscode.commands.registerCommand(
      COMMANDS
        .indexProjectConversations,
      () =>
        indexProjectConversationsCommand
          .execute()
    ),

    vscode.commands.registerCommand(
      COMMANDS
        .traceProjectConversationStorage,
      () =>
        traceProjectConversationStorageCommand
          .execute()
    ),

    vscode.commands.registerCommand(
      COMMANDS
        .buildConversationBundleManifest,
      () =>
        buildConversationBundleManifestCommand
          .execute()
    ),

    vscode.commands.registerCommand(
      COMMANDS
        .exportConversationBundle,
      () =>
        exportConversationBundleCommand
          .execute()
    ),

    vscode.commands.registerCommand(
      COMMANDS
        .exportEncryptedConversationBundle,
      () =>
        exportEncryptedConversationBundleCommand
          .execute()
    )
  );

  logger.info(
    "Cursor Team Chat Sync activated."
  );
}

export function deactivate(): void {
  // Resources registered inside context.subscriptions
  // are disposed automatically.
}