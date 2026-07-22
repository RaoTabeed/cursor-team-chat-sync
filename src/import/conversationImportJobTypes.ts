export interface ConversationImportJob {
    version: 1;
  
    jobId: string;
  
    createdAt: string;
  
    bundlePath: string;
  
    bundleSha256: string;
  
    encryptedBundlePath:
      string;
  
    destinationDatabasePath:
      string;
  
    destinationProjectPath:
      string;
  
    destinationWorkspaceId:
      string;
  
    backupRoot: string;
  
    resultPath: string;
  
    waitTimeoutSeconds:
      number;
  }
  
  export interface ConversationImportLaunchResult {
    jobId: string;
  
    jobPath: string;
  
    resultPath: string;
  
    backupRoot: string;
  }
  
  export interface SuccessfulConversationImportResult {
    ok: true;
  
    resultVersion: number;
  
    jobId: string;
  
    completedAt: string;
  
    destinationDatabasePath:
      string;
  
    destinationProjectPath:
      string;
  
    destinationWorkspaceId:
      string;
  
    backupDirectory: string;
  
    bundleSha256: string;
  
    importedConversationCount:
      number;
  
    skippedConversationCount:
      number;
  
    insertedRecordCount:
      number;
  
    skippedRecordCount:
      number;
  
    finalIdenticalCount:
      number;
  
    finalConflictCount:
      number;
  }
  
  export interface FailedConversationImportResult {
    ok: false;
  
    resultVersion: number;
  
    jobId:
      string | null;
  
    completedAt: string;
  
    error: string;
  }
  
  export type ConversationImportWorkerResult =
    | SuccessfulConversationImportResult
    | FailedConversationImportResult;