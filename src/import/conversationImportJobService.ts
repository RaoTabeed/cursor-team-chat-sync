import {
    randomUUID
  } from "node:crypto";
  
  import {
    spawn
  } from "node:child_process";
  
  import {
    mkdir,
    readFile,
    readdir,
    rename,
    writeFile
  } from "node:fs/promises";
  
  import * as path from "node:path";
  
  import type {
    ConversationImportJob,
    ConversationImportLaunchResult,
    ConversationImportWorkerResult
  } from "./conversationImportJobTypes";
  
  export interface StageConversationImportInput {
    bundlePath: string;
  
    bundleSha256: string;
  
    encryptedBundlePath:
      string;
  
    destinationDatabasePath:
      string;
  
    destinationProjectPath:
      string;
  
    destinationWorkspaceId:
      string;
  }
  
  export class ConversationImportJobService {
    private readonly jobsRoot:
      string;
  
    private readonly resultsRoot:
      string;
  
    private readonly backupRoot:
      string;
  
    public constructor(
      private readonly extensionPath:
        string,
  
      private readonly storageRoot:
        string
    ) {
      this.jobsRoot =
        path.join(
          storageRoot,
          "import-jobs",
          "pending"
        );
  
      this.resultsRoot =
        path.join(
          storageRoot,
          "import-jobs",
          "results"
        );
  
      this.backupRoot =
        path.join(
          storageRoot,
          "database-backups"
        );
    }
  
    public async stageAndLaunch(
      input:
        StageConversationImportInput
    ): Promise<ConversationImportLaunchResult> {
      await Promise.all(
        [
          this.jobsRoot,
          this.resultsRoot,
          this.backupRoot
        ].map(
          directory =>
            mkdir(
              directory,
              {
                recursive: true
              }
            )
        )
      );
  
      const jobId =
        randomUUID();
  
      const jobPath =
        path.join(
          this.jobsRoot,
          `${jobId}.import-job.json`
        );
  
      const resultPath =
        path.join(
          this.resultsRoot,
          `${jobId}.result.json`
        );
  
      const job:
        ConversationImportJob = {
          version: 1,
  
          jobId,
  
          createdAt:
            new Date().toISOString(),
  
          bundlePath:
            input.bundlePath,
  
          bundleSha256:
            input.bundleSha256,
  
          encryptedBundlePath:
            input.encryptedBundlePath,
  
          destinationDatabasePath:
            input.destinationDatabasePath,
  
          destinationProjectPath:
            input.destinationProjectPath,
  
          destinationWorkspaceId:
            input.destinationWorkspaceId,
  
          backupRoot:
            this.backupRoot,
  
          resultPath,
  
          waitTimeoutSeconds:
            300
        };
  
      await writeFile(
        jobPath,
        `${JSON.stringify(
          job,
          null,
          2
        )}\n`,
        {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600
        }
      );
  
      try {
        await this.launchWorker(
          jobPath
        );
      } catch (error) {
        await rename(
          jobPath,
          `${jobPath}.failed-to-launch`
        ).catch(
          () => undefined
        );
  
        throw error;
      }
  
      return {
        jobId,
        jobPath,
        resultPath,
        backupRoot:
          this.backupRoot
      };
    }
  
    public async consumeLatestResult():
      Promise<
        ConversationImportWorkerResult
        | undefined
      > {
      let filenames: string[];
  
      try {
        filenames =
          await readdir(
            this.resultsRoot
          );
      } catch (
        error
      ) {
        if (
          this.getErrorCode(error)
          === "ENOENT"
        ) {
          return undefined;
        }
  
        throw error;
      }
  
      const candidates =
        filenames
          .filter(
            filename =>
              filename.endsWith(
                ".result.json"
              )
          )
          .sort()
          .reverse();
  
      const latestFilename =
        candidates[0];
  
      if (!latestFilename) {
        return undefined;
      }
  
      const resultPath =
        path.join(
          this.resultsRoot,
          latestFilename
        );
  
      const serializedResult =
        await readFile(
          resultPath,
          "utf8"
        );
  
      const parsedResult:
        unknown = JSON.parse(
          serializedResult
        );
  
      if (
        typeof parsedResult !==
          "object" ||
        parsedResult === null ||
        Array.isArray(
          parsedResult
        ) ||
        !("ok" in parsedResult)
      ) {
        throw new Error(
          "The latest import result is invalid."
        );
      }
  
      const reportedPath =
        resultPath.replace(
          /\.result\.json$/,
          ".reported.json"
        );
  
      await rename(
        resultPath,
        reportedPath
      );
  
      return parsedResult as
        ConversationImportWorkerResult;
    }
  
    private async launchWorker(
      jobPath: string
    ): Promise<void> {
      const scriptPath =
        path.join(
          this.extensionPath,
          "scripts",
          "apply_conversation_import.py"
        );
  
      const executable =
        process.platform === "win32"
          ? "py"
          : "python3";
  
      const argumentsList =
        process.platform === "win32"
          ? [
              "-3",
              scriptPath,
              jobPath
            ]
          : [
              scriptPath,
              jobPath
            ];
  
      const childProcess =
        spawn(
          executable,
          argumentsList,
          {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
            cwd:
              this.extensionPath
          }
        );
  
      await new Promise<void>(
        (
          resolve,
          reject
        ) => {
          childProcess.once(
            "spawn",
            resolve
          );
  
          childProcess.once(
            "error",
            reject
          );
        }
      );
  
      childProcess.unref();
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