import * as vscode from "vscode";

import type {
  SupabaseCloudConfiguration
} from "./cursorCloudSyncTypes";

export class SupabaseConfigService {
  public get():
    SupabaseCloudConfiguration {
    const configuration =
      vscode.workspace.getConfiguration(
        "cursorTeamChatSync"
      );

    const supabaseUrl =
      configuration
        .get<string>(
          "supabaseUrl"
        )
        ?.trim() ?? "";

    const publishableKey =
      configuration
        .get<string>(
          "supabasePublishableKey"
        )
        ?.trim() ?? "";

    if (!supabaseUrl) {
      throw new Error(
        "Set cursorTeamChatSync.supabaseUrl in Cursor Settings before using cloud sync."
      );
    }

    if (!publishableKey) {
      throw new Error(
        "Set cursorTeamChatSync.supabasePublishableKey in Cursor Settings before using cloud sync."
      );
    }

    let parsedUrl: URL;

    try {
      parsedUrl =
        new URL(
          supabaseUrl
        );
    } catch {
      throw new Error(
        "cursorTeamChatSync.supabaseUrl is not a valid URL."
      );
    }

    const isLocal =
      parsedUrl.hostname ===
        "localhost" ||
      parsedUrl.hostname ===
        "127.0.0.1";

    if (
      parsedUrl.protocol !==
        "https:" &&
      !isLocal
    ) {
      throw new Error(
        "The Supabase URL must use HTTPS."
      );
    }

    return {
      supabaseUrl:
        parsedUrl
          .toString()
          .replace(/\/$/, ""),

      publishableKey
    };
  }
}