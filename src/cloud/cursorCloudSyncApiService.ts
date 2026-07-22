import type {
    CloudVaultInfoResponse,
    CreateVaultResponse,
    DeleteCloudBundleResponse,
    FinalizeBundleUploadResponse,
    LatestCloudBundleResponse,
    ListCloudBundlesResponse,
    RequestBundleUploadInput,
    RequestBundleUploadResponse
  } from "./cursorCloudSyncTypes";
  
  import type {
    SupabaseConfigService
  } from "./supabaseConfigService";
  
  interface ErrorResponse {
    ok?: false;
    error?: string;
  }
  
  export class CursorCloudSyncApiService {
    public constructor(
      private readonly configService:
        SupabaseConfigService
    ) {}
  
    public createVault(
      vaultId: string,
      accessTokenHash: string
    ): Promise<CreateVaultResponse> {
      return this.post<CreateVaultResponse>(
        {
          action:
            "createVault",
  
          vaultId,
          accessTokenHash
        }
      );
    }
    public getVaultInfo(
        vaultId: string,
        accessToken: string
      ): Promise<CloudVaultInfoResponse> {
        return this.post<CloudVaultInfoResponse>(
          {
            action:
              "vaultInfo",
      
            vaultId,
            accessToken
          }
        );
      }
  
    public requestUpload(
      input:
        RequestBundleUploadInput
    ): Promise<RequestBundleUploadResponse> {
      return this.post<RequestBundleUploadResponse>(
        {
          action:
            "requestUpload",
  
          ...input
        }
      );
    }
  
    public finalizeUpload(
      vaultId: string,
      accessToken: string,
      bundleId: string
    ): Promise<FinalizeBundleUploadResponse> {
      return this.post<FinalizeBundleUploadResponse>(
        {
          action:
            "finalizeUpload",
  
          vaultId,
          accessToken,
          bundleId
        }
      );
    }
  
    public getLatestBundle(
      vaultId: string,
      accessToken: string,
      stableProjectId: string
    ): Promise<LatestCloudBundleResponse> {
      return this.post<LatestCloudBundleResponse>(
        {
          action:
            "latestBundle",
  
          vaultId,
          accessToken,
          stableProjectId
        }
      );
    }
  
    public listBundles(
      vaultId: string,
      accessToken: string,
      stableProjectId: string
    ): Promise<ListCloudBundlesResponse> {
      return this.post<ListCloudBundlesResponse>(
        {
          action:
            "listBundles",
  
          vaultId,
          accessToken,
          stableProjectId
        }
      );
    }
  
    public deleteBundle(
      vaultId: string,
      accessToken: string,
      bundleId: string
    ): Promise<DeleteCloudBundleResponse> {
      return this.post<DeleteCloudBundleResponse>(
        {
          action:
            "deleteBundle",
  
          vaultId,
          accessToken,
          bundleId
        }
      );
    }
  
    private async post<T>(
      body:
        Record<string, unknown>
    ): Promise<T> {
      const configuration =
        this.configService.get();
  
      const response =
        await fetch(
          [
            configuration.supabaseUrl,
            "functions",
            "v1",
            "cursor-sync-api"
          ].join("/"),
          {
            method:
              "POST",
  
            headers: {
              apikey:
                configuration
                  .publishableKey,
  
              "Content-Type":
                "application/json",
  
              "x-client-info":
                "cursor-team-chat-sync/0.0.1"
            },
  
            body:
              JSON.stringify(
                body
              )
          }
        );
  
      let parsedBody: unknown;
  
      try {
        parsedBody =
          await response.json();
      } catch {
        throw new Error(
          `Cloud sync API returned HTTP ${response.status} with a non-JSON response.`
        );
      }
  
      if (!response.ok) {
        const errorBody =
          parsedBody as
            ErrorResponse;
  
        throw new Error(
          errorBody.error ??
          `Cloud sync API request failed with HTTP ${response.status}.`
        );
      }
  
      return parsedBody as T;
    }
  }