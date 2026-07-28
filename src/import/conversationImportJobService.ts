import {
  spawn
} from "node:child_process";

import {
  randomUUID
} from "node:crypto";

import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
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

  encryptedBundlePath: string;

  destinationDatabasePath: string;

  destinationWorkspaceDatabasePath?: string;

  destinationProjectPath: string;

  destinationWorkspaceId: string;
}

interface ImportResultCandidate {
  filename: string;

  modifiedAt: number;
}

export class ConversationImportJobService {
  private readonly jobsRoot: string;

  private readonly resultsRoot: string;

  private readonly backupRoot: string;

  public constructor(
    private readonly extensionPath: string,

    private readonly storageRoot: string
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
    input: StageConversationImportInput
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

    const destinationWorkspaceDatabasePath =
      input.destinationWorkspaceDatabasePath
      ??
      this.resolveWorkspaceDatabasePath(
        input.destinationDatabasePath,
        input.destinationWorkspaceId
      );

    const job:
      ConversationImportJob = {
        version:
          4,

        jobId,

        createdAt:
          new Date().toISOString(),

        extensionHostProcessId:
          process.pid,

        bundlePath:
          input.bundlePath,

        bundleSha256:
          input.bundleSha256,

        encryptedBundlePath:
          input.encryptedBundlePath,

        destinationDatabasePath:
          input.destinationDatabasePath,

        destinationWorkspaceDatabasePath,

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
        encoding:
          "utf8",

        flag:
          "wx",

        mode:
          0o600
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
      ConversationImportWorkerResult |
      undefined
    > {
    let filenames:
      string[];

    try {
      filenames =
        await readdir(
          this.resultsRoot
        );
    } catch (error) {
      if (
        this.getErrorCode(
          error
        ) === "ENOENT"
      ) {
        return undefined;
      }

      throw error;
    }

    const candidates:
      ImportResultCandidate[] =
        await Promise.all(
          filenames
            .filter(
              filename =>
                filename.endsWith(
                  ".result.json"
                )
            )
            .map(
              async filename => {
                const filePath =
                  path.join(
                    this.resultsRoot,
                    filename
                  );

                const fileStat =
                  await stat(
                    filePath
                  );

                return {
                  filename,

                  modifiedAt:
                    fileStat.mtimeMs
                };
              }
            )
        );

    candidates.sort(
      (
        left,
        right
      ) => {
        const timeDifference =
          right.modifiedAt -
          left.modifiedAt;

        if (
          timeDifference !== 0
        ) {
          return timeDifference;
        }

        return right
          .filename
          .localeCompare(
            left.filename
          );
      }
    );

    const latestFilename =
      candidates[0]
        ?.filename;

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
      unknown =
        JSON.parse(
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

  private resolveWorkspaceDatabasePath(
    destinationDatabasePath: string,
    destinationWorkspaceId: string
  ): string {
    const normalizedWorkspaceId =
      destinationWorkspaceId
        .trim()
        .toLowerCase();

    if (
      !/^[0-9a-f]{32}$/.test(
        normalizedWorkspaceId
      )
    ) {
      throw new Error(
        [
          "The destination workspace ID is invalid:",
          destinationWorkspaceId
        ].join(" ")
      );
    }

    const globalStorageDirectory =
      path.dirname(
        path.resolve(
          destinationDatabasePath
        )
      );

    const cursorUserDirectory =
      path.dirname(
        globalStorageDirectory
      );

    return path.join(
      cursorUserDirectory,
      "workspaceStorage",
      normalizedWorkspaceId,
      "state.vscdb"
    );
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
          detached:
            true,

          stdio:
            "ignore",

          windowsHide:
            true,

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
      typeof error !== "object" ||
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
      errorWithCode.code === "string"
      ? errorWithCode.code
      : undefined;
  }
}