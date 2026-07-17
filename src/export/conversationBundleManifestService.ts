import type {
    PythonJsonScriptRunner
  } from "../runtime/pythonJsonScriptRunner";
  
  import type {
    ProjectConversationBundleManifest
  } from "./conversationBundleManifestTypes";
  
  export class ConversationBundleManifestService {
    public constructor(
      private readonly pythonRunner:
        PythonJsonScriptRunner
    ) {}
  
    public build(
      globalDatabasePath: string,
      projectPath: string
    ): Promise<ProjectConversationBundleManifest> {
      return this.pythonRunner
        .runScript<ProjectConversationBundleManifest>(
          "scripts/build_conversation_bundle_manifest.py",
          [
            globalDatabasePath,
            projectPath
          ]
        );
    }
  }