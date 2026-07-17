import {
    mkdir,
    writeFile
  } from "node:fs/promises";
  
  import * as path from "node:path";
  
  import type {
    GeneratedCursorSyncKey
  } from "./cursorSyncKeyTypes";
  
  export class SyncKeyRecoveryFileService {
    public async save(
      destinationPath: string,
      syncKey:
        GeneratedCursorSyncKey
    ): Promise<void> {
      await mkdir(
        path.dirname(
          destinationPath
        ),
        {
          recursive: true
        }
      );
  
      const contents = [
        "Cursor Team Chat Sync Recovery Key",
        "",
        "Version: 1",
        `Vault ID: ${syncKey.vaultId}`,
        `Created At: ${syncKey.createdAt}`,
        "",
        "Cursor Sync Key:",
        syncKey.syncKey,
        "",
        "WARNING:",
        "Anyone with this key can decrypt the synchronized chats.",
        "The key cannot be recovered if it is lost.",
        "Store this file in a secure password manager or encrypted drive.",
        ""
      ].join("\n");
  
      await writeFile(
        destinationPath,
        contents,
        {
          encoding: "utf8",
          mode: 0o600
        }
      );
    }
  }