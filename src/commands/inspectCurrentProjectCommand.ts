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
        result.projectIdentity
          ? `Project inspected. Stable ID: ${result.projectIdentity.projectId.slice(0, 12)}...`
          : result.git.isRepository
            ? "Project inspected, but no usable origin remote is configured."
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

    this.logProjectIdentity(result);

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
      `Git origin configured: ${
        result.git.remoteUrl
          ? "Yes"
          : "No"
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

  private logProjectIdentity(
    result: CurrentProjectInspection
  ): void {
    if (result.projectIdentity) {
      this.logger.info(
        `Canonical Git remote: ${result.projectIdentity.canonicalRemote}`
      );

      this.logger.info(
        `Stable project ID: ${result.projectIdentity.projectId}`
      );

      return;
    }

    this.logger.info(
      "Stable project ID: Not available"
    );

    if (
      result.projectIdentityError
    ) {
      this.logger.error(
        "Project identity generation failed.",
        result.projectIdentityError
      );
    }
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