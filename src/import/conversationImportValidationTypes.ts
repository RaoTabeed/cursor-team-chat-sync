export type ConversationImportStatus =
  | "new"
  | "identical"
  | "conflict";

export type ConversationImportAction =
  | "import"
  | "skip"
  | "review";

export interface ConversationImportPlanEntry {
  composerId: string;

  status:
    ConversationImportStatus;

  recommendedAction:
    ConversationImportAction;

  localHeaderExists:
    boolean;

  headerMatches: boolean;

  bundleRecordCount:
    number;

  localDirectRecordCount:
    number;

  matchingRecordCount:
    number;

  missingRecordCount:
    number;

  changedRecordCount:
    number;

  extraDirectRecordCount:
    number;

  missingRecordKeys:
    string[];

  changedRecordKeys:
    string[];

  extraDirectRecordKeys:
    string[];

  createdAt:
    number | null;

  lastUpdatedAt:
    number | null;

  type:
    string | null;

  unifiedMode:
    string | null;
}

export interface ConversationImportValidationResult {
  ok: true;

  validationVersion:
    number;

  validatedAt: string;

  bundle: {
    path: string;

    sha256: string;

    format: string;

    version: number;

    generatedAt:
      string | null;

    manifestSha256:
      string;

    verifiedPayloadCount:
      number;

    verifiedPayloadByteLength:
      number;
  };

  source: {
    projectPath:
      string | null;
  };

  destination: {
    projectPath: string;

    databasePath: string;

    workspaceIds:
      string[];

    sameNormalizedProjectPath:
      boolean;
  };

  summary: {
    conversationCount:
      number;

    newCount: number;

    identicalCount:
      number;

    conflictCount:
      number;

    recommendedImportCount:
      number;

    recommendedSkipCount:
      number;

    requiresReviewCount:
      number;

    verifiedPayloadCount:
      number;

    verifiedPayloadByteLength:
      number;
  };

  conversations:
    ConversationImportPlanEntry[];
}