import * as vscode from "vscode";

import {
  InspectCurrentProjectCommand
} from "./commands/inspectCurrentProjectCommand";

import {
  InspectCursorDatabasesCommand
} from "./commands/inspectCursorDatabasesCommand";

import {
  InspectCursorStorageCommand
} from "./commands/inspectCursorStorageCommand";

import {
  COMMANDS
} from "./constants/commands";

import {
  CursorStorageLocator
} from "./cursor/cursorStorageLocator";

import {
  CursorDatabaseInspectorService
} from "./database/cursorDatabaseInspectorService";

import {
  GitService
} from "./git/gitService";

import {
  OutputLogger
} from "./logging/outputLogger";

import {
  CurrentProjectInspector
} from "./projects/currentProjectInspector";

import {
  ProjectIdentityService
} from "./projects/projectIdentityService";

export function activate(
  context: vscode.ExtensionContext
): void {
  const logger =
    new OutputLogger();

  const storageLocator =
    new CursorStorageLocator();

  const gitService =
    new GitService();

  const projectIdentityService =
    new ProjectIdentityService();

  const databaseInspector =
    new CursorDatabaseInspectorService(
      context.extensionPath
    );

  const currentProjectInspector =
    new CurrentProjectInspector(
      storageLocator,
      gitService,
      projectIdentityService
    );

  const inspectStorageCommand =
    new InspectCursorStorageCommand(
      storageLocator,
      logger
    );

  const inspectCurrentProjectCommand =
    new InspectCurrentProjectCommand(
      currentProjectInspector,
      logger
    );

  const inspectCursorDatabasesCommand =
    new InspectCursorDatabasesCommand(
      currentProjectInspector,
      storageLocator,
      databaseInspector,
      logger
    );

  context.subscriptions.push(
    logger,

    vscode.commands.registerCommand(
      COMMANDS.inspectStorage,
      () =>
        inspectStorageCommand.execute()
    ),

    vscode.commands.registerCommand(
      COMMANDS.inspectCurrentProject,
      () =>
        inspectCurrentProjectCommand
          .execute()
    ),

    vscode.commands.registerCommand(
      COMMANDS
        .inspectCurrentProjectDatabases,
      () =>
        inspectCursorDatabasesCommand
          .execute()
    )
  );

  logger.info(
    "Cursor Team Chat Sync activated."
  );
}

export function deactivate(): void {
  // Resources inside context.subscriptions
  // are disposed automatically.
}