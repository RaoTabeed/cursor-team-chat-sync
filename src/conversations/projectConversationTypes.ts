export interface ComposerDataMetadata {
    exists: boolean;
  
    storageType:
      string | null;
  
    byteLength: number;
  
    isJson: boolean;
  
    version:
      number | null;
  
    createdAt:
      number | null;
  
    conversationStatePresent:
      boolean;
  
    conversationStateByteLength:
      number;
  
    conversationStateSha256:
      string | null;
  
    conversationStateFormat:
      string | null;
  
    conversationMapEntryCount:
      number;
  
    capabilityCount:
      number;
  
    blobEncryptionKeyPresent:
      boolean;
  }
  
  export interface ProjectConversationMetadata {
    composerId: string;
  
    workspaceId:
      string | null;
  
    matchSources: string[];
  
    syncEligible: boolean;
  
    createdAt:
      number | null;
  
    lastUpdatedAt:
      number | null;
  
    type:
      string | null;
  
    unifiedMode:
      string | null;
  
    forceMode:
      string | null;
  
    isArchived: boolean;
  
    isDraft: boolean;
  
    isWorktree: boolean;
  
    isSpec: boolean;
  
    isProject: boolean;
  
    hasUnreadMessages:
      boolean;
  
    numSubComposers:
      number | null;
  
    totalLinesAdded:
      number | null;
  
    totalLinesRemoved:
      number | null;
  
    bubbleCount: number;
  
    checkpointCount: number;
  
    composerData:
      ComposerDataMetadata;
  }
  
  export interface ProjectConversationSummary {
    activeCount: number;
  
    archivedCount: number;
  
    draftCount: number;
  
    unreadCount: number;
  
    withComposerDataCount:
      number;
  
    syncEligibleCount:
      number;
  
    totalBubbleCount:
      number;
  
    totalCheckpointCount:
      number;
  }
  
  export interface ProjectConversationIndex {
    ok: true;
  
    databasePath: string;
  
    projectPath: string;
  
    headersScanned: number;
  
    matchedConversationCount:
      number;
  
    summary:
      ProjectConversationSummary;
  
    conversations:
      ProjectConversationMetadata[];
  }