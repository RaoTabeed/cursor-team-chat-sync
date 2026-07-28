export interface ConversationBundleExportResult {
  ok: true;

  bundleFormat: string;

  bundleVersion: number;

  generatedAt: string;

  bundlePath: string;

  bundleByteLength:
    number;

  bundleSha256: string;

  manifestSha256: string;

  conversationCount:
    number;

  headerFragmentCount:
    number;

  sqliteRecordCount:
    number;

  totalPayloadCount:
    number;

  totalPayloadByteLength:
    number;

  verifiedPayloadCount:
    number;

  verified: boolean;

  encrypted: boolean;

  workspaceId?:
    string;

  workspaceDatabasePath?:
    string;

  globalHeaderCount?:
    number;

  workspaceHeaderCount?:
    number;

  resolvedHeaderCount?:
    number;

  workspaceOnlyComposerIds?:
    string[];

  conversationDetectionSource?:
    string;
}