import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  fileURLToPath
} from "node:url";

import type {
  CursorStorageInspection,
  CursorWorkspaceKind,
  CursorWorkspaceStorage
} from "./cursorStorageTypes";

interface CursorWorkspaceJson {
  folder?: unknown;
  workspace?: unknown;
}

export class CursorStorageLocator {
  public async inspect(): Promise<CursorStorageInspection> {
    const platform: NodeJS.Platform =
      process.platform;

    const userDataDirectory =
      this.resolveCursorUserDataDirectory(
        platform
      );

    const globalDatabasePath = path.join(
      userDataDirectory,
      "globalStorage",
      "state.vscdb"
    );

    const workspaceStorageDirectory =
      path.join(
        userDataDirectory,
        "workspaceStorage"
      );

    const [
      globalDatabaseExists,
      workspaceStorageExists
    ] = await Promise.all([
      this.pathExists(globalDatabasePath),
      this.pathExists(
        workspaceStorageDirectory
      )
    ]);

    const workspaces =
      workspaceStorageExists
        ? await this.findWorkspaces(
            workspaceStorageDirectory
          )
        : [];

    return {
      platform,
      userDataDirectory,
      globalDatabasePath,
      globalDatabaseExists,
      workspaceStorageDirectory,
      workspaceStorageExists,
      workspaces
    };
  }

  private resolveCursorUserDataDirectory(
    platform: NodeJS.Platform
  ): string {
    switch (platform) {
      case "win32":
        return this.resolveWindowsUserDataDirectory();

      case "darwin":
        return path.join(
          os.homedir(),
          "Library",
          "Application Support",
          "Cursor",
          "User"
        );

      case "linux":
        return path.join(
          os.homedir(),
          ".config",
          "Cursor",
          "User"
        );

      default:
        throw new Error(
          `Unsupported operating system: ${platform}`
        );
    }
  }

  private resolveWindowsUserDataDirectory(): string {
    const appData = process.env.APPDATA;

    if (!appData) {
      throw new Error(
        "The APPDATA environment variable is unavailable. Cursor Team Chat Sync cannot locate Cursor's user-data directory."
      );
    }

    return path.join(
      appData,
      "Cursor",
      "User"
    );
  }

  private async findWorkspaces(
    workspaceStorageDirectory: string
  ): Promise<CursorWorkspaceStorage[]> {
    let entries: Awaited<
      ReturnType<typeof fs.readdir>
    >;

    try {
      entries = await fs.readdir(
        workspaceStorageDirectory,
        {
          withFileTypes: true
        }
      );
    } catch (error) {
      throw new Error(
        `Unable to read Cursor workspace storage: ${workspaceStorageDirectory}`,
        {
          cause: error
        }
      );
    }

    const workspaceChecks = entries
      .filter(
        (entry) => entry.isDirectory()
      )
      .map((entry) =>
        this.inspectWorkspace(
          workspaceStorageDirectory,
          entry.name
        )
      );

    const workspaces = await Promise.all(
      workspaceChecks
    );

    return workspaces
      .filter(
        (
          workspace
        ): workspace is CursorWorkspaceStorage =>
          workspace !== null
      )
      .sort((left, right) => {
        const leftName =
          left.projectPath ??
          left.workspaceId;

        const rightName =
          right.projectPath ??
          right.workspaceId;

        return leftName.localeCompare(
          rightName
        );
      });
  }

  private async inspectWorkspace(
    workspaceStorageDirectory: string,
    workspaceId: string
  ): Promise<CursorWorkspaceStorage | null> {
    const workspaceDirectory = path.join(
      workspaceStorageDirectory,
      workspaceId
    );

    const databasePath = path.join(
      workspaceDirectory,
      "state.vscdb"
    );

    const workspaceJsonPath = path.join(
      workspaceDirectory,
      "workspace.json"
    );

    const [
      databaseExists,
      workspaceJsonExists
    ] = await Promise.all([
      this.pathExists(databasePath),
      this.pathExists(workspaceJsonPath)
    ]);

    if (!databaseExists) {
      return null;
    }

    if (!workspaceJsonExists) {
      return {
        workspaceId,
        workspaceDirectory,
        databasePath,
        databaseExists,
        workspaceJsonPath,
        workspaceJsonExists,
        workspaceKind: "unknown"
      };
    }

    try {
      const workspaceJson =
        await this.readWorkspaceJson(
          workspaceJsonPath
        );

      const mapping =
        this.extractWorkspaceMapping(
          workspaceJson
        );

      return {
        workspaceId,
        workspaceDirectory,
        databasePath,
        databaseExists,
        workspaceJsonPath,
        workspaceJsonExists,
        workspaceKind:
          mapping.workspaceKind,
        projectUri: mapping.projectUri,
        projectPath: mapping.projectPath
      };
    } catch (error) {
      return {
        workspaceId,
        workspaceDirectory,
        databasePath,
        databaseExists,
        workspaceJsonPath,
        workspaceJsonExists,
        workspaceKind: "unknown",
        mappingError:
          error instanceof Error
            ? error.message
            : String(error)
      };
    }
  }

  private async readWorkspaceJson(
    workspaceJsonPath: string
  ): Promise<CursorWorkspaceJson> {
    const contents = await fs.readFile(
      workspaceJsonPath,
      "utf8"
    );

    const parsed: unknown =
      JSON.parse(contents);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      throw new Error(
        "workspace.json does not contain a valid object."
      );
    }

    return parsed as CursorWorkspaceJson;
  }

  private extractWorkspaceMapping(
    workspaceJson: CursorWorkspaceJson
  ): {
    workspaceKind: CursorWorkspaceKind;
    projectUri?: string;
    projectPath?: string;
  } {
    if (
      typeof workspaceJson.folder ===
      "string"
    ) {
      return {
        workspaceKind: "folder",
        projectUri: workspaceJson.folder,
        projectPath:
          this.convertUriToLocalPath(
            workspaceJson.folder
          )
      };
    }

    if (
      typeof workspaceJson.workspace ===
      "string"
    ) {
      return {
        workspaceKind: "workspace",
        projectUri:
          workspaceJson.workspace,
        projectPath:
          this.convertUriToLocalPath(
            workspaceJson.workspace
          )
      };
    }

    return {
      workspaceKind: "unknown"
    };
  }

  private convertUriToLocalPath(
    uri: string
  ): string | undefined {
    if (!uri.startsWith("file:")) {
      return undefined;
    }

    try {
      return fileURLToPath(uri);
    } catch {
      return undefined;
    }
  }

  private async pathExists(
    targetPath: string
  ): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }
}