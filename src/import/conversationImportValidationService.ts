import type {
    PythonJsonScriptRunner
  } from "../runtime/pythonJsonScriptRunner";
  
  import type {
    ConversationImportValidationResult
  } from "./conversationImportValidationTypes";
  
  export class ConversationImportValidationService {
    public constructor(
      private readonly pythonRunner:
        PythonJsonScriptRunner
    ) {}
  
    public validate(
      decryptedBundlePath:
        string,
  
      destinationDatabasePath:
        string,
  
      destinationProjectPath:
        string
    ): Promise<ConversationImportValidationResult> {
      return this.pythonRunner
        .runScript<ConversationImportValidationResult>(
          "scripts/validate_conversation_bundle.py",
          [
            decryptedBundlePath,
            destinationDatabasePath,
            destinationProjectPath
          ]
        );
    }
  }