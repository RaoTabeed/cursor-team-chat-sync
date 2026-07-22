export interface SupabaseCloudConfiguration {
    supabaseUrl: string;
    publishableKey: string;
  }
  
  export interface CloudProjectDescriptor {
    projectPath: string;
    projectName: string;
    gitRemote: string | null;
    canonicalIdentity: string;
    stableProjectId: string;
  }
  
  export interface CreateVaultResponse {
    ok: true;
    vaultId: string;
    created: boolean;
  }
  
  export interface RequestBundleUploadInput {
    vaultId: string;
    accessToken: string;
  
    project: {
      stableProjectId: string;
      projectName: string;
      gitRemote: string | null;
    };
  
    bundle: {
      sha256: string;
      encryptedSize: number;
      conversationCount: number;
    };
  }
  
  export interface RequestBundleUploadResponse {
    ok: true;
    bucket: string;
    bundleId: string;
    projectId: string;
    versionNumber: number;
    storagePath: string;
    uploadToken: string;
  }
  
  export interface FinalizeBundleUploadResponse {
    ok: true;
    bundleId: string;
    versionNumber: number;
    storagePath: string;
    sha256: string;
    encryptedSize: number;
    conversationCount: number;
  }
  
  export interface LatestCloudBundleResponse {
    ok: true;
    bucket: string;
  
    project: {
      id: string;
      projectName: string;
      gitRemote: string | null;
      stableProjectId: string;
    };
  
    bundle: {
      bundleId: string;
      versionNumber: number;
      storagePath: string;
      downloadUrl: string;
      sha256: string;
      encryptedSize: number;
      conversationCount: number;
      createdAt: string;
      readyAt: string | null;
    };
  }
  
  export interface CloudBundleListItem {
    id: string;
    version_number: number;
  
    status:
      | "pending"
      | "ready"
      | "deleted";
  
    bundle_sha256: string;
    encrypted_size: number;
    conversation_count: number;
    created_at: string;
    ready_at: string | null;
    deleted_at: string | null;
  }
  
  export interface ListCloudBundlesResponse {
    ok: true;
    bundles: CloudBundleListItem[];
  }
  
  export interface DeleteCloudBundleResponse {
    ok: true;
    bundleId: string;
    deleted: boolean;
  }
  export interface CloudVaultInfoResponse {
    ok: true;
  
    vault: {
      vaultId: string;
      isBound: boolean;
    };
  
    project: {
      id: string;
      projectName: string;
      gitRemote: string | null;
      stableProjectId: string;
    } | null;
  }