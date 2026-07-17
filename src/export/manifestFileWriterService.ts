import {
    createHash
  } from "node:crypto";
  
  import {
    mkdir,
    rename,
    writeFile
  } from "node:fs/promises";
  
  import * as path from "node:path";
  
  import type {
    ProjectConversationBundleManifest
  } from "./conversationBundleManifestTypes";
  
  export class ManifestFileWriterService {
    public constructor(
      private readonly extensionStoragePath:
        string
    ) {}
  
    public async write(
      manifest:
        ProjectConversationBundleManifest
    ): Promise<string> {
      const projectDirectoryName =
        this.createProjectDirectoryName(
          manifest.projectPath
        );
  
      const manifestDirectory =
        path.join(
          this.extensionStoragePath,
          "manifests",
          projectDirectoryName
        );
  
      await mkdir(
        manifestDirectory,
        {
          recursive: true
        }
      );
  
      const timestamp =
        this.createSafeTimestamp(
          manifest.generatedAt
        );
  
      const filename =
        `${timestamp}.conversation-manifest.json`;
  
      const finalPath =
        path.join(
          manifestDirectory,
          filename
        );
  
      const temporaryPath =
        `${finalPath}.tmp-${process.pid}`;
  
      const serializedManifest =
        `${JSON.stringify(
          manifest,
          null,
          2
        )}\n`;
  
      await writeFile(
        temporaryPath,
        serializedManifest,
        {
          encoding: "utf8",
          flag: "wx"
        }
      );
  
      await rename(
        temporaryPath,
        finalPath
      );
  
      return finalPath;
    }
  
    private createProjectDirectoryName(
      projectPath: string
    ): string {
      return createHash("sha256")
        .update(
          projectPath.toLowerCase(),
          "utf8"
        )
        .digest("hex")
        .slice(0, 24);
    }
  
    private createSafeTimestamp(
      generatedAt: string
    ): string {
      return generatedAt.replace(
        /[:.]/g,
        "-"
      );
    }
  }