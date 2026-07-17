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
  
  export interface KeyPrefixInspection {
    prefix: string;
  
    count: number;
  }
  
  export interface JsonFieldNameInspection {
    name: string;
  
    count: number;
  }
  
  export interface RecordSampleInspection {
    key: string;
  
    storageType: string;
  
    byteLength: number;
  
    valueSha256: string;
  
    encodingHint: string;
  
    isUtf8: boolean;
  
    isJson: boolean;
  
    jsonTopLevelType:
      string | null;
  
    jsonSchemaPaths:
      string[];
  
    firstBytesHex:
      string | null;
  }
  
  export interface RecordFamilyInspection {
    name: string;
  
    matchMode:
      "exact" | "like";
  
    pattern: string;
  
    rowCount: number;
  
    utf8RecordCount: number;
  
    jsonRecordCount: number;
  
    topJsonFieldNames:
      JsonFieldNameInspection[];
  
    samples:
      RecordSampleInspection[];
  }
  
  export interface KeyValueTableInspection {
    name: string;
  
    columns:
      DatabaseColumnInspection[];
  
    rowCount: number;
  
    patternCounts: {
      [patternName: string]:
        number | undefined;
    };
  
    valueStorageCounts: {
      [storageType: string]:
        number | undefined;
    };
  
    topKeyPrefixes:
      KeyPrefixInspection[];
  
    recordFamilies:
      RecordFamilyInspection[];
  }
  
  export interface CursorDatabaseInspection {
    ok: true;
  
    databasePath: string;
  
    databaseSizeBytes: number;
  
    journalMode: string;
  
    tables:
      DatabaseTableInspection[];
  
    keyValueTables:
      KeyValueTableInspection[];
  }
  
  export interface PythonRuntime {
    executable: string;
  
    prefixArguments: string[];
  
    displayName: string;
  }