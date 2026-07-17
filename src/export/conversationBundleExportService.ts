import type {
    PythonJsonScriptRunner
  } from "../runtime/pythonJsonScriptRunner";
  
  import type {
    ConversationBundleExportResult
  } from "./conversationBundleExportTypes";
  
  export class ConversationBundleExportService {
    public constructor(
      private readonly pythonRunner:
        PythonJsonScriptRunner,
  
      private readonly outputRoot:
        string
    ) {}
  
    public createBundle(
      globalDatabasePath: string,
      projectPath: string
    ): Promise<ConversationBundleExportResult> {
      return this.pythonRunner
        .runScript<ConversationBundleExportResult>(
          "scripts/export_conversation_bundle.py",
          [
            globalDatabasePath,
            projectPath,
            this.outputRoot
          ]
        );
    }
  }