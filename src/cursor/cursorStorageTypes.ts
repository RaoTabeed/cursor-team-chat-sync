export type CursorWorkspaceKind =
  | "folder"
  | "workspace"
  | "unknown";

export interface CursorWorkspaceStorage {
  workspaceId: string;
  workspaceDirectory: string;

  databasePath: string;
  databaseExists: boolean;

  workspaceJsonPath: string;
  workspaceJsonExists: boolean;

  workspaceKind: CursorWorkspaceKind;

  projectUri?: string;
  projectPath?: string;

  mappingError?: string;
}

export interface CursorStorageInspection {
  platform: NodeJS.Platform;

  userDataDirectory: string;

  globalDatabasePath: string;
  globalDatabaseExists: boolean;

  workspaceStorageDirectory: string;
  workspaceStorageExists: boolean;

  workspaces: CursorWorkspaceStorage[];
}