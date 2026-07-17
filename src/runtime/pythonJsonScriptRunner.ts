import {
    execFile
  } from "node:child_process";
  
  import * as fs from "node:fs/promises";
  import * as path from "node:path";
  
  interface PythonRuntime {
    executable: string;
  
    prefixArguments: string[];
  
    displayName: string;
  }
  
  interface ProcessResult {
    stdout: string;
  
    stderr: string;
  }
  
  interface HelperResultEnvelope {
    ok?: unknown;
  
    error?: unknown;
  }
  
  export class PythonJsonScriptRunner {
    private pythonRuntimePromise:
      Promise<PythonRuntime> | undefined;
  
    public constructor(
      private readonly extensionPath: string
    ) {}
  
    public async runScript<T>(
      relativeScriptPath: string,
      argumentsList: string[]
    ): Promise<T> {
      const scriptPath = path.join(
        this.extensionPath,
        ...relativeScriptPath.split(
          /[\\/]/
        )
      );
  
      await this.ensureFileExists(
        scriptPath,
        "Python helper script"
      );
  
      const runtime =
        await this.resolvePythonRuntime();
  
      const result =
        await this.runProcess(
          runtime.executable,
          [
            ...runtime.prefixArguments,
            scriptPath,
            ...argumentsList
          ],
          30_000
        );
  
      const rawOutput =
        result.stdout.trim();
  
      if (!rawOutput) {
        throw new Error(
          `${runtime.displayName} helper returned no JSON output.`
        );
      }
  
      let parsedResult: unknown;
  
      try {
        parsedResult =
          JSON.parse(rawOutput);
      } catch (error) {
        throw new Error(
          `Python helper returned invalid JSON.\n${rawOutput}`,
          {
            cause: error
          }
        );
      }
  
      if (
        typeof parsedResult !== "object" ||
        parsedResult === null ||
        Array.isArray(parsedResult)
      ) {
        throw new Error(
          "Python helper returned an invalid result object."
        );
      }
  
      const envelope =
        parsedResult as HelperResultEnvelope;
  
      if (envelope.ok !== true) {
        throw new Error(
          typeof envelope.error ===
            "string"
            ? envelope.error
            : "Python helper reported an unknown error."
        );
      }
  
      return parsedResult as T;
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
                    "Python Launcher"
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
        if (
          await this.runtimeIsAvailable(
            candidate
          )
        ) {
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
                15 * 1024 * 1024,
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