import {
    createHash
  } from "node:crypto";
  
  import {
    URL
  } from "node:url";
  
  import type {
    ProjectIdentity
  } from "./projectIdentityTypes";
  
  export class ProjectIdentityService {
    public create(
      remoteUrl: string
    ): ProjectIdentity {
      const canonicalRemote =
        this.normalizeRemoteUrl(
          remoteUrl
        );
  
      const projectId =
        createHash("sha256")
          .update(
            canonicalRemote,
            "utf8"
          )
          .digest("hex");
  
      return {
        source: "git-remote",
        canonicalRemote,
        projectId
      };
    }
  
    private normalizeRemoteUrl(
      remoteUrl: string
    ): string {
      const trimmedRemoteUrl =
        remoteUrl.trim();
  
      if (!trimmedRemoteUrl) {
        throw new Error(
          "The Git remote URL is empty."
        );
      }
  
      if (
        this.hasStandardUrlScheme(
          trimmedRemoteUrl
        )
      ) {
        return this.normalizeStandardUrl(
          trimmedRemoteUrl
        );
      }
  
      return this.normalizeScpStyleUrl(
        trimmedRemoteUrl
      );
    }
  
    private hasStandardUrlScheme(
      remoteUrl: string
    ): boolean {
      return /^[a-z][a-z0-9+.-]*:\/\//i.test(
        remoteUrl
      );
    }
  
    private normalizeStandardUrl(
      remoteUrl: string
    ): string {
      let parsedUrl: URL;
  
      try {
        parsedUrl = new URL(remoteUrl);
      } catch (error) {
        throw new Error(
          `Invalid Git remote URL: ${remoteUrl}`,
          {
            cause: error
          }
        );
      }
  
      if (!parsedUrl.hostname) {
        throw new Error(
          "The Git remote URL does not contain a hostname."
        );
      }
  
      return this.createCanonicalRemote(
        parsedUrl.hostname,
        parsedUrl.pathname
      );
    }
  
    private normalizeScpStyleUrl(
      remoteUrl: string
    ): string {
      /*
       * Supports Git SSH remotes such as:
       *
       * git@github.com:owner/repository.git
       */
      const match =
        /^(?:[^@]+@)?([^:]+):(.+)$/.exec(
          remoteUrl
        );
  
      if (!match) {
        throw new Error(
          `Unsupported Git remote format: ${remoteUrl}`
        );
      }
  
      const host = match[1];
      const repositoryPath = match[2];
  
      return this.createCanonicalRemote(
        host,
        repositoryPath
      );
    }
  
    private createCanonicalRemote(
      host: string,
      repositoryPath: string
    ): string {
      const normalizedHost =
        host
          .trim()
          .toLowerCase();
  
      const normalizedPath =
        this.safeDecodeURIComponent(
          repositoryPath
        )
          .replace(/\\/g, "/")
          .replace(/^\/+/, "")
          .replace(/\/+$/, "")
          .replace(/\.git$/i, "")
          .toLowerCase();
  
      if (!normalizedHost) {
        throw new Error(
          "The Git remote hostname is empty."
        );
      }
  
      if (!normalizedPath) {
        throw new Error(
          "The Git remote repository path is empty."
        );
      }
  
      return [
        normalizedHost,
        normalizedPath
      ].join("/");
    }
  
    private safeDecodeURIComponent(
      value: string
    ): string {
      try {
        return decodeURIComponent(
          value
        );
      } catch {
        return value;
      }
    }
  }