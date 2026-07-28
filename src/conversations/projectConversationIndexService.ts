import type {
  ProjectConversationIndex
} from "./projectConversationTypes";

import type {
  PythonJsonScriptRunner
} from "../runtime/pythonJsonScriptRunner";

export class ProjectConversationIndexService {
  public constructor(
    private readonly pythonRunner:
      PythonJsonScriptRunner
  ) {}

  public index(
    globalDatabasePath: string,
    projectPath: string
  ): Promise<ProjectConversationIndex> {
    return this.pythonRunner
      .runScript<ProjectConversationIndex>(
        "scripts/index_workspace_project_conversations.py",
        [
          globalDatabasePath,
          projectPath
        ]
      );
  }
}