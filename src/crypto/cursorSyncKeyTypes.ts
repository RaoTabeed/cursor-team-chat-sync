export interface GeneratedCursorSyncKey {
    version: 1;
  
    vaultId: string;
  
    createdAt: string;
  
    syncKey: string;
  
    keyBytes: Buffer;
  }
  
  export interface ParsedCursorSyncKey {
    version: 1;
  
    vaultId: string;
  
    syncKey: string;
  
    keyBytes: Buffer;
  }