export interface GitRepositoryInspection {
    isRepository: boolean;
  
    repositoryRoot?: string;
    remoteUrl?: string;
  
    branch?: string;
    commitSha?: string;
  
    isDirty?: boolean;
    changedFileCount?: number;
  
    inspectionError?: string;
  }