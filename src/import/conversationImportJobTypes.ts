export interface ConversationImportJob {
  version: 4;

  jobId: string;

  createdAt: string;

  extensionHostProcessId: number;

  bundlePath: string;

  bundleSha256: string;

  encryptedBundlePath: string;

  destinationDatabasePath: string;

  destinationWorkspaceDatabasePath: string;

  destinationProjectPath: string;

  destinationWorkspaceId: string;

  backupRoot: string;

  resultPath: string;

  waitTimeoutSeconds: number;
}

export interface ConversationImportLaunchResult {
  jobId: string;

  jobPath: string;

  resultPath: string;

  backupRoot: string;
}

export interface SuccessfulConversationImportResult {
  ok: true;

  resultVersion: 3;

  jobId: string;

  completedAt: string;

  destinationDatabasePath: string;

  destinationWorkspaceDatabasePath: string;

  destinationProjectPath: string;

  destinationWorkspaceId: string;

  backupDirectory: string;

  bundleSha256: string;

  importedConversationCount: number;

  skippedConversationCount: number;

  insertedRecordCount: number;

  skippedRecordCount: number;

  finalIdenticalCount: number;

  finalConflictCount: number;

  workspaceMetadataUpdated: boolean;

  workspaceSidebarCount: number;

  workspaceAnchorComposerId: string | null;

  workspaceIndexVerified: boolean;
}

export interface FailedConversationImportResult {
  ok: false;

  resultVersion: 3;

  jobId: string | null;

  completedAt: string;

  error: string;
}

export type ConversationImportWorkerResult =
  | SuccessfulConversationImportResult
  | FailedConversationImportResult;