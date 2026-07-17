export interface DatabaseColumnInspection {
    cid: number;
  
    name: string;
  
    type: string;
  
    notNull: boolean;
  
    defaultValue:
      string | number | null;
  
    primaryKey: boolean;
  }
  
  export interface DatabaseTableInspection {
    name: string;
  
    type: "table" | "view";
  
    columns:
      DatabaseColumnInspection[];
  }
  
  export interface ItemTableInspection {
    columns:
      DatabaseColumnInspection[];
  
    rowCount: number;
  
    keySamples: string[];
  
    conversationKeySamples:
      string[];
  
    patternCounts: {
      composer?: number;
  
      bubbleId?: number;
  
      checkpointId?: number;
  
      messageRequestContext?: number;
  
      conversation?: number;
  
      chat?: number;
  
      [patternName: string]:
        number | undefined;
    };
  }
  
  export interface CursorDatabaseInspection {
    ok: true;
  
    databasePath: string;
  
    databaseSizeBytes: number;
  
    journalMode: string;
  
    tables:
      DatabaseTableInspection[];
  
    itemTable:
      ItemTableInspection | null;
  }
  
  export interface PythonRuntime {
    executable: string;
  
    prefixArguments: string[];
  
    displayName: string;
  }