export interface DecryptedBundleFileResult {
    temporaryBundlePath: string;
  
    vaultId: string;
  
    encryptedBundlePath: string;
  
    plaintextFilename: string;
  
    plaintextByteLength:
      number;
  
    plaintextSha256:
      string;
  
    algorithm:
      "aes-256-gcm";
  
    verified: boolean;
  }