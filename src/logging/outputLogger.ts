import * as vscode from "vscode";

export class OutputLogger
  implements vscode.Disposable {
  private readonly outputChannel =
    vscode.window.createOutputChannel(
      "Cursor Team Chat Sync"
    );

  public info(message: string): void {
    this.outputChannel.appendLine(
      `[INFO] ${message}`
    );
  }

  public error(
    message: string,
    error?: unknown
  ): void {
    const details =
      error instanceof Error
        ? error.stack ?? error.message
        : error === undefined
          ? ""
          : String(error);

    this.outputChannel.appendLine(
      `[ERROR] ${message}`
    );

    if (details) {
      this.outputChannel.appendLine(details);
    }
  }

  public show(): void {
    this.outputChannel.show(true);
  }

  public dispose(): void {
    this.outputChannel.dispose();
  }
}