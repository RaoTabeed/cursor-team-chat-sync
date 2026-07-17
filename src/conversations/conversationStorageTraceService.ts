import type {
    PythonJsonScriptRunner
  } from "../runtime/pythonJsonScriptRunner";
  
  import type {
    ProjectConversationStorageTrace
  } from "./conversationStorageTraceTypes";
  
  export class ConversationStorageTraceService {
    public constructor(
      private readonly pythonRunner:
        PythonJsonScriptRunner
    ) {}
  
    public trace(
      globalDatabasePath: string,
      projectPath: string
    ): Promise<ProjectConversationStorageTrace> {
      return this.pythonRunner
        .runScript<ProjectConversationStorageTrace>(
          "scripts/trace_project_conversation_storage.py",
          [
            globalDatabasePath,
            projectPath
          ]
        );
    }
  }