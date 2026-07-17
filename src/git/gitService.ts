import {
    execFile
  } from "node:child_process";
  
  import type {
    GitRepositoryInspection
  } from "./gitTypes";
  
  export class GitService {
    public async inspect(
      projectPath: string
    ): Promise<GitRepositoryInspection> {
      const insideWorkTree =
        await this.tryRunGit(
          [
            "rev-parse",
            "--is-inside-work-tree"
          ],
          projectPath
        );
  
      /*
       * A missing result normally means the selected folder
       * has not been initialized as a Git repository.
       *
       * This is a normal project state, not an application error.
       */
      if (insideWorkTree !== "true") {
        return {
          isRepository: false
        };
      }
  
      try {
        const [
          repositoryRoot,
          remoteUrl,
          rawBranch,
          commitSha,
          statusOutput
        ] = await Promise.all([
          this.runGit(
            [
              "rev-parse",
              "--show-toplevel"
            ],
            projectPath
          ),
  
          this.tryRunGit(
            [
              "remote",
              "get-url",
              "origin"
            ],
            projectPath
          ),
  
          this.tryRunGit(
            [
              "rev-parse",
              "--abbrev-ref",
              "HEAD"
            ],
            projectPath
          ),
  
          this.tryRunGit(
            [
              "rev-parse",
              "HEAD"
            ],
            projectPath
          ),
  
          this.runGit(
            [
              "status",
              "--porcelain=v1"
            ],
            projectPath
          )
        ]);
  
        const changedFiles =
          this.parseChangedFiles(
            statusOutput
          );
  
        const branch =
          rawBranch === "HEAD"
            ? "Detached HEAD"
            : rawBranch;
  
        return {
          isRepository: true,
          repositoryRoot,
          remoteUrl,
          branch,
          commitSha,
          isDirty:
            changedFiles.length > 0,
          changedFileCount:
            changedFiles.length
        };
      } catch (error) {
        return {
          isRepository: true,
  
          inspectionError:
            error instanceof Error
              ? error.message
              : String(error)
        };
      }
    }
  
    private parseChangedFiles(
      statusOutput: string
    ): string[] {
      if (statusOutput.length === 0) {
        return [];
      }
  
      return statusOutput
        .split(/\r?\n/)
        .filter(
          (line) =>
            line.trim().length > 0
        );
    }
  
    private async tryRunGit(
      argumentsList: string[],
      workingDirectory: string
    ): Promise<string | undefined> {
      try {
        return await this.runGit(
          argumentsList,
          workingDirectory
        );
      } catch {
        return undefined;
      }
    }
  
    private runGit(
      argumentsList: string[],
      workingDirectory: string
    ): Promise<string> {
      return new Promise(
        (resolve, reject) => {
          execFile(
            "git",
            argumentsList,
            {
              cwd: workingDirectory,
              windowsHide: true,
              timeout: 10_000,
              maxBuffer:
                1024 * 1024,
              encoding: "utf8"
            },
            (
              error,
              stdout,
              stderr
            ) => {
              if (error) {
                const commandText = [
                  "git",
                  ...argumentsList
                ].join(" ");
  
                const details =
                  stderr.trim() ||
                  error.message;
  
                reject(
                  new Error(
                    `Git command failed: ${commandText}\n${details}`,
                    {
                      cause: error
                    }
                  )
                );
  
                return;
              }
  
              resolve(
                stdout.trim()
              );
            }
          );
        }
      );
    }
  }