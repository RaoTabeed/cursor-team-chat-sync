export interface CursorSyncKeyMaterial {
    version: 1;
    vaultId: string;
    syncKey: string;
    keyBytes: Buffer;
  }
  
  export interface GeneratedCursorSyncKey
    extends CursorSyncKeyMaterial {
    createdAt: string;
  }
  
  export interface ParsedCursorSyncKey
    extends CursorSyncKeyMaterial {}