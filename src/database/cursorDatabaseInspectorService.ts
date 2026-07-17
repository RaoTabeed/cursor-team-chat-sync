import {
    execFile
  } from "node:child_process";
  
  import * as fs from "node:fs/promises";
  
  import * as path from "node:path";
  
  import type {
    CursorDatabaseInspection,
    PythonRuntime
  } from "./databaseInspectionTypes";
  
  interface ProcessResult {
    stdout: string;
  
    stderr: string;
  }
  
  export class CursorDatabaseInspectorService {
    private pythonRuntimePromise:
      Promise<PythonRuntime> | undefined;
  
    public constructor(
      private readonly extensionPath:
        string
    ) {}
  
    public async inspect(
      databasePath: string
    ): Promise<CursorDatabaseInspection> {
      const scriptPath = path.join(
        this.extensionPath,
        "scripts",
        "inspect_cursor_database.py"
      );
  
      await this.ensureFileExists(
        scriptPath,
        "SQLite inspection helper"
      );
  
      await this.ensureFileExists(
        databasePath,
        "Cursor database"
      );
  
      const runtime =
        await this.resolvePythonRuntime();
  
      const processResult =
        await this.runProcess(
          runtime.executable,
          [
            ...runtime.prefixArguments,
            scriptPath,
            databasePath
          ],
          30_000
        );
  
      const rawOutput =
        processResult.stdout.trim();
  
      if (!rawOutput) {
        throw new Error(
          "The SQLite helper returned no JSON output."
        );
      }
  
      let parsed: unknown;
  
      try {
        parsed = JSON.parse(rawOutput);
      } catch (error) {
        throw new Error(
          `The SQLite helper returned invalid JSON.\n${rawOutput}`,
          {
            cause: error
          }
        );
      }
  
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error(
          "The SQLite helper returned an invalid result object."
        );
      }
  
      const result =
        parsed as {
          ok?: unknown;
          error?: unknown;
        };
  
      if (result.ok !== true) {
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "The SQLite helper reported an unknown error."
        );
      }
  
      return parsed as CursorDatabaseInspection;
    }
  
    private resolvePythonRuntime():
      Promise<PythonRuntime> {
      this.pythonRuntimePromise ??=
        this.findPythonRuntime();
  
      return this.pythonRuntimePromise;
    }
  
    private async findPythonRuntime():
      Promise<PythonRuntime> {
      const candidates:
        PythonRuntime[] =
          process.platform === "win32"
            ? [
                {
                  executable: "py",
                  prefixArguments: [
                    "-3"
                  ],
                  displayName:
                    "Python Launcher (py -3)"
                },
                {
                  executable:
                    "python",
                  prefixArguments: [],
                  displayName:
                    "Python"
                },
                {
                  executable:
                    "python3",
                  prefixArguments: [],
                  displayName:
                    "Python 3"
                }
              ]
            : [
                {
                  executable:
                    "python3",
                  prefixArguments: [],
                  displayName:
                    "Python 3"
                },
                {
                  executable:
                    "python",
                  prefixArguments: [],
                  displayName:
                    "Python"
                }
              ];
  
      for (
        const candidate of candidates
      ) {
        const available =
          await this.runtimeIsAvailable(
            candidate
          );
  
        if (available) {
          return candidate;
        }
      }
  
      throw new Error(
        "Python 3 was not found. Install Python 3 or make it available through py, python, or python3."
      );
    }
  
    private async runtimeIsAvailable(
      runtime: PythonRuntime
    ): Promise<boolean> {
      try {
        await this.runProcess(
          runtime.executable,
          [
            ...runtime.prefixArguments,
            "--version"
          ],
          5_000
        );
  
        return true;
      } catch {
        return false;
      }
    }
  
    private runProcess(
      executable: string,
      argumentsList: string[],
      timeout: number
    ): Promise<ProcessResult> {
      return new Promise(
        (resolve, reject) => {
          execFile(
            executable,
            argumentsList,
            {
              windowsHide: true,
              timeout,
              maxBuffer:
                10 * 1024 * 1024,
              encoding: "utf8"
            },
            (
              error,
              stdout,
              stderr
            ) => {
              if (error) {
                const commandText = [
                  executable,
                  ...argumentsList
                ].join(" ");
  
                const details = [
                  stdout.trim(),
                  stderr.trim(),
                  error.message
                ]
                  .filter(
                    (value) =>
                      value.length > 0
                  )
                  .join("\n");
  
                reject(
                  new Error(
                    `Process failed: ${commandText}\n${details}`,
                    {
                      cause: error
                    }
                  )
                );
  
                return;
              }
  
              resolve({
                stdout,
                stderr
              });
            }
          );
        }
      );
    }
  
    private async ensureFileExists(
      filePath: string,
      description: string
    ): Promise<void> {
      try {
        await fs.access(filePath);
      } catch (error) {
        throw new Error(
          `${description} was not found: ${filePath}`,
          {
            cause: error
          }
        );
      }
    }
  }