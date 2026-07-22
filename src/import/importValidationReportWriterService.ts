import {
    createHash
  } from "node:crypto";
  
  import {
    mkdir,
    rename,
    writeFile
  } from "node:fs/promises";
  
  import * as path from "node:path";
  
  import type {
    ConversationImportValidationResult
  } from "./conversationImportValidationTypes";
  
  export class ImportValidationReportWriterService {
    public constructor(
      private readonly storageRoot:
        string
    ) {}
  
    public async write(
      result:
        ConversationImportValidationResult
    ): Promise<string> {
      const projectHash =
        createHash("sha256")
          .update(
            result.destination
              .projectPath
              .toLowerCase(),
            "utf8"
          )
          .digest("hex")
          .slice(0, 24);
  
      const reportDirectory =
        path.join(
          this.storageRoot,
          "import-validation",
          "reports",
          projectHash
        );
  
      await mkdir(
        reportDirectory,
        {
          recursive: true
        }
      );
  
      const timestamp =
        result.validatedAt.replace(
          /[:.]/g,
          "-"
        );
  
      const finalPath =
        path.join(
          reportDirectory,
          `${timestamp}.import-plan.json`
        );
  
      const temporaryPath =
        `${finalPath}.tmp-${process.pid}`;
  
      const report = {
        ...result,
  
        bundle: {
          ...result.bundle,
  
          path:
            "[TEMPORARY PLAINTEXT DELETED]"
        }
      };
  
      await writeFile(
        temporaryPath,
        `${JSON.stringify(
          report,
          null,
          2
        )}\n`,
        {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600
        }
      );
  
      await rename(
        temporaryPath,
        finalPath
      );
  
      return finalPath;
    }
  }