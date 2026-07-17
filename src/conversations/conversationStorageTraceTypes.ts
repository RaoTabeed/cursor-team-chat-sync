export interface StorageRecordMetadata {
    key: string;
  
    storageType: string;
  
    byteLength: number;
  }
  
  export interface HashReferenceTrace {
    sha256: string;
  
    sourcePaths: string[];
  
    targets:
      StorageRecordMetadata[];
  }
  
  export interface ComposerDataStorageTrace {
    exists: boolean;
  
    storageType:
      string | null;
  
    byteLength: number;
  
    topLevelFields: string[];
  
    embeddedJsonPaths:
      string[];
  
    hashReferences:
      HashReferenceTrace[];
  }
  
  export interface ConversationStorageTrace {
    composerId: string;
  
    headerId:
      string | null;
  
    headerIdReference:
      HashReferenceTrace | null;
  
    type:
      string | null;
  
    unifiedMode:
      string | null;
  
    matchSources: string[];
  
    storageModel: string;
  
    composerData:
      ComposerDataStorageTrace;
  
    keysContainingComposerId:
      StorageRecordMetadata[];
  
    agentBlobsMentioningComposerId:
      StorageRecordMetadata[];
  
    agentBlobsMentioningHeaderId:
      StorageRecordMetadata[];
  }
  
  export interface ProjectConversationStorageTrace {
    ok: true;
  
    databasePath: string;
  
    projectPath: string;
  
    conversationCount: number;
  
    conversations:
      ConversationStorageTrace[];
  }