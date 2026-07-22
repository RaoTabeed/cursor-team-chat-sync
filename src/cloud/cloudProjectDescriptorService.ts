import {
    createHash
  } from "node:crypto";
  
  import {
    execFile
  } from "node:child_process";
  
  import * as path from "node:path";
  
  import {
    promisify
  } from "node:util";
  
  import type {
    CloudProjectDescriptor
  } from "./cursorCloudSyncTypes";
  
  const execFileAsync =
    promisify(execFile);
  
  export class CloudProjectDescriptorService {
    public async inspect(
      projectPath: string
    ): Promise<CloudProjectDescriptor> {
      const gitRemote =
        await this.readGitRemote(
          projectPath
        );
  
      const canonicalIdentity =
        gitRemote
          ? this.canonicalizeRemote(
              gitRemote
            )
          : this.canonicalizeLocalPath(
              projectPath
            );
  
      const stableProjectId =
        createHash("sha256")
          .update(
            canonicalIdentity,
            "utf8"
          )
          .digest("hex");
  
      return {
        projectPath:
          path.resolve(
            projectPath
          ),
  
        projectName:
          path.basename(
            path.resolve(
              projectPath
            )
          ),
  
        gitRemote,
        canonicalIdentity,
        stableProjectId
      };
    }
  
    private async readGitRemote(
      projectPath: string
    ): Promise<string | null> {
      try {
        const result =
          await execFileAsync(
            "git",
            [
              "-C",
              projectPath,
              "config",
              "--get",
              "remote.origin.url"
            ],
            {
              windowsHide: true,
              timeout: 10_000,
              maxBuffer:
                1024 * 1024
            }
          );
  
        const remote =
          result.stdout.trim();
  
        return remote || null;
      } catch {
        return null;
      }
    }
  
    private canonicalizeRemote(
      remote: string
    ): string {
      let normalized =
        remote.trim();
  
      const scpStyleMatch =
        normalized.match(
          /^([^@]+@)?([^:]+):(.+)$/
        );
  
      if (
        scpStyleMatch &&
        !normalized.includes("://")
      ) {
        normalized =
          `https://${scpStyleMatch[2]}/${scpStyleMatch[3]}`;
      }
  
      try {
        const parsed =
          new URL(
            normalized
          );
  
        parsed.username = "";
        parsed.password = "";
        parsed.search = "";
        parsed.hash = "";
  
        const hostname =
          parsed.hostname
            .toLowerCase();
  
        const pathname =
          parsed.pathname
            .replace(/\.git$/i, "")
            .replace(/\/+$/, "")
            .replace(/^\/+/, "");
  
        return `${hostname}/${pathname}`
          .toLowerCase();
      } catch {
        return normalized
          .replace(/\.git$/i, "")
          .replace(/\\/g, "/")
          .replace(/\/+$/, "")
          .toLowerCase();
      }
    }
  
    private canonicalizeLocalPath(
      projectPath: string
    ): string {
      return path
        .resolve(
          projectPath
        )
        .replace(/\\/g, "/")
        .toLowerCase();
    }
  }