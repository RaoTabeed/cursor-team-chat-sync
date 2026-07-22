import type {
    SecretStorage
  } from "vscode";
  
  export class CloudVaultCredentialStore {
    private readonly prefix =
      "cursorTeamChatSync.vault";
  
    public constructor(
      private readonly secretStorage:
        SecretStorage
    ) {}
  
    public get(
      stableProjectId: string
    ): Thenable<string | undefined> {
      return this.secretStorage.get(
        this.key(
          stableProjectId
        )
      );
    }
  
    public store(
      stableProjectId: string,
      syncKey: string
    ): Thenable<void> {
      return this.secretStorage.store(
        this.key(
          stableProjectId
        ),
        syncKey
      );
    }
  
    public delete(
      stableProjectId: string
    ): Thenable<void> {
      return this.secretStorage.delete(
        this.key(
          stableProjectId
        )
      );
    }
  
    private key(
      stableProjectId: string
    ): string {
      return [
        this.prefix,
        stableProjectId
      ].join(".");
    }
  }