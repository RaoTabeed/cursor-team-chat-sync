import type {
    CursorWorkspaceStorage
  } from "../cursor/cursorStorageTypes";
  
  import type {
    GitRepositoryInspection
  } from "../git/gitTypes";
  
  import type {
    ProjectIdentity
  } from "./projectIdentityTypes";
  
  export interface CurrentProjectInspection {
    workspaceFolderName: string;
  
    workspaceFolderUri: string;
  
    projectPath: string;
  
    cursorWorkspace?:
      CursorWorkspaceStorage;
  
    git:
      GitRepositoryInspection;
  
    projectIdentity?:
      ProjectIdentity;
  
    projectIdentityError?: string;
  }