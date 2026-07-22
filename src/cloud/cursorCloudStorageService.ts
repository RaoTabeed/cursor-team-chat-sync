import {
    createHash
  } from "node:crypto";
  
  import {
    mkdir,
    readFile,
    rename,
    stat,
    unlink,
    writeFile
  } from "node:fs/promises";
  
  import * as path from "node:path";
  
  import {
    createClient
  } from "@supabase/supabase-js";
  
  import type {
    SupabaseConfigService
  } from "./supabaseConfigService";
  
  export class CursorCloudStorageService {
    public constructor(
      private readonly configService:
        SupabaseConfigService
    ) {}
  
    public async uploadToSignedUrl(
      filePath: string,
      bucket: string,
      storagePath: string,
      uploadToken: string
    ): Promise<void> {
      const configuration =
        this.configService.get();
  
      const fileBody =
        await readFile(
          filePath
        );
  
      const client =
        createClient(
          configuration.supabaseUrl,
          configuration.publishableKey,
          {
            auth: {
              autoRefreshToken:
                false,
  
              persistSession:
                false,
  
              detectSessionInUrl:
                false
            }
          }
        );
  
      const {
        error
      } = await client.storage
        .from(
          bucket
        )
        .uploadToSignedUrl(
          storagePath,
          uploadToken,
          fileBody,
          {
            contentType:
              "application/octet-stream",
  
            cacheControl:
              "0"
          }
        );
  
      if (error) {
        throw new Error(
          `Encrypted bundle upload failed: ${error.message}`
        );
      }
    }
  
    public async downloadAndVerify(
      signedUrl: string,
      destinationPath: string,
      expectedByteLength: number,
      expectedSha256: string
    ): Promise<string> {
      if (
        !Number.isSafeInteger(
          expectedByteLength
        ) ||
        expectedByteLength <= 0
      ) {
        throw new Error(
          "The expected encrypted bundle size is invalid."
        );
      }
  
      if (
        !/^[0-9a-f]{64}$/i.test(
          expectedSha256
        )
      ) {
        throw new Error(
          "The expected encrypted bundle SHA-256 is invalid."
        );
      }
  
      await mkdir(
        path.dirname(
          destinationPath
        ),
        {
          recursive: true
        }
      );
  
      const temporaryPath =
        [
          destinationPath,
          "tmp",
          process.pid,
          Date.now()
        ].join("-");
  
      const response =
        await fetch(
          signedUrl,
          {
            method:
              "GET",
  
            headers: {
              "Cache-Control":
                "no-cache, no-store, max-age=0",
  
              Pragma:
                "no-cache"
            }
          }
        );
  
      if (!response.ok) {
        throw new Error(
          [
            "Encrypted bundle download failed",
            `with HTTP ${response.status}`,
            response.statusText
              ? `(${response.statusText}).`
              : "."
          ].join(" ")
        );
      }
  
      const responseBuffer =
        await response.arrayBuffer();
  
      const payload =
        Buffer.from(
          responseBuffer
        );
  
      if (
        payload.length !==
        expectedByteLength
      ) {
        throw new Error(
          [
            "The downloaded encrypted bundle size",
            `was ${payload.length} bytes,`,
            `but cloud metadata expected ${expectedByteLength} bytes.`
          ].join(" ")
        );
      }
  
      const actualSha256 =
        createHash("sha256")
          .update(
            payload
          )
          .digest("hex");
  
      if (
        actualSha256.toLowerCase() !==
        expectedSha256.toLowerCase()
      ) {
        throw new Error(
          "The downloaded encrypted bundle failed SHA-256 verification."
        );
      }
  
      try {
        await writeFile(
          temporaryPath,
          payload,
          {
            flag:
              "wx",
  
            mode:
              0o600
          }
        );
  
        await rename(
          temporaryPath,
          destinationPath
        );
      } catch (error) {
        await unlink(
          temporaryPath
        ).catch(
          () => undefined
        );
  
        throw error;
      }
  
      const information =
        await stat(
          destinationPath
        );
  
      if (
        !information.isFile()
      ) {
        await this.deleteLocalFile(
          destinationPath
        );
  
        throw new Error(
          "The downloaded encrypted bundle was not saved as a file."
        );
      }
  
      if (
        information.size !==
        expectedByteLength
      ) {
        await this.deleteLocalFile(
          destinationPath
        );
  
        throw new Error(
          "The saved encrypted bundle failed final size verification."
        );
      }
  
      const savedPayload =
        await readFile(
          destinationPath
        );
  
      const savedSha256 =
        createHash("sha256")
          .update(
            savedPayload
          )
          .digest("hex");
  
      if (
        savedSha256.toLowerCase() !==
        expectedSha256.toLowerCase()
      ) {
        await this.deleteLocalFile(
          destinationPath
        );
  
        throw new Error(
          "The saved encrypted bundle failed final SHA-256 verification."
        );
      }
  
      return destinationPath;
    }
  
    public async deleteLocalFile(
      filePath: string
    ): Promise<void> {
      await unlink(
        filePath
      ).catch(
        error => {
          if (
            this.getErrorCode(
              error
            ) !== "ENOENT"
          ) {
            throw error;
          }
        }
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
  
      const value =
        error as {
          code?: unknown;
        };
  
      return typeof value.code ===
        "string"
        ? value.code
        : undefined;
    }
  }