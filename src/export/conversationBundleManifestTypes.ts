export type ManifestRecordKind =
  | "header-fragment"
  | "sqlite-record";

export interface ConversationManifestRecord {
  recordKind:
    ManifestRecordKind;

  tableName: string;

  key: string;

  selector?: string;

  recordFamily: string;

  sqliteType: string;

  byteLength: number;

  sha256: string;

  source: string;

  referenceDepth: number;

  referencedBy: string[];
}

export interface UnresolvedHashReference {
  sha256: string;

  referencedBy: string[];
}

export interface ConversationBundleManifestEntry {
  composerId: string;

  shouldUpload: boolean;

  isSystemPlaceholder:
    boolean;

  matchSources: string[];

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

  directRecordCount: number;

  referencedRecordCount:
    number;

  totalRecordCount: number;

  totalByteLength: number;

  unresolvedHashReferenceCount:
    number;

  headerFragment:
    ConversationManifestRecord;

  records:
    ConversationManifestRecord[];

  unresolvedHashReferences:
    UnresolvedHashReference[];
}

export interface ConversationBundleManifestSummary {
  conversationCount: number;

  uploadCandidateCount:
    number;

  systemPlaceholderCount:
    number;

  totalRecordCount: number;

  totalByteLength: number;

  unresolvedHashReferenceCount:
    number;
}

export interface ProjectConversationBundleManifest {
  ok: true;

  manifestVersion: number;

  generatedAt: string;

  databasePath: string;

  projectPath: string;

  headersScanned: number;

  matchedHeaderCount: number;

  summary:
    ConversationBundleManifestSummary;

  conversations:
    ConversationBundleManifestEntry[];
}