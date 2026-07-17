import * as path from "node:path";
import * as vscode from "vscode";

import type {
  CursorStorageLocator
} from "../cursor/cursorStorageLocator";

import type {
  GitService
} from "../git/gitService";

import type {
  CurrentProjectInspection
} from "./currentProjectTypes";

interface SelectedProject {
  name: string;
  uri: vscode.Uri;
}

interface WorkspaceFolderQuickPickItem
  extends vscode.QuickPickItem {
  workspaceFolder:
    vscode.WorkspaceFolder;
}

export class CurrentProjectInspector {
  public constructor(
    private readonly storageLocator:
      CursorStorageLocator,

    private readonly gitService:
      GitService
  ) {}

  public async inspect():
    Promise<CurrentProjectInspection> {
    const selectedProject =
      await this.selectProject();

    if (
      selectedProject.uri.scheme !==
      "file"
    ) {
      throw new Error(
        `Only local file-system projects are currently supported. Received URI scheme: ${selectedProject.uri.scheme}`
      );
    }

    const projectPath =
      selectedProject.uri.fsPath;

    const storageInspection =
      await this.storageLocator.inspect();

    const cursorWorkspace =
      storageInspection.workspaces.find(
        (workspace) =>
          workspace.projectPath !==
            undefined &&
          this.pathsAreEqual(
            workspace.projectPath,
            projectPath
          )
      );

    const git =
      await this.gitService.inspect(
        projectPath
      );

    return {
      workspaceFolderName:
        selectedProject.name,

      workspaceFolderUri:
        selectedProject.uri.toString(),

      projectPath,
      cursorWorkspace,
      git
    };
  }

  private async selectProject():
    Promise<SelectedProject> {
    const workspaceFolders =
      vscode.workspace.workspaceFolders;

    if (
      workspaceFolders &&
      workspaceFolders.length === 1
    ) {
      const workspaceFolder =
        workspaceFolders[0];

      return {
        name: workspaceFolder.name,
        uri: workspaceFolder.uri
      };
    }

    if (
      workspaceFolders &&
      workspaceFolders.length > 1
    ) {
      return this.selectFromOpenWorkspaces(
        workspaceFolders
      );
    }

    return this.selectFromFileSystem();
  }

  private async selectFromOpenWorkspaces(
    workspaceFolders:
      readonly vscode.WorkspaceFolder[]
  ): Promise<SelectedProject> {
    const quickPickItems:
      WorkspaceFolderQuickPickItem[] =
        workspaceFolders.map(
          (workspaceFolder) => ({
            label:
              workspaceFolder.name,

            description:
              workspaceFolder.uri.fsPath,

            workspaceFolder
          })
        );

    const selected =
      await vscode.window.showQuickPick(
        quickPickItems,
        {
          title:
            "Select the project to inspect",

          placeHolder:
            "Choose one open project folder",

          ignoreFocusOut: true
        }
      );

    if (!selected) {
      throw new Error(
        "Current-project inspection was cancelled."
      );
    }

    return {
      name:
        selected.workspaceFolder.name,

      uri:
        selected.workspaceFolder.uri
    };
  }

  private async selectFromFileSystem():
    Promise<SelectedProject> {
    const selectedFolders =
      await vscode.window.showOpenDialog({
        title:
          "Select a project to inspect",

        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,

        openLabel:
          "Inspect Project"
      });

    const selectedFolder =
      selectedFolders?.[0];

    if (!selectedFolder) {
      throw new Error(
        "Current-project inspection was cancelled."
      );
    }

    return {
      name:
        path.basename(
          selectedFolder.fsPath
        ),

      uri:
        selectedFolder
    };
  }

  private pathsAreEqual(
    firstPath: string,
    secondPath: string
  ): boolean {
    return (
      this.normalizePath(firstPath) ===
      this.normalizePath(secondPath)
    );
  }

  private normalizePath(
    inputPath: string
  ): string {
    const normalized =
      path.normalize(
        path.resolve(inputPath)
      );

    const withoutTrailingSeparator =
      normalized.replace(
        /[\\/]+$/,
        ""
      );

    return process.platform ===
      "win32"
      ? withoutTrailingSeparator
          .toLowerCase()
      : withoutTrailingSeparator;
  }
}