import * as path from "node:path";

import * as vscode from "vscode";

import {
  CloudProjectDescriptorService
} from "./cloud/cloudProjectDescriptorService";

import {
  CloudVaultCredentialStore
} from "./cloud/cloudVaultCredentialStore";

import {
  CursorCloudStorageService
} from "./cloud/cursorCloudStorageService";

import {
  CursorCloudSyncApiService
} from "./cloud/cursorCloudSyncApiService";

import {
  SupabaseConfigService
} from "./cloud/supabaseConfigService";

import {
  BuildConversationBundleManifestCommand
} from "./commands/buildConversationBundleManifestCommand";

import {
  CopySavedSyncKeyCommand
} from "./commands/copySavedSyncKeyCommand";

import {
  ExportConversationBundleCommand
} from "./commands/exportConversationBundleCommand";

import {
  ExportEncryptedConversationBundleCommand
} from "./commands/exportEncryptedConversationBundleCommand";

import {
  ImportChatsFromCloudCommand
} from "./commands/importChatsFromCloudCommand";

import {
  ImportEncryptedConversationBundleCommand
} from "./commands/importEncryptedConversationBundleCommand";

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
  ManageCloudBundlesCommand
} from "./commands/manageCloudBundlesCommand";

import {
  TraceProjectConversationStorageCommand
} from "./commands/traceProjectConversationStorageCommand";

import {
  UploadAllChatsToCloudCommand
} from "./commands/uploadAllChatsToCloudCommand";

import {
  ValidateEncryptedConversationBundleCommand
} from "./commands/validateEncryptedConversationBundleCommand";

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
  EncryptedBundleDecryptionService
} from "./crypto/encryptedBundleDecryptionService";

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
  ConversationImportJobService
} from "./import/conversationImportJobService";

import {
  ConversationImportResultReporter
} from "./import/conversationImportResultReporter";

import {
  ConversationImportValidationService
} from "./import/conversationImportValidationService";

