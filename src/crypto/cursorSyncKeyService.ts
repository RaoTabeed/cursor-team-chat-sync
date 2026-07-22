import {
    createHash,
    createHmac,
    randomBytes,
    randomUUID,
    timingSafeEqual
  } from "node:crypto";
  
  import type {
    CursorSyncKeyMaterial,
    GeneratedCursorSyncKey,
    ParsedCursorSyncKey
  } from "./cursorSyncKeyTypes";
  
  const KEY_PREFIX =
    "CTS1";
  
  const ENCRYPTION_KEY_BYTES =
    32;
  
  const CHECKSUM_BYTES =
    6;
  
  const ACCESS_TOKEN_CONTEXT =
    "cursor-team-chat-sync:cloud-access-token:v1";
  
  const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  
  export class CursorSyncKeyService {
    public generate():
      GeneratedCursorSyncKey {
      const vaultId =
        randomUUID();
  
      const keyBytes =
        randomBytes(
          ENCRYPTION_KEY_BYTES
        );
  
      const secretText =
        keyBytes.toString(
          "base64url"
        );
  
      const keyBody = [
        KEY_PREFIX,
        vaultId,
        secretText
      ].join(".");
  
      const checksum =
        this.createChecksum(
          keyBody
        );
  
      return {
        version: 1,
        vaultId,
  
        createdAt:
          new Date()
            .toISOString(),
  
        syncKey:
          `${keyBody}.${checksum}`,
  
        keyBytes
      };
    }
  
    public parse(
      syncKeyInput: string
    ): ParsedCursorSyncKey {
      const normalizedKey =
        syncKeyInput.trim();
  
      const parts =
        normalizedKey.split(".");
  
      if (
        parts.length !== 4
      ) {
        throw new Error(
          "The Cursor Sync Key has an invalid format."
        );
      }
  
      const [
        prefix,
        vaultId,
        secretText,
        suppliedChecksum
      ] = parts;
  
      if (
        prefix !== KEY_PREFIX
      ) {
        throw new Error(
          "The Cursor Sync Key version is not supported."
        );
      }
  
      if (
        !UUID_PATTERN.test(
          vaultId
        )
      ) {
        throw new Error(
          "The Cursor Sync Key contains an invalid vault ID."
        );
      }
  
      let keyBytes: Buffer;
  
      try {
        keyBytes =
          Buffer.from(
            secretText,
            "base64url"
          );
      } catch {
        throw new Error(
          "The Cursor Sync Key contains an invalid secret."
        );
      }
  
      if (
        keyBytes.length !==
        ENCRYPTION_KEY_BYTES
      ) {
        throw new Error(
          "The Cursor Sync Key has an invalid secret length."
        );
      }
  
      if (
        keyBytes.toString(
          "base64url"
        ) !== secretText
      ) {
        throw new Error(
          "The Cursor Sync Key is not canonically encoded."
        );
      }
  
      const keyBody = [
        prefix,
        vaultId,
        secretText
      ].join(".");
  
      const expectedChecksum =
        this.createChecksum(
          keyBody
        );
  
      const suppliedBytes =
        Buffer.from(
          suppliedChecksum,
          "utf8"
        );
  
      const expectedBytes =
        Buffer.from(
          expectedChecksum,
          "utf8"
        );
  
      if (
        suppliedBytes.length !==
          expectedBytes.length ||
        !timingSafeEqual(
          suppliedBytes,
          expectedBytes
        )
      ) {
        throw new Error(
          "The Cursor Sync Key checksum is invalid."
        );
      }
  
      return {
        version: 1,
  
        vaultId:
          vaultId.toLowerCase(),
  
        syncKey:
          normalizedKey,
  
        keyBytes
      };
    }
  
    public deriveAccessToken(
      material:
        Pick<
          CursorSyncKeyMaterial,
          "vaultId" | "keyBytes"
        >
    ): string {
      return createHmac(
        "sha256",
        material.keyBytes
      )
        .update(
          [
            ACCESS_TOKEN_CONTEXT,
            material.vaultId
              .toLowerCase()
          ].join(":"),
          "utf8"
        )
        .digest(
          "base64url"
        );
    }
  
    public hashAccessToken(
      accessToken: string
    ): string {
      return createHash(
        "sha256"
      )
        .update(
          accessToken,
          "utf8"
        )
        .digest(
          "hex"
        );
    }
  
    private createChecksum(
      keyBody: string
    ): string {
      return createHash(
        "sha256"
      )
        .update(
          keyBody,
          "utf8"
        )
        .digest()
        .subarray(
          0,
          CHECKSUM_BYTES
        )
        .toString(
          "base64url"
        );
    }
  }