import {
    createHash,
    randomBytes,
    randomUUID,
    timingSafeEqual
  } from "node:crypto";
  
  import type {
    GeneratedCursorSyncKey,
    ParsedCursorSyncKey
  } from "./cursorSyncKeyTypes";
  
  const KEY_PREFIX =
    "CTS1";
  
  const ENCRYPTION_KEY_BYTES =
    32;
  
  const CHECKSUM_BYTES =
    6;
  
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
          new Date().toISOString(),
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
  
      if (parts.length !== 4) {
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
  
      if (prefix !== KEY_PREFIX) {
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
      } catch (error) {
        throw new Error(
          "The Cursor Sync Key contains an invalid secret.",
          {
            cause: error
          }
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
  
      const suppliedChecksumBytes =
        Buffer.from(
          suppliedChecksum,
          "utf8"
        );
  
      const expectedChecksumBytes =
        Buffer.from(
          expectedChecksum,
          "utf8"
        );
  
      if (
        suppliedChecksumBytes.length !==
        expectedChecksumBytes.length
      ) {
        throw new Error(
          "The Cursor Sync Key checksum is invalid."
        );
      }
  
      if (
        !timingSafeEqual(
          suppliedChecksumBytes,
          expectedChecksumBytes
        )
      ) {
        throw new Error(
          "The Cursor Sync Key checksum is invalid."
        );
      }
  
      return {
        version: 1,
        vaultId,
        syncKey:
          normalizedKey,
        keyBytes
      };
    }
  
    private createChecksum(
      keyBody: string
    ): string {
      return createHash("sha256")
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