import {
  ImportValidationReportWriterService
} from "./import/importValidationReportWriterService";

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

  /*
   * Core Cursor storage and project services.
   */

  const storageLocator =
    new CursorStorageLocator();

  const gitService =
    new GitService();

  const projectIdentityService =
    new ProjectIdentityService();

  const currentProjectInspector =
    new CurrentProjectInspector(
      storageLocator,
      gitService,
      projectIdentityService
    );

  /*
   * Python runtime and database inspection services.
   */

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

  /*
   * Conversation bundle creation services.
   */

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

  /*
   * Encryption and Sync Key services.
   */

  const cursorSyncKeyService =
    new CursorSyncKeyService();

  const encryptedBundleService =
    new EncryptedBundleService();

  const encryptedBundleDecryptionService =
    new EncryptedBundleDecryptionService(
      path.join(
        context.globalStorageUri.fsPath,
        "import-validation",
        "temporary"
      )
    );

  const syncKeyRecoveryFileService =
    new SyncKeyRecoveryFileService();

  /*
   * Import validation and transactional import services.
   */

  const conversationImportValidationService =
    new ConversationImportValidationService(
      pythonRunner
    );

  const importValidationReportWriterService =
    new ImportValidationReportWriterService(
      context.globalStorageUri.fsPath
    );

  const conversationImportJobService =
    new ConversationImportJobService(
      context.extensionPath,
      context.globalStorageUri.fsPath
    );

  const conversationImportResultReporter =
    new ConversationImportResultReporter(
      conversationImportJobService,
      logger
    );

  /*
   * Supabase cloud services.
   */

  const cloudProjectDescriptorService =
    new CloudProjectDescriptorService();

  const supabaseConfigService =
    new SupabaseConfigService();

  const cursorCloudSyncApiService =
    new CursorCloudSyncApiService(
      supabaseConfigService
    );

  const cursorCloudStorageService =
    new CursorCloudStorageService(
      supabaseConfigService
    );

  const cloudVaultCredentialStore =
    new CloudVaultCredentialStore(
      context.secrets
    );

  /*
   * Inspection commands.
   */

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

  /*
   * Local bundle commands.
   */

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

  /*
   * Local validation and import commands.
   */

  const validateEncryptedConversationBundleCommand =
    new ValidateEncryptedConversationBundleCommand(
      currentProjectInspector,
      storageLocator,
      cursorSyncKeyService,
      encryptedBundleDecryptionService,
      conversationImportValidationService,
      importValidationReportWriterService,
      logger
    );

  const importEncryptedConversationBundleCommand =
    new ImportEncryptedConversationBundleCommand(
      currentProjectInspector,
      storageLocator,
      cursorSyncKeyService,
      encryptedBundleDecryptionService,
      conversationImportValidationService,
      conversationImportJobService,
      logger
    );

  /*
   * Cloud commands.
   */

  const uploadAllChatsToCloudCommand =
    new UploadAllChatsToCloudCommand(
      currentProjectInspector,
      storageLocator,
      cloudProjectDescriptorService,
      conversationBundleExportService,
      cursorSyncKeyService,
      encryptedBundleService,
      cursorCloudSyncApiService,
      cursorCloudStorageService,
      cloudVaultCredentialStore,
      syncKeyRecoveryFileService,
      logger
    );

  const importChatsFromCloudCommand =
    new ImportChatsFromCloudCommand(
      currentProjectInspector,
      storageLocator,
      cloudProjectDescriptorService,
      cursorSyncKeyService,
      cloudVaultCredentialStore,
      cursorCloudSyncApiService,
      cursorCloudStorageService,
      encryptedBundleDecryptionService,
      conversationImportValidationService,
      conversationImportJobService,
      path.join(
        context.globalStorageUri.fsPath,
        "cloud-downloads"
      ),
      logger
    );

  const manageCloudBundlesCommand =
    new ManageCloudBundlesCommand(
      currentProjectInspector,
      cloudProjectDescriptorService,
      cursorSyncKeyService,
      cloudVaultCredentialStore,
      cursorCloudSyncApiService,
      logger
    );

  const copySavedSyncKeyCommand =
    new CopySavedSyncKeyCommand(
      currentProjectInspector,
      cloudProjectDescriptorService,
      cloudVaultCredentialStore,
      cursorSyncKeyService,
      logger
    );

  /*
   * Register every extension command.
   */

  context.subscriptions.push(
    logger,

    vscode.commands.registerCommand(
      COMMANDS.inspectStorage,
      () =>
        inspectStorageCommand
          .execute()
    ),

    vscode.commands.registerCommand(
      COMMANDS.inspectCurrentProject,
      () =>
        inspectCurrentProjectCommand
          .execute()
    ),

    vscode.commands.registerCommand(
      COMMANDS.inspectCurrentProjectDatabases,
      () =>
        inspectCursorDatabasesCommand
          .execute()
    ),

    vscode.commands.registerCommand(
      COMMANDS.indexProjectConversations,
      () =>
        indexProjectConversationsCommand
          .execute()
    ),

    vscode.commands.registerCommand(
      COMMANDS.traceProjectConversationStorage,
      () =>
        traceProjectConversationStorageCommand
          .execute()
    ),

    vscode.commands.registerCommand(
      COMMANDS.buildConversationBundleManifest,
      () =>
        buildConversationBundleManifestCommand
          .execute()
    ),

    vscode.commands.registerCommand(
      COMMANDS.exportConversationBundle,
      () =>
        exportConversationBundleCommand
          .execute()
    ),

    vscode.commands.registerCommand(
      COMMANDS.exportEncryptedConversationBundle,
      () =>
        exportEncryptedConversationBundleCommand
          .execute()
    ),

    vscode.commands.registerCommand(
      COMMANDS.validateEncryptedConversationBundle,
      () =>
        validateEncryptedConversationBundleCommand
          .execute()
    ),

    vscode.commands.registerCommand(
      COMMANDS.importEncryptedConversationBundle,
      () =>
        importEncryptedConversationBundleCommand
          .execute()
    ),

    vscode.commands.registerCommand(
      COMMANDS.uploadAllChatsToCloud,
      () =>
        uploadAllChatsToCloudCommand
          .execute()
    ),

    vscode.commands.registerCommand(
      COMMANDS.importChatsFromCloud,
      () =>
        importChatsFromCloudCommand
          .execute()
    ),

    vscode.commands.registerCommand(
      COMMANDS.manageCloudBundles,
      () =>
        manageCloudBundlesCommand
          .execute()
    ),

    vscode.commands.registerCommand(
      COMMANDS.copySavedSyncKey,
      () =>
        copySavedSyncKeyCommand
          .execute()
    )
  );

  logger.info(
    "Cursor Team Chat Sync activated."
  );

  /*
   * Report a completed external import when Cursor opens again.
   */

  void conversationImportResultReporter
    .reportLatest();
}

export function deactivate(): void {
  /*
   * Services registered in context.subscriptions
   * are disposed automatically.
   */
}