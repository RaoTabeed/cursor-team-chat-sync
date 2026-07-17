export interface EncryptedBundleHeader {
    format:
      "cursor-team-chat-sync-encrypted-bundle";
  
    version: 1;
  
    algorithm:
      "aes-256-gcm";
  
    vaultId: string;
  
    createdAt: string;
  
    initializationVector:
      string;
  
    authenticationTagLength:
      number;
  
    plaintextFilename:
      string;
  
    plaintextByteLength:
      number;
  
    plaintextSha256:
      string;
  }
  
  export interface EncryptedBundleResult {
    encryptedBundlePath:
      string;
  
    encryptedBundleByteLength:
      number;
  
    encryptedBundleSha256:
      string;
  
    plaintextByteLength:
      number;
  
    plaintextSha256:
      string;
  
    vaultId: string;
  
    algorithm:
      "aes-256-gcm";
  
    verified: boolean;
  
    plaintextDeleted: boolean;
  }