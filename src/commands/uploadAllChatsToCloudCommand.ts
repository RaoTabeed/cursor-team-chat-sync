import * as vscode from "vscode";

import type {
    CloudProjectDescriptorService
} from "../cloud/cloudProjectDescriptorService";

import type {
    CloudVaultCredentialStore
} from "../cloud/cloudVaultCredentialStore";

import type {
    CursorCloudStorageService
} from "../cloud/cursorCloudStorageService";

import type {
    CursorCloudSyncApiService
} from "../cloud/cursorCloudSyncApiService";

import type {
    CursorSyncKeyService
} from "../crypto/cursorSyncKeyService";

import type {
    CursorSyncKeyMaterial,
    GeneratedCursorSyncKey
} from "../crypto/cursorSyncKeyTypes";

import type {
    EncryptedBundleService
} from "../crypto/encryptedBundleService";

import type {
    SyncKeyRecoveryFileService
} from "../crypto/syncKeyRecoveryFileService";

import type {
    CursorStorageLocator
} from "../cursor/cursorStorageLocator";

import type {
    ConversationBundleExportService
} from "../export/conversationBundleExportService";

import type {
    OutputLogger
} from "../logging/outputLogger";

import type {
    CurrentProjectInspector
} from "../projects/currentProjectInspector";

interface ResolvedSyncKey {
    material:
    CursorSyncKeyMaterial;

    isNewVault:
    boolean;

    generated?:
    GeneratedCursorSyncKey;
}

export class UploadAllChatsToCloudCommand {
    public constructor(
        private readonly projectInspector:
            CurrentProjectInspector,

        private readonly storageLocator:
            CursorStorageLocator,

        private readonly projectDescriptorService:
            CloudProjectDescriptorService,

        private readonly bundleExportService:
            ConversationBundleExportService,

        private readonly syncKeyService:
            CursorSyncKeyService,

        private readonly encryptedBundleService:
            EncryptedBundleService,

        private readonly cloudApiService:
            CursorCloudSyncApiService,

        private readonly cloudStorageService:
            CursorCloudStorageService,

        private readonly credentialStore:
            CloudVaultCredentialStore,

        private readonly recoveryFileService:
            SyncKeyRecoveryFileService,

        private readonly logger:
            OutputLogger
    ) { }

    public async execute():
        Promise<void> {
        this.logger.show();

        this.logger.info(
            "Uploading all exact project conversations to the encrypted cloud vault..."
        );

        try {
            const project =
                await this.projectInspector
                    .inspect();

            const storage =
                await this.storageLocator
                    .inspect();

            const descriptor =
                await this.projectDescriptorService
                    .inspect(
                        project.projectPath
                    );

            const resolvedKey =
                await this.resolveSyncKey(
                    descriptor.stableProjectId
                );

            if (!resolvedKey) {
                this.logger.info(
                    "Cloud upload was cancelled."
                );

                return;
            }

            const accessToken =
                this.syncKeyService
                    .deriveAccessToken(
                        resolvedKey.material
                    );
            if (
                !resolvedKey.isNewVault
            ) {
                const vaultInfo =
                    await this.cloudApiService
                        .getVaultInfo(
                            resolvedKey
                                .material
                                .vaultId,

                            accessToken
                        );

                if (
                    vaultInfo.project &&
                    vaultInfo.project
                        .stableProjectId !==
                    descriptor.stableProjectId
                ) {
                    throw new Error(
                        [
                            "Project mismatch.",
                            `This Sync Key belongs to "${vaultInfo.project.projectName}".`,
                            `Its project ID is ${vaultInfo.project.stableProjectId}.`,
                            `The current project ID is ${descriptor.stableProjectId}.`,
                            "No chats were uploaded."
                        ].join(" ")
                    );
                }
            }

            if (
                resolvedKey.isNewVault
            ) {
                await this.cloudApiService
                    .createVault(
                        resolvedKey
                            .material
                            .vaultId,

                        this.syncKeyService
                            .hashAccessToken(
                                accessToken
                            )
                    );
            }

            const exportResult =
                await this.bundleExportService
                    .createBundle(
                        storage
                            .globalDatabasePath,

                        project.projectPath
                    );

            const encryptionResult =
                await this.encryptedBundleService
                    .encryptAndVerify(
                        exportResult
                            .bundlePath,

                        resolvedKey.material,

                        exportResult
                            .bundleSha256,

                        exportResult
                            .bundleByteLength
                    );

            const uploadReservation =
                await this.cloudApiService
                    .requestUpload(
                        {
                            vaultId:
                                resolvedKey
                                    .material
                                    .vaultId,

                            accessToken,

                            project: {
                                stableProjectId:
                                    descriptor
                                        .stableProjectId,

                                projectName:
                                    descriptor
                                        .projectName,

                                gitRemote:
                                    descriptor
                                        .gitRemote
                            },

                            bundle: {
                                sha256:
                                    encryptionResult
                                        .encryptedBundleSha256,

                                encryptedSize:
                                    encryptionResult
                                        .encryptedBundleByteLength,

                                conversationCount:
                                    exportResult
                                        .conversationCount
                            }
                        }
                    );

            await this.cloudStorageService
                .uploadToSignedUrl(
                    encryptionResult
                        .encryptedBundlePath,

                    uploadReservation.bucket,

                    uploadReservation
                        .storagePath,

                    uploadReservation
                        .uploadToken
                );

            const finalized =
                await this.cloudApiService
                    .finalizeUpload(
                        resolvedKey
                            .material
                            .vaultId,

                        accessToken,

                        uploadReservation
                            .bundleId
                    );

            await this.credentialStore
                .store(
                    descriptor
                        .stableProjectId,

                    resolvedKey
                        .material
                        .syncKey
                );

            if (
                resolvedKey.isNewVault
            ) {
                await vscode.env.clipboard
                    .writeText(
                        resolvedKey
                            .material
                            .syncKey
                    );
            }

            this.logger.info(
                "========================================"
            );

            this.logger.info(
                "CLOUD CHAT UPLOAD COMPLETE"
            );

            this.logger.info(
                `Vault ID: ${resolvedKey.material.vaultId}`
            );

            this.logger.info(
                `Project ID: ${descriptor.stableProjectId}`
            );

            this.logger.info(
                `Bundle version: ${finalized.versionNumber}`
            );

            this.logger.info(
                `Conversations: ${finalized.conversationCount}`
            );

            this.logger.info(
                `Encrypted size: ${this.formatBytes(finalized.encryptedSize)}`
            );

            this.logger.info(
                `Encrypted SHA-256: ${finalized.sha256}`
            );

            this.logger.info(
                "Cursor Sync Key: [NOT LOGGED]"
            );

            if (
                resolvedKey.isNewVault &&
                resolvedKey.generated
            ) {
                await this.showNewVaultActions(
                    resolvedKey.generated,
                    finalized.versionNumber
                );
            } else {
                await vscode.window
                    .showInformationMessage(
                        `All chats uploaded to cloud bundle version ${finalized.versionNumber}.`
                    );
            }
        } catch (error) {
            this.logger.error(
                "Cloud chat upload failed.",
                error
            );

            await vscode.window
                .showErrorMessage(
                    this.getErrorMessage(
                        error
                    )
                );
        }
    }

