import * as vscode from "vscode";

import {
  InspectCurrentProjectCommand
} from "./commands/inspectCurrentProjectCommand";

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
  GitService
} from "./git/gitService";

import {
  OutputLogger
} from "./logging/outputLogger";

import {
  CurrentProjectInspector
} from "./projects/currentProjectInspector";

export function activate(
  context: vscode.ExtensionContext
): void {
  const logger =
    new OutputLogger();

  const storageLocator =
    new CursorStorageLocator();

  const gitService =
    new GitService();

  const currentProjectInspector =
    new CurrentProjectInspector(
      storageLocator,
      gitService
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