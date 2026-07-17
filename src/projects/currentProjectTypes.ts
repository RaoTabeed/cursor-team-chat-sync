import type {
    CursorWorkspaceStorage
  } from "../cursor/cursorStorageTypes";
  
  import type {
    GitRepositoryInspection
  } from "../git/gitTypes";
  
  export interface CurrentProjectInspection {
    workspaceFolderName: string;
    workspaceFolderUri: string;
    projectPath: string;
  
    cursorWorkspace?:
      CursorWorkspaceStorage;
  
    git:
      GitRepositoryInspection;
  }