    private async resolveSyncKey(
        stableProjectId: string
    ): Promise<
        ResolvedSyncKey |
        undefined
    > {
        const savedSyncKey =
            await this.credentialStore
                .get(
                    stableProjectId
                );

        const options =
            savedSyncKey
                ? [
                    "Use Saved Sync Vault",
                    "Paste Another Sync Key",
                    "Create New Sync Vault"
                ]
                : [
                    "Create New Sync Vault",
                    "Paste Existing Sync Key"
                ];

        const selected =
            await vscode.window
                .showQuickPick(
                    options,
                    {
                        title:
                            "Upload All Cursor Chats",

                        placeHolder:
                            "Choose the cloud vault for this project.",

                        ignoreFocusOut:
                            true
                    }
                );

        if (!selected) {
            return undefined;
        }

        if (
            selected ===
            "Use Saved Sync Vault"
        ) {
            if (!savedSyncKey) {
                throw new Error(
                    "No saved Cursor Sync Key is available."
                );
            }

            return {
                material:
                    this.syncKeyService
                        .parse(
                            savedSyncKey
                        ),

                isNewVault:
                    false
            };
        }

        if (
            selected ===
            "Paste Another Sync Key" ||
            selected ===
            "Paste Existing Sync Key"
        ) {
            const enteredKey =
                await vscode.window
                    .showInputBox(
                        {
                            title:
                                "Enter Cursor Sync Key",

                            prompt:
                                "Paste the complete CTS1 key for the existing cloud vault.",

                            placeHolder:
                                "CTS1.<vault-id>.<secret>.<checksum>",

                            password:
                                true,

                            ignoreFocusOut:
                                true
                        }
                    );

            if (!enteredKey) {
                return undefined;
            }

            return {
                material:
                    this.syncKeyService
                        .parse(
                            enteredKey
                        ),

                isNewVault:
                    false
            };
        }

        const generated =
            this.syncKeyService
                .generate();

        return {
            material:
                generated,

            generated,

            isNewVault:
                true
        };
    }

    private async showNewVaultActions(
        syncKey:
            GeneratedCursorSyncKey,

        versionNumber:
            number
    ): Promise<void> {
        const action =
            await vscode.window
                .showWarningMessage(
                    [
                        `Cloud bundle version ${versionNumber} uploaded.`,
                        "The new Cursor Sync Key was copied to your clipboard.",
                        "Store it safely because the cloud cannot recover it."
                    ].join(" "),
                    {
                        modal:
                            true
                    },
                    "Save Recovery Key",
                    "Copy Key Again"
                );

        if (
            action ===
            "Copy Key Again"
        ) {
            await vscode.env.clipboard
                .writeText(
                    syncKey.syncKey
                );

            return;
        }

        if (
            action !==
            "Save Recovery Key"
        ) {
            return;
        }

        const destination =
            await vscode.window
                .showSaveDialog(
                    {
                        title:
                            "Save Cursor Sync Recovery Key",

                        defaultUri:
                            vscode.Uri.file(
                                `${syncKey.vaultId}.cursor-sync-key.txt`
                            ),

                        filters: {
                            "Cursor Sync Key": [
                                "txt"
                            ]
                        },

                        saveLabel:
                            "Save Recovery Key"
                    }
                );

        if (!destination) {
            return;
        }

        await this.recoveryFileService
            .save(
                destination.fsPath,
                syncKey
            );
    }

    private formatBytes(
        bytes: number
    ): string {
        if (
            bytes < 1024
        ) {
            return `${bytes} B`;
        }

        const kilobytes =
            bytes / 1024;

        if (
            kilobytes < 1024
        ) {
            return `${kilobytes.toFixed(2)} KB`;
        }

        return `${(
            kilobytes / 1024
        ).toFixed(2)} MB`;
    }

    private getErrorMessage(
        error: unknown
    ): string {
        return error instanceof Error
            ? error.message
            : "Cloud chat upload failed. Check the Output panel.";
    }
}