import {
    createDecipheriv,
    createHash,
    timingSafeEqual
  } from "node:crypto";
  
  import {
    createReadStream,
    createWriteStream
  } from "node:fs";
  
  import type {
    WriteStream
  } from "node:fs";
  
  import {
    mkdir,
    open,
    stat,
    unlink
  } from "node:fs/promises";
  
  import {
    once
  } from "node:events";
  
  import * as path from "node:path";
  
  import {
    finished
  } from "node:stream/promises";
  
  import type {
    EncryptedBundleHeader
  } from "./encryptedBundleTypes";
  
  import type {
    DecryptedBundleFileResult
  } from "./encryptedBundleDecryptionTypes";
  
  import type {
    ParsedCursorSyncKey
  } from "./cursorSyncKeyTypes";
  
  const ENCRYPTED_FILE_MAGIC =
    Buffer.from(
      "CTSENC01",
      "ascii"
    );
  
  const PREFIX_BYTE_LENGTH =
    ENCRYPTED_FILE_MAGIC.length + 4;
  
  const INITIALIZATION_VECTOR_BYTES =
    12;
  
  const AUTHENTICATION_TAG_BYTES =
    16;
  
  const MAX_HEADER_BYTE_LENGTH =
    1024 * 1024;
  
  export class EncryptedBundleDecryptionService {
    public constructor(
      private readonly temporaryRoot:
        string
    ) {}
  
    public async decryptToTemporaryBundle(
      encryptedBundlePath: string,
  
      syncKey:
        ParsedCursorSyncKey
    ): Promise<DecryptedBundleFileResult> {
      const encryptedFileInformation =
        await stat(
          encryptedBundlePath
        );
  
      if (
        !encryptedFileInformation.isFile()
      ) {
        throw new Error(
          "The selected encrypted bundle is not a file."
        );
      }
  
      if (
        encryptedFileInformation.size <
        PREFIX_BYTE_LENGTH +
        AUTHENTICATION_TAG_BYTES
      ) {
        throw new Error(
          "The encrypted bundle is too small to be valid."
        );
      }
  
      await mkdir(
        this.temporaryRoot,
        {
          recursive: true
        }
      );
  
      const fileHandle =
        await open(
          encryptedBundlePath,
          "r"
        );
  
      let temporaryBundlePath:
        string | undefined;
  
      try {
        const prefix =
          Buffer.alloc(
            PREFIX_BYTE_LENGTH
          );
  
        await this.readExactly(
          fileHandle,
          prefix,
          0
        );
  
        const actualMagic =
          prefix.subarray(
            0,
            ENCRYPTED_FILE_MAGIC.length
          );
  
        if (
          actualMagic.length !==
            ENCRYPTED_FILE_MAGIC.length ||
          !timingSafeEqual(
            actualMagic,
            ENCRYPTED_FILE_MAGIC
          )
        ) {
          throw new Error(
            "The selected file is not a supported encrypted conversation bundle."
          );
        }
  
        const headerByteLength =
          prefix.readUInt32BE(
            ENCRYPTED_FILE_MAGIC.length
          );
  
        if (
          headerByteLength <= 0 ||
          headerByteLength >
            MAX_HEADER_BYTE_LENGTH
        ) {
          throw new Error(
            "The encrypted bundle header length is invalid."
          );
        }
  
        const headerBytes =
          Buffer.alloc(
            headerByteLength
          );
  
        await this.readExactly(
          fileHandle,
          headerBytes,
          PREFIX_BYTE_LENGTH
        );
  
        const header =
          this.parseHeader(
            headerBytes
          );
  
        if (
          header.vaultId !==
          syncKey.vaultId
        ) {
          throw new Error(
            "The Cursor Sync Key belongs to a different encrypted vault."
          );
        }
  
        const initializationVector =
          Buffer.from(
            header.initializationVector,
            "base64url"
          );
  
        if (
          initializationVector.length !==
          INITIALIZATION_VECTOR_BYTES
        ) {
          throw new Error(
            "The encrypted bundle initialization vector is invalid."
          );
        }
  
        const authenticationTagPosition =
          encryptedFileInformation.size -
          AUTHENTICATION_TAG_BYTES;
  
        const ciphertextStart =
          PREFIX_BYTE_LENGTH +
          headerByteLength;
  
        const ciphertextEndExclusive =
          authenticationTagPosition;
  
        if (
          ciphertextEndExclusive <
          ciphertextStart
        ) {
          throw new Error(
            "The encrypted bundle ciphertext range is invalid."
          );
        }
  
        const authenticationTag =
          Buffer.alloc(
            AUTHENTICATION_TAG_BYTES
          );
  
        await this.readExactly(
          fileHandle,
          authenticationTag,
          authenticationTagPosition
        );
  
        temporaryBundlePath =
          path.join(
            this.temporaryRoot,
            [
              header.vaultId,
              process.pid,
              Date.now(),
              "cursor-chat-bundle"
            ].join(".")
          );
  
        const decipher =
          createDecipheriv(
            "aes-256-gcm",
            syncKey.keyBytes,
            initializationVector,
            {
              authTagLength:
                AUTHENTICATION_TAG_BYTES
            }
          );
  
        decipher.setAAD(
          headerBytes
        );
  
        decipher.setAuthTag(
          authenticationTag
        );
  
        const plaintextHash =
          createHash("sha256");
  
        let plaintextByteLength =
          0;
  
        const output =
          createWriteStream(
            temporaryBundlePath,
            {
              flags: "wx",
              mode: 0o600
            }
          );
  
        try {
          if (
            ciphertextEndExclusive >
            ciphertextStart
          ) {
            const ciphertextStream =
              createReadStream(
                encryptedBundlePath,
                {
                  start:
                    ciphertextStart,
  
                  end:
                    ciphertextEndExclusive -
                    1
                }
              );
  
            for await (
              const chunk of
              ciphertextStream
            ) {
              const ciphertextChunk =
                Buffer.isBuffer(chunk)
                  ? chunk
                  : Buffer.from(chunk);
  
              const plaintextChunk =
                decipher.update(
                  ciphertextChunk
                );
  
              plaintextHash.update(
                plaintextChunk
              );
  
              plaintextByteLength +=
                plaintextChunk.length;
  
              await this.writeChunk(
                output,
                plaintextChunk
              );
            }
          }
  
          const finalPlaintextChunk =
            decipher.final();
  
          plaintextHash.update(
            finalPlaintextChunk
          );
  
          plaintextByteLength +=
            finalPlaintextChunk.length;
  
          await this.writeChunk(
            output,
            finalPlaintextChunk
          );
  
          output.end();
  
          await finished(output);
        } catch (error) {
          output.destroy();
  
          throw new Error(
            "The encrypted bundle could not be decrypted. The Sync Key may be incorrect or the bundle may be damaged.",
            {
              cause: error
            }
          );
        }
  
        const plaintextSha256 =
          plaintextHash.digest(
            "hex"
          );
  
        if (
          plaintextByteLength !==
          header.plaintextByteLength
        ) {
          throw new Error(
            "The decrypted bundle size does not match its authenticated header."
          );
        }
  
        if (
          plaintextSha256 !==
          header.plaintextSha256
        ) {
          throw new Error(
            "The decrypted bundle SHA-256 does not match its authenticated header."
          );
        }
  
        return {
          temporaryBundlePath,
  
          vaultId:
            header.vaultId,
  
          encryptedBundlePath,
  
          plaintextFilename:
            header.plaintextFilename,
  
          plaintextByteLength,
  
          plaintextSha256,
  
          algorithm:
            "aes-256-gcm",
  
          verified: true
        };
      } catch (error) {
        if (temporaryBundlePath) {
          await unlink(
            temporaryBundlePath
          ).catch(
            () => undefined
          );
        }
  
        throw error;
      } finally {
        await fileHandle.close();
      }
    }
  
    public async deleteTemporaryBundle(
      temporaryBundlePath: string
    ): Promise<void> {
      await unlink(
        temporaryBundlePath
      ).catch(
        error => {
          const errorCode =
            this.getErrorCode(error);
  
          if (
            errorCode !== "ENOENT"
          ) {
            throw error;
          }
        }
      );
    }
  
    private parseHeader(
      headerBytes: Buffer
    ): EncryptedBundleHeader {
      let parsedValue: unknown;
  
      try {
        parsedValue =
          JSON.parse(
            headerBytes.toString(
              "utf8"
            )
          );
      } catch (error) {
        throw new Error(
          "The encrypted bundle header is not valid JSON.",
          {
            cause: error
          }
        );
      }
  
      if (
        typeof parsedValue !==
          "object" ||
        parsedValue === null ||
        Array.isArray(parsedValue)
      ) {
        throw new Error(
          "The encrypted bundle header is invalid."
        );
      }
  
      const header =
        parsedValue as Partial<
          EncryptedBundleHeader
        >;
  
      if (
        header.format !==
        "cursor-team-chat-sync-encrypted-bundle"
      ) {
        throw new Error(
          "The encrypted bundle format is not supported."
        );
      }
  
      if (
        header.version !== 1
      ) {
        throw new Error(
          "The encrypted bundle version is not supported."
        );
      }
  
      if (
        header.algorithm !==
        "aes-256-gcm"
      ) {
        throw new Error(
          "The encrypted bundle encryption algorithm is not supported."
        );
      }
  
      if (
        header.authenticationTagLength !==
        AUTHENTICATION_TAG_BYTES
      ) {
        throw new Error(
          "The encrypted bundle authentication tag length is invalid."
        );
      }
  
      if (
        typeof header.vaultId !==
          "string" ||
        header.vaultId.length === 0 ||
        typeof header.createdAt !==
          "string" ||
        typeof header.initializationVector !==
          "string" ||
        typeof header.plaintextFilename !==
          "string" ||
        typeof header.plaintextByteLength !==
          "number" ||
        !Number.isSafeInteger(
          header.plaintextByteLength
        ) ||
        header.plaintextByteLength < 0 ||
        typeof header.plaintextSha256 !==
          "string" ||
        !/^[0-9a-f]{64}$/i.test(
          header.plaintextSha256
        )
      ) {
        throw new Error(
          "The encrypted bundle header is incomplete or invalid."
        );
      }
  
      return header as
        EncryptedBundleHeader;
    }
  
    private async readExactly(
      fileHandle: Awaited<
        ReturnType<typeof open>
      >,
  
      destination: Buffer,
  
      position: number
    ): Promise<void> {
      let destinationOffset =
        0;
  
      while (
        destinationOffset <
        destination.length
      ) {
        const result =
          await fileHandle.read(
            destination,
            destinationOffset,
            destination.length -
              destinationOffset,
            position +
              destinationOffset
          );
  
        if (
          result.bytesRead === 0
        ) {
          throw new Error(
            "Unexpected end of encrypted bundle."
          );
        }
  
        destinationOffset +=
          result.bytesRead;
      }
    }
  
    private async writeChunk(
      stream: WriteStream,
  
      data: Buffer
    ): Promise<void> {
      if (
        data.length === 0
      ) {
        return;
      }
  
      if (
        stream.write(data)
      ) {
        return;
      }
  
      await once(
        stream,
        "drain"
      );
    }
  
    private getErrorCode(
      error: unknown
    ): string | undefined {
      if (
        typeof error !==
          "object" ||
        error === null ||
        !("code" in error)
      ) {
        return undefined;
      }
  
      const errorWithCode =
        error as {
          code?: unknown;
        };
  
      return typeof
        errorWithCode.code ===
        "string"
        ? errorWithCode.code
        : undefined;
    }
  }