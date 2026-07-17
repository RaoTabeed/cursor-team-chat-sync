import * as vscode from "vscode";

import type {
  OutputLogger
} from "../logging/outputLogger";

import type {
  CurrentProjectInspector
} from "../projects/currentProjectInspector";

import type {
  CurrentProjectInspection
} from "../projects/currentProjectTypes";

export class InspectCurrentProjectCommand {
  public constructor(
    private readonly projectInspector:
      CurrentProjectInspector,

    private readonly logger:
      OutputLogger
  ) {}

  public async execute(): Promise<void> {
    this.logger.show();

    this.logger.info(
      "Inspecting a local project..."
    );

    try {
      const result =
        await this.projectInspector.inspect();

      this.logInspectionResult(result);

      const summary =
        result.git.isRepository
          ? `Project inspected. Branch: ${
              result.git.branch ??
              "unknown"
            }, changed files: ${
              result.git
                .changedFileCount ?? 0
            }.`
          : "Project inspected. It is not currently a Git repository.";

      await vscode.window
        .showInformationMessage(
          summary
        );
    } catch (error) {
      if (
        this.isCancellationError(error)
      ) {
        this.logger.info(
          "Project inspection was cancelled."
        );

        return;
      }

      this.logger.error(
        "Current-project inspection failed.",
        error
      );

      await vscode.window
        .showErrorMessage(
          "Current-project inspection failed. Check the Output panel."
        );
    }
  }

  private logInspectionResult(
    result: CurrentProjectInspection
  ): void {
    this.logger.info(
      "========================================"
    );

    this.logger.info(
      `Project name: ${result.workspaceFolderName}`
    );

    this.logger.info(
      `Project URI: ${result.workspaceFolderUri}`
    );

    this.logger.info(
      `Project path: ${result.projectPath}`
    );

    this.logger.info(
      `Cursor workspace matched: ${
        result.cursorWorkspace
          ? "Yes"
          : "No"
      }`
    );

    if (result.cursorWorkspace) {
      this.logger.info(
        `Cursor workspace ID: ${result.cursorWorkspace.workspaceId}`
      );

      this.logger.info(
        `Cursor workspace database: ${result.cursorWorkspace.databasePath}`
      );
    } else {
      this.logger.info(
        "No existing Cursor workspace database was matched to this project."
      );
    }

    this.logger.info(
      `Git repository: ${
        result.git.isRepository
          ? "Yes"
          : "No"
      }`
    );

    if (result.git.isRepository) {
      this.logGitResult(result);
    }

    if (
      result.git.inspectionError
    ) {
      this.logger.error(
        "Git inspection returned an error.",
        result.git.inspectionError
      );
    }
  }

  private logGitResult(
    result: CurrentProjectInspection
  ): void {
    this.logger.info(
      `Git root: ${
        result.git.repositoryRoot ??
        "Not available"
      }`
    );

    this.logger.info(
      `Git remote: ${
        result.git.remoteUrl ??
        "No origin remote configured"
      }`
    );

    this.logger.info(
      `Git branch: ${
        result.git.branch ??
        "Not available"
      }`
    );

    this.logger.info(
      `Git commit: ${
        result.git.commitSha ??
        "No commit available"
      }`
    );

    this.logger.info(
      `Working tree dirty: ${
        result.git.isDirty
          ? "Yes"
          : "No"
      }`
    );

    this.logger.info(
      `Changed files: ${
        result.git.changedFileCount ?? 0
      }`
    );
  }

  private isCancellationError(
    error: unknown
  ): boolean {
    return (
      error instanceof Error &&
      error.message.includes(
        "inspection was cancelled"
      )
    );
  }
}