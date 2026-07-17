import type {
    CursorDatabaseInspection
  } from "./databaseInspectionTypes";
  
  import type {
    PythonJsonScriptRunner
  } from "../runtime/pythonJsonScriptRunner";
  
  export class CursorDatabaseInspectorService {
    public constructor(
      private readonly pythonRunner:
        PythonJsonScriptRunner
    ) {}
  
    public inspect(
      databasePath: string
    ): Promise<CursorDatabaseInspection> {
      return this.pythonRunner
        .runScript<CursorDatabaseInspection>(
          "scripts/inspect_cursor_database.py",
          [
            databasePath
          ]
        );
    }
  }