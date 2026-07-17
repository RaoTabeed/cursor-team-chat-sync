import {
    createCipheriv,
    createDecipheriv,
    createHash,
    randomBytes
  } from "node:crypto";
  
  import {
    createReadStream,
    createWriteStream
  } from "node:fs";
  
  import type {
    WriteStream
  } from "node:fs";
  
  import {
    open,
    rename,
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
    GeneratedCursorSyncKey
  } from "./cursorSyncKeyTypes";
  
  import type {
    EncryptedBundleHeader,
    EncryptedBundleResult
  } from "./encryptedBundleTypes";
  
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
  
  export class EncryptedBundleService {
    public async encryptAndVerify(
      plaintextBundlePath: string,
  
      syncKey:
        GeneratedCursorSyncKey,
  
      expectedPlaintextSha256:
        string,
  
      expectedPlaintextByteLength:
        number
    ): Promise<EncryptedBundleResult> {
      const plaintextInformation =
        await stat(
          plaintextBundlePath
        );
  
      if (
        !plaintextInformation.isFile()
      ) {
        throw new Error(
          "The plaintext conversation bundle is not a file."
        );
      }
  
      if (
        plaintextInformation.size !==
        expectedPlaintextByteLength
      ) {
        throw new Error(
          "The plaintext bundle size changed before encryption."
        );
      }
  
      const actualPlaintextSha256 =
        await this.hashFile(
          plaintextBundlePath
        );
  
      if (
        actualPlaintextSha256 !==
        expectedPlaintextSha256
      ) {
        throw new Error(
          "The plaintext bundle hash changed before encryption."
        );
      }
  
      const encryptedBundlePath =
        `${plaintextBundlePath}.enc`;
  
      const temporaryPath =
        `${encryptedBundlePath}.tmp-${process.pid}-${Date.now()}`;
  
      const initializationVector =
        randomBytes(
          INITIALIZATION_VECTOR_BYTES
        );
  
      const header:
        EncryptedBundleHeader = {
          format:
            "cursor-team-chat-sync-encrypted-bundle",
  
          version: 1,
  
          algorithm:
            "aes-256-gcm",
  
          vaultId:
            syncKey.vaultId,
  
          createdAt:
            new Date().toISOString(),
  
          initializationVector:
            initializationVector.toString(
              "base64url"
            ),
  
          authenticationTagLength:
            AUTHENTICATION_TAG_BYTES,
  
          plaintextFilename:
            path.basename(
              plaintextBundlePath
            ),
  
          plaintextByteLength:
            plaintextInformation.size,
  
          plaintextSha256:
            actualPlaintextSha256
        };
  
      const headerBytes =
        Buffer.from(
          JSON.stringify(header),
          "utf8"
        );
  
      if (
        headerBytes.length >
        MAX_HEADER_BYTE_LENGTH
      ) {
        throw new Error(
          "The encrypted bundle header is unexpectedly large."
        );
      }
  
      const headerLengthBuffer =
        Buffer.alloc(4);
  
      headerLengthBuffer.writeUInt32BE(
        headerBytes.length,
        0
      );
  
      const cipher =
        createCipheriv(
          "aes-256-gcm",
          syncKey.keyBytes,
          initializationVector,
          {
            authTagLength:
              AUTHENTICATION_TAG_BYTES
          }
        );
  
      cipher.setAAD(
        headerBytes
      );
  
      const output =
        createWriteStream(
          temporaryPath,
          {
            flags: "wx"
          }
        );
  
      try {
        await this.writeChunk(
          output,
          ENCRYPTED_FILE_MAGIC
        );
  
        await this.writeChunk(
          output,
          headerLengthBuffer
        );
  
        await this.writeChunk(
          output,
          headerBytes
        );
  
        const plaintextStream =
          createReadStream(
            plaintextBundlePath
          );
  
        for await (
          const chunk of plaintextStream
        ) {
          const inputBuffer =
            Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk);
  
          const encryptedChunk =
            cipher.update(
              inputBuffer
            );
  
          await this.writeChunk(
            output,
            encryptedChunk
          );
        }
  
        const finalEncryptedChunk =
          cipher.final();
  
        await this.writeChunk(
          output,
          finalEncryptedChunk
        );
  
        const authenticationTag =
          cipher.getAuthTag();
  
        await this.writeChunk(
          output,
          authenticationTag
        );
  
        output.end();
  
        await finished(output);
      } catch (error) {
        output.destroy();
  
        await unlink(
          temporaryPath
        ).catch(() => undefined);
  
        throw error;
      }
  
      const verification =
        await this.verifyEncryptedBundle(
          temporaryPath,
          syncKey.keyBytes
        );
  
      if (!verification.verified) {
        await unlink(
          temporaryPath
        ).catch(() => undefined);
  
        throw new Error(
          "Encrypted bundle verification failed."
        );
      }
  
      if (
        verification.plaintextSha256 !==
        expectedPlaintextSha256
      ) {
        await unlink(
          temporaryPath
        ).catch(() => undefined);
  
        throw new Error(
          "The decrypted verification hash does not match the original bundle."
        );
      }
  
      if (
        verification.plaintextByteLength !==
        expectedPlaintextByteLength
      ) {
        await unlink(
          temporaryPath
        ).catch(() => undefined);
  
        throw new Error(
          "The decrypted verification size does not match the original bundle."
        );
      }
  
      await rename(
        temporaryPath,
        encryptedBundlePath
      );
  
      const encryptedInformation =
        await stat(
          encryptedBundlePath
        );
  
      const encryptedBundleSha256 =
        await this.hashFile(
          encryptedBundlePath
        );
  
      await unlink(
        plaintextBundlePath
      );
  
      return {
        encryptedBundlePath,
  
        encryptedBundleByteLength:
          encryptedInformation.size,
  
        encryptedBundleSha256,
  
        plaintextByteLength:
          verification
            .plaintextByteLength,
  
        plaintextSha256:
          verification
            .plaintextSha256,
  
        vaultId:
          syncKey.vaultId,
  
        algorithm:
          "aes-256-gcm",
  
        verified: true,
  
        plaintextDeleted: true
      };
    }
  
    private async verifyEncryptedBundle(
      encryptedBundlePath: string,
      keyBytes: Buffer
    ): Promise<{
      verified: boolean;
  
      plaintextByteLength:
        number;
  
      plaintextSha256:
        string;
    }> {
      const encryptedInformation =
        await stat(
          encryptedBundlePath
        );
  
      if (
        encryptedInformation.size <
        PREFIX_BYTE_LENGTH +
        AUTHENTICATION_TAG_BYTES
      ) {
        throw new Error(
          "The encrypted bundle is too small to be valid."
        );
      }
  
      const fileHandle =
        await open(
          encryptedBundlePath,
          "r"
        );
  
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
          !actualMagic.equals(
            ENCRYPTED_FILE_MAGIC
          )
        ) {
          throw new Error(
            "The encrypted bundle magic value is invalid."
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
  
        const authenticationTag =
          Buffer.alloc(
            AUTHENTICATION_TAG_BYTES
          );
  
        const authenticationTagPosition =
          encryptedInformation.size -
          AUTHENTICATION_TAG_BYTES;
  
        await this.readExactly(
          fileHandle,
          authenticationTag,
          authenticationTagPosition
        );
  
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
  
        const decipher =
          createDecipheriv(
            "aes-256-gcm",
            keyBytes,
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
          }
        }
  
        const finalPlaintextChunk =
          decipher.final();
  
        plaintextHash.update(
          finalPlaintextChunk
        );
  
        plaintextByteLength +=
          finalPlaintextChunk.length;
  
        const plaintextSha256 =
          plaintextHash.digest(
            "hex"
          );
  
        if (
          plaintextByteLength !==
          header.plaintextByteLength
        ) {
          throw new Error(
            "The decrypted bundle size does not match its header."
          );
        }
  
        if (
          plaintextSha256 !==
          header.plaintextSha256
        ) {
          throw new Error(
            "The decrypted bundle hash does not match its header."
          );
        }
  
        return {
          verified: true,
          plaintextByteLength,
          plaintextSha256
        };
      } finally {
        await fileHandle.close();
      }
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
  
      if (header.version !== 1) {
        throw new Error(
          "The encrypted bundle version is not supported."
        );
      }
  
      if (
        header.algorithm !==
        "aes-256-gcm"
      ) {
        throw new Error(
          "The encrypted bundle algorithm is not supported."
        );
      }
  
      if (
        typeof header.vaultId !==
          "string" ||
        typeof header.initializationVector !==
          "string" ||
        typeof header.plaintextFilename !==
          "string" ||
        typeof header.plaintextSha256 !==
          "string" ||
        typeof header.plaintextByteLength !==
          "number"
      ) {
        throw new Error(
          "The encrypted bundle header is incomplete."
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
      if (data.length === 0) {
        return;
      }
  
      if (stream.write(data)) {
        return;
      }
  
      await once(
        stream,
        "drain"
      );
    }
  
    private async hashFile(
      filePath: string
    ): Promise<string> {
      const hash =
        createHash("sha256");
  
      const input =
        createReadStream(
          filePath
        );
  
      for await (
        const chunk of input
      ) {
        hash.update(
          Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(chunk)
        );
      }
  
      return hash.digest("hex");
    }
  }