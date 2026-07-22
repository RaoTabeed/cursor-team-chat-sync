import {
    createClient
  } from "@supabase/supabase-js";
  
  const STORAGE_BUCKET =
    "cursor-chat-bundles";
  
  const SIGNED_DOWNLOAD_SECONDS =
    10 * 60;
  
  const MAX_ENCRYPTED_SIZE =
    512 * 1024 * 1024;
  
  const corsHeaders:
    Record<string, string> = {
      "Access-Control-Allow-Origin":
        "*",
  
      "Access-Control-Allow-Headers":
        [
          "apikey",
          "content-type",
          "x-client-info"
        ].join(", "),
  
      "Access-Control-Allow-Methods":
        "POST, OPTIONS"
    };
  
  type JsonObject =
    Record<string, unknown>;
  
  interface ReservedBundleRow {
    project_id: string;
    bundle_id: string;
    version_number: number;
    storage_path: string;
  }
  
  interface VaultProjectRow {
    id: string;
    project_name: string;
    git_remote: string | null;
    stable_project_id: string;
  }
  
  function jsonResponse(
    body: unknown,
    status = 200
  ): Response {
    return new Response(
      JSON.stringify(body),
      {
        status,
  
        headers: {
          ...corsHeaders,
  
          "Content-Type":
            "application/json; charset=utf-8",
  
          "Cache-Control":
            "no-store"
        }
      }
    );
  }
  
  function errorResponse(
    error: unknown,
    status = 500
  ): Response {
    return jsonResponse(
      {
        ok: false,
  
        error:
          error instanceof Error
            ? error.message
            : "Unexpected server error."
      },
      status
    );
  }
  
  function requireObject(
    value: unknown,
    name: string
  ): JsonObject {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value)
    ) {
      throw new Error(
        `${name} must be an object.`
      );
    }
  
    return value as JsonObject;
  }
  
  function requireString(
    value: unknown,
    name: string,
    maximumLength = 2048
  ): string {
    if (
      typeof value !== "string"
    ) {
      throw new Error(
        `${name} must be a string.`
      );
    }
  
    const normalized =
      value.trim();
  
    if (!normalized) {
      throw new Error(
        `${name} is required.`
      );
    }
  
    if (
      normalized.length >
      maximumLength
    ) {
      throw new Error(
        `${name} is too long.`
      );
    }
  
    return normalized;
  }
  
  function optionalString(
    value: unknown,
    name: string,
    maximumLength = 2048
  ): string | null {
    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      return null;
    }
  
    return requireString(
      value,
      name,
      maximumLength
    );
  }
  
  function requireUuid(
    value: unknown,
    name: string
  ): string {
    const normalized =
      requireString(
        value,
        name,
        64
      ).toLowerCase();
  
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  
    if (
      !uuidPattern.test(
        normalized
      )
    ) {
      throw new Error(
        `${name} must be a UUID.`
      );
    }
  
    return normalized;
  }
  
  function requireSha256(
    value: unknown,
    name: string
  ): string {
    const normalized =
      requireString(
        value,
        name,
        64
      ).toLowerCase();
  
    if (
      !/^[0-9a-f]{64}$/.test(
        normalized
      )
    ) {
      throw new Error(
        `${name} must be SHA-256.`
      );
    }
  
    return normalized;
  }
  
  function requireSafeInteger(
    value: unknown,
    name: string,
    minimum = 0,
    maximum =
      Number.MAX_SAFE_INTEGER
  ): number {
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < minimum ||
      value > maximum
    ) {
      throw new Error(
        `${name} must be an integer between ${minimum} and ${maximum}.`
      );
    }
  
    return value;
  }
  
  function constantTimeEqual(
    left: string,
    right: string
  ): boolean {
    if (
      left.length !== right.length
    ) {
      return false;
    }
  
    let difference = 0;
  
    for (
      let index = 0;
      index < left.length;
      index += 1
    ) {
      difference |=
        left.charCodeAt(index) ^
        right.charCodeAt(index);
    }
  
    return difference === 0;
  }
  
  function bytesToHex(
    value: Uint8Array
  ): string {
    return Array
      .from(value)
      .map(
        byte =>
          byte
            .toString(16)
            .padStart(2, "0")
      )
      .join("");
  }
  
  async function sha256Hex(
    value: string
  ): Promise<string> {
    const bytes =
      new TextEncoder()
        .encode(value);
  
    const digest =
      await crypto.subtle.digest(
        "SHA-256",
        bytes
      );
  
    return bytesToHex(
      new Uint8Array(digest)
    );
  }
  
  function getSecretKey(): string {
    const secretKeysJson =
      Deno.env.get(
        "SUPABASE_SECRET_KEYS"
      );
  
    if (secretKeysJson) {
      try {
        const parsed =
          JSON.parse(
            secretKeysJson
          ) as Record<
            string,
            string
          >;
  
        if (parsed.default) {
          return parsed.default;
        }
  
        const first =
          Object.values(
            parsed
          )[0];
  
        if (first) {
          return first;
        }
      } catch {
        throw new Error(
          "SUPABASE_SECRET_KEYS is invalid."
        );
      }
    }
  
    const serviceRoleKey =
      Deno.env.get(
        "SUPABASE_SERVICE_ROLE_KEY"
      );
  
    if (serviceRoleKey) {
      return serviceRoleKey;
    }
  
    throw new Error(
      "Supabase secret key is unavailable."
    );
  }
  
  function getPublishableKeys():
    string[] {
    const keys:
      string[] = [];
  
    const configuredKeys =
      Deno.env.get(
        "SUPABASE_PUBLISHABLE_KEYS"
      );
  
    if (configuredKeys) {
      try {
        const parsed =
          JSON.parse(
            configuredKeys
          ) as Record<
            string,
            string
          >;
  
        keys.push(
          ...Object.values(
            parsed
          )
        );
      } catch {
        throw new Error(
          "SUPABASE_PUBLISHABLE_KEYS is invalid."
        );
      }
    }
  
    const publishableKey =
      Deno.env.get(
        "SUPABASE_PUBLISHABLE_KEY"
      );
  
    if (publishableKey) {
      keys.push(
        publishableKey
      );
    }
  
    const anonKey =
      Deno.env.get(
        "SUPABASE_ANON_KEY"
      );
  
    if (anonKey) {
      keys.push(
        anonKey
      );
    }
  
    return [
      ...new Set(keys)
    ];
  }
  
  function verifyPublishableKey(
    request: Request
  ): void {
    const suppliedKey =
      request.headers
        .get("apikey")
        ?.trim() ?? "";
  
    if (!suppliedKey) {
      throw new Error(
        "A Supabase publishable API key is required."
      );
    }
  
    const configuredKeys =
      getPublishableKeys();
  
    if (
      configuredKeys.length === 0
    ) {
      throw new Error(
        "No Supabase publishable key is configured."
      );
    }
  
    const isValid =
      configuredKeys.some(
        configuredKey =>
          constantTimeEqual(
            configuredKey,
            suppliedKey
          )
      );
  
    if (!isValid) {
      throw new Error(
        "The supplied Supabase API key is not authorized."
      );
    }
  }
  
  const supabaseUrl =
    Deno.env.get(
      "SUPABASE_URL"
    );
  
  if (!supabaseUrl) {
    throw new Error(
      "SUPABASE_URL is unavailable."
    );
  }
  
  const supabaseAdmin =
    createClient(
      supabaseUrl,
      getSecretKey(),
      {
        auth: {
          autoRefreshToken:
            false,
  
          persistSession:
            false,
  
          detectSessionInUrl:
            false
        }
      }
    );
  
  async function parseRequestBody(
    request: Request
  ): Promise<JsonObject> {
    let parsed:
      unknown;
  
    try {
      parsed =
        await request.json();
    } catch {
      throw new Error(
        "The request body must be valid JSON."
      );
    }
  
    return requireObject(
      parsed,
      "request body"
    );
  }
  
  async function verifyVaultAccess(
    vaultId: string,
    accessToken: string
  ): Promise<void> {
    const {
      data,
      error
    } = await supabaseAdmin
      .from(
        "cursor_sync_vaults"
      )
      .select(
        "access_token_hash"
      )
      .eq(
        "id",
        vaultId
      )
      .maybeSingle();
  
    if (error) {
      throw new Error(
        `Vault lookup failed: ${error.message}`
      );
    }
  
    if (!data) {
      throw new Error(
        "The requested sync vault does not exist."
      );
    }
  
    const suppliedHash =
      await sha256Hex(
        accessToken
      );
  
    if (
      !constantTimeEqual(
        suppliedHash,
        data.access_token_hash
      )
    ) {
      throw new Error(
        "The Cursor Sync Key is not authorized for this vault."
      );
    }
  }
  
  async function getVaultProject(
    vaultId: string
  ): Promise<
    VaultProjectRow | null
  > {
    const {
      data,
      error
    } = await supabaseAdmin
      .from(
        "cursor_sync_projects"
      )
      .select(
        [
          "id",
          "project_name",
          "git_remote",
          "stable_project_id"
        ].join(", ")
      )
      .eq(
        "vault_id",
        vaultId
      )
      .maybeSingle();
  
    if (error) {
      throw new Error(
        `Vault project lookup failed: ${error.message}`
      );
    }
  
    return data as
      VaultProjectRow | null;
  }
  
  async function getProjectForVault(
    vaultId: string,
    stableProjectId: string
  ): Promise<
    VaultProjectRow | null
  > {
    const {
      data,
      error
    } = await supabaseAdmin
      .from(
        "cursor_sync_projects"
      )
      .select(
        [
          "id",
          "project_name",
          "git_remote",
          "stable_project_id"
        ].join(", ")
      )
      .eq(
        "vault_id",
        vaultId
      )
      .eq(
        "stable_project_id",
        stableProjectId
      )
      .maybeSingle();
  
    if (error) {
      throw new Error(
        `Cloud project lookup failed: ${error.message}`
      );
    }
  
    return data as
      VaultProjectRow | null;
  }
  
  function storagePathFor(
    vaultId: string,
    stableProjectId: string,
    bundleId: string
  ): string {
    return [
      "vaults",
      vaultId,
      "projects",
      stableProjectId,
      "bundles",
      `${bundleId}.cursor-chat-bundle.enc`
    ].join("/");
  }
  
  async function createVault(
    body: JsonObject
  ): Promise<Response> {
    const vaultId =
      requireUuid(
        body.vaultId,
        "vaultId"
      );
  
    const accessTokenHash =
      requireSha256(
        body.accessTokenHash,
        "accessTokenHash"
      );
  
    const {
      data: existingVault,
      error: lookupError
    } = await supabaseAdmin
      .from(
        "cursor_sync_vaults"
      )
      .select(
        "id, access_token_hash"
      )
      .eq(
        "id",
        vaultId
      )
      .maybeSingle();
  
    if (lookupError) {
      throw new Error(
        `Vault lookup failed: ${lookupError.message}`
      );
    }
  
    if (existingVault) {
      if (
        !constantTimeEqual(
          existingVault
            .access_token_hash,
          accessTokenHash
        )
      ) {
        return errorResponse(
          new Error(
            "A different vault already uses this vault ID."
          ),
          409
        );
      }
  
      return jsonResponse(
        {
          ok: true,
          vaultId,
          created: false
        }
      );
    }
  
    const {
      error: insertError
    } = await supabaseAdmin
      .from(
        "cursor_sync_vaults"
      )
      .insert(
        {
          id:
            vaultId,
  
          access_token_hash:
            accessTokenHash
        }
      );
  
    if (insertError) {
      throw new Error(
        `Vault creation failed: ${insertError.message}`
      );
    }
  
    return jsonResponse(
      {
        ok: true,
        vaultId,
        created: true
      }
    );
  }
  
  async function vaultInfo(
    body: JsonObject
  ): Promise<Response> {
    const vaultId =
      requireUuid(
        body.vaultId,
        "vaultId"
      );
  
    const accessToken =
      requireString(
        body.accessToken,
        "accessToken",
        256
      );
  
    await verifyVaultAccess(
      vaultId,
      accessToken
    );
  
    const project =
      await getVaultProject(
        vaultId
      );
  
    return jsonResponse(
      {
        ok: true,
  
        vault: {
          vaultId,
  
          isBound:
            project !== null
        },
  
        project:
          project
            ? {
                id:
                  project.id,
  
                projectName:
                  project.project_name,
  
                gitRemote:
                  project.git_remote,
  
                stableProjectId:
                  project.stable_project_id
              }
            : null
      }
    );
  }
  
  async function requestUpload(
    body: JsonObject
  ): Promise<Response> {
    const vaultId =
      requireUuid(
        body.vaultId,
        "vaultId"
      );
  
    const accessToken =
      requireString(
        body.accessToken,
        "accessToken",
        256
      );
  
    await verifyVaultAccess(
      vaultId,
      accessToken
    );
  
    const project =
      requireObject(
        body.project,
        "project"
      );
  
    const bundle =
      requireObject(
        body.bundle,
        "bundle"
      );
  
    const stableProjectId =
      requireSha256(
        project.stableProjectId,
        "project.stableProjectId"
      );
  
    const projectName =
      requireString(
        project.projectName,
        "project.projectName",
        256
      );
  
    const gitRemote =
      optionalString(
        project.gitRemote,
        "project.gitRemote",
        2048
      );
  
    const bundleSha256 =
      requireSha256(
        bundle.sha256,
        "bundle.sha256"
      );
  
    const encryptedSize =
      requireSafeInteger(
        bundle.encryptedSize,
        "bundle.encryptedSize",
        1,
        MAX_ENCRYPTED_SIZE
      );
  
    const conversationCount =
      requireSafeInteger(
        bundle.conversationCount,
        "bundle.conversationCount",
        0,
        1_000_000
      );
  
    const existingProject =
      await getVaultProject(
        vaultId
      );
  
    if (
      existingProject &&
      existingProject
        .stable_project_id !==
          stableProjectId
    ) {
      return errorResponse(
        new Error(
          [
            "Project mismatch.",
            `This Cursor Sync Key belongs to "${existingProject.project_name}".`,
            `Cloud project ID: ${existingProject.stable_project_id}.`,
            `Current project ID: ${stableProjectId}.`,
            "No chats were uploaded."
          ].join(" ")
        ),
        409
      );
    }
  
    const bundleId =
      crypto.randomUUID();
  
    const storagePath =
      storagePathFor(
        vaultId,
        stableProjectId,
        bundleId
      );
  
    const {
      data: reservationRows,
      error: reservationError
    } = await supabaseAdmin.rpc(
      "reserve_cursor_sync_bundle",
      {
        p_bundle_id:
          bundleId,
  
        p_vault_id:
          vaultId,
  
        p_stable_project_id:
          stableProjectId,
  
        p_project_name:
          projectName,
  
        p_git_remote:
          gitRemote,
  
        p_storage_path:
          storagePath,
  
        p_bundle_sha256:
          bundleSha256,
  
        p_encrypted_size:
          encryptedSize,
  
        p_conversation_count:
          conversationCount
      }
    );
  
    if (reservationError) {
      if (
        reservationError.message
          .includes(
            "VAULT_PROJECT_MISMATCH"
          )
      ) {
        return errorResponse(
          new Error(
            "Project mismatch. This vault is already bound to another project."
          ),
          409
        );
      }
  
      throw new Error(
        `Bundle reservation failed: ${reservationError.message}`
      );
    }
  
    const reservation =
      Array.isArray(
        reservationRows
      )
        ? reservationRows[0] as
            ReservedBundleRow |
            undefined
        : undefined;
  
    if (!reservation) {
      throw new Error(
        "Bundle reservation returned no result."
      );
    }
  
    const {
      data: signedUpload,
      error: signedUploadError
    } = await supabaseAdmin
      .storage
      .from(
        STORAGE_BUCKET
      )
      .createSignedUploadUrl(
        storagePath,
        {
          upsert: false
        }
      );
  
    if (signedUploadError) {
      await supabaseAdmin
        .from(
          "cursor_sync_bundle_versions"
        )
        .delete()
        .eq(
          "id",
          bundleId
        );
  
      throw new Error(
        `Signed upload creation failed: ${signedUploadError.message}`
      );
    }
  
    return jsonResponse(
      {
        ok: true,
  
        bucket:
          STORAGE_BUCKET,
  
        bundleId,
  
        projectId:
          reservation.project_id,
  
        versionNumber:
          Number(
            reservation
              .version_number
          ),
  
        storagePath,
  
        uploadToken:
          signedUpload.token
      }
    );
  }
  
  async function findStorageObject(
    storagePath: string
  ): Promise<{
    name: string;
    size: number | null;
  } | null> {
    const separatorIndex =
      storagePath
        .lastIndexOf("/");
  
    const folderPath =
      separatorIndex >= 0
        ? storagePath.slice(
            0,
            separatorIndex
          )
        : "";
  
    const filename =
      separatorIndex >= 0
        ? storagePath.slice(
            separatorIndex + 1
          )
        : storagePath;
  
    const {
      data,
      error
    } = await supabaseAdmin
      .storage
      .from(
        STORAGE_BUCKET
      )
      .list(
        folderPath,
        {
          limit: 100,
          search: filename
        }
      );
  
    if (error) {
      throw new Error(
        `Storage object lookup failed: ${error.message}`
      );
    }
  
    const object =
      data.find(
        item =>
          item.name === filename
      );
  
    if (!object) {
      return null;
    }
  
    const rawSize =
      object.metadata?.size;
  
    const parsedSize =
      typeof rawSize === "number"
        ? rawSize
        : typeof rawSize === "string"
          ? Number(rawSize)
          : null;
  
    return {
      name:
        object.name,
  
      size:
        parsedSize !== null &&
        Number.isSafeInteger(
          parsedSize
        )
          ? parsedSize
          : null
    };
  }
  
  async function finalizeUpload(
    body: JsonObject
  ): Promise<Response> {
    const vaultId =
      requireUuid(
        body.vaultId,
        "vaultId"
      );
  
    const accessToken =
      requireString(
        body.accessToken,
        "accessToken",
        256
      );
  
    const bundleId =
      requireUuid(
        body.bundleId,
        "bundleId"
      );
  
    await verifyVaultAccess(
      vaultId,
      accessToken
    );
  
    const {
      data: bundle,
      error: bundleError
    } = await supabaseAdmin
      .from(
        "cursor_sync_bundle_versions"
      )
      .select(
        [
          "id",
          "project_id",
          "status",
          "storage_path",
          "encrypted_size",
          "bundle_sha256",
          "version_number",
          "conversation_count"
        ].join(", ")
      )
      .eq(
        "id",
        bundleId
      )
      .maybeSingle();
  
    if (bundleError) {
      throw new Error(
        `Bundle lookup failed: ${bundleError.message}`
      );
    }
  
    if (!bundle) {
      return errorResponse(
        new Error(
          "The reserved bundle does not exist."
        ),
        404
      );
    }
  
    const {
      data: project,
      error: projectError
    } = await supabaseAdmin
      .from(
        "cursor_sync_projects"
      )
      .select(
        "vault_id"
      )
      .eq(
        "id",
        bundle.project_id
      )
      .maybeSingle();
  
    if (projectError) {
      throw new Error(
        `Bundle project lookup failed: ${projectError.message}`
      );
    }
  
    if (
      !project ||
      project.vault_id !==
        vaultId
    ) {
      throw new Error(
        "The bundle does not belong to this vault."
      );
    }
  
    if (
      bundle.status ===
      "deleted"
    ) {
      throw new Error(
        "The bundle was already deleted."
      );
    }
  
    const storageObject =
      await findStorageObject(
        bundle.storage_path
      );
  
    if (!storageObject) {
      throw new Error(
        "The encrypted bundle was not found in private storage."
      );
    }
  
    if (
      storageObject.size !== null &&
      storageObject.size !==
        Number(
          bundle.encrypted_size
        )
    ) {
      throw new Error(
        "The uploaded encrypted bundle size does not match its reservation."
      );
    }
  
    if (
      bundle.status !== "ready"
    ) {
      const {
        error: updateError
      } = await supabaseAdmin
        .from(
          "cursor_sync_bundle_versions"
        )
        .update(
          {
            status:
              "ready",
  
            ready_at:
              new Date()
                .toISOString()
          }
        )
        .eq(
          "id",
          bundleId
        );
  
      if (updateError) {
        throw new Error(
          `Bundle finalization failed: ${updateError.message}`
        );
      }
    }
  
    return jsonResponse(
      {
        ok: true,
  
        bundleId,
  
        versionNumber:
          Number(
            bundle.version_number
          ),
  
        storagePath:
          bundle.storage_path,
  
        sha256:
          bundle.bundle_sha256,
  
        encryptedSize:
          Number(
            bundle.encrypted_size
          ),
  
        conversationCount:
          Number(
            bundle.conversation_count
          )
      }
    );
  }
  
  async function latestBundle(
    body: JsonObject
  ): Promise<Response> {
    const vaultId =
      requireUuid(
        body.vaultId,
        "vaultId"
      );
  
    const accessToken =
      requireString(
        body.accessToken,
        "accessToken",
        256
      );
  
    const stableProjectId =
      requireSha256(
        body.stableProjectId,
        "stableProjectId"
      );
  
    await verifyVaultAccess(
      vaultId,
      accessToken
    );
  
    const vaultProject =
      await getVaultProject(
        vaultId
      );
  
    if (!vaultProject) {
      return errorResponse(
        new Error(
          "This Cursor Sync Key does not have an uploaded project yet."
        ),
        404
      );
    }
  
    if (
      vaultProject
        .stable_project_id !==
          stableProjectId
    ) {
      return errorResponse(
        new Error(
          [
            "Project mismatch.",
            `This Cursor Sync Key belongs to "${vaultProject.project_name}".`,
            `Cloud project ID: ${vaultProject.stable_project_id}.`,
            `Current project ID: ${stableProjectId}.`,
            "No cloud bundle was downloaded."
          ].join(" ")
        ),
        409
      );
    }
  
    const project =
      await getProjectForVault(
        vaultId,
        stableProjectId
      );
  
    if (!project) {
      return errorResponse(
        new Error(
          "No cloud project exists for this Sync Key and project ID."
        ),
        404
      );
    }
  
    const {
      data: bundle,
      error: bundleError
    } = await supabaseAdmin
      .from(
        "cursor_sync_bundle_versions"
      )
      .select(
        [
          "id",
          "version_number",
          "storage_path",
          "bundle_sha256",
          "encrypted_size",
          "conversation_count",
          "created_at",
          "ready_at"
        ].join(", ")
      )
      .eq(
        "project_id",
        project.id
      )
      .eq(
        "status",
        "ready"
      )
      .order(
        "version_number",
        {
          ascending: false
        }
      )
      .limit(1)
      .maybeSingle();
  
    if (bundleError) {
      throw new Error(
        `Latest bundle lookup failed: ${bundleError.message}`
      );
    }
  
    if (!bundle) {
      return errorResponse(
        new Error(
          "No ready cloud bundle exists for this project."
        ),
        404
      );
    }
  
    const {
      data: signedDownload,
      error: signedDownloadError
    } = await supabaseAdmin
      .storage
      .from(
        STORAGE_BUCKET
      )
      .createSignedUrl(
        bundle.storage_path,
        SIGNED_DOWNLOAD_SECONDS,
        {
          download: true
        }
      );
  
    if (signedDownloadError) {
      throw new Error(
        `Signed download creation failed: ${signedDownloadError.message}`
      );
    }
  
    return jsonResponse(
      {
        ok: true,
  
        bucket:
          STORAGE_BUCKET,
  
        project: {
          id:
            project.id,
  
          projectName:
            project.project_name,
  
          gitRemote:
            project.git_remote,
  
          stableProjectId:
            project.stable_project_id
        },
  
        bundle: {
          bundleId:
            bundle.id,
  
          versionNumber:
            Number(
              bundle.version_number
            ),
  
          storagePath:
            bundle.storage_path,
  
          downloadUrl:
            signedDownload.signedUrl,
  
          sha256:
            bundle.bundle_sha256,
  
          encryptedSize:
            Number(
              bundle.encrypted_size
            ),
  
          conversationCount:
            Number(
              bundle.conversation_count
            ),
  
          createdAt:
            bundle.created_at,
  
          readyAt:
            bundle.ready_at
        }
      }
    );
  }
  
  async function listBundles(
    body: JsonObject
  ): Promise<Response> {
    const vaultId =
      requireUuid(
        body.vaultId,
        "vaultId"
      );
  
    const accessToken =
      requireString(
        body.accessToken,
        "accessToken",
        256
      );
  
    const stableProjectId =
      requireSha256(
        body.stableProjectId,
        "stableProjectId"
      );
  
    await verifyVaultAccess(
      vaultId,
      accessToken
    );
  
    const vaultProject =
      await getVaultProject(
        vaultId
      );
  
    if (
      vaultProject &&
      vaultProject
        .stable_project_id !==
          stableProjectId
    ) {
      return errorResponse(
        new Error(
          [
            "Project mismatch.",
            `This Cursor Sync Key belongs to "${vaultProject.project_name}".`,
            `Cloud project ID: ${vaultProject.stable_project_id}.`,
            `Current project ID: ${stableProjectId}.`
          ].join(" ")
        ),
        409
      );
    }
  
    const project =
      await getProjectForVault(
        vaultId,
        stableProjectId
      );
  
    if (!project) {
      return jsonResponse(
        {
          ok: true,
          bundles: []
        }
      );
    }
  
    const {
      data,
      error
    } = await supabaseAdmin
      .from(
        "cursor_sync_bundle_versions"
      )
      .select(
        [
          "id",
          "version_number",
          "status",
          "bundle_sha256",
          "encrypted_size",
          "conversation_count",
          "created_at",
          "ready_at",
          "deleted_at"
        ].join(", ")
      )
      .eq(
        "project_id",
        project.id
      )
      .order(
        "version_number",
        {
          ascending: false
        }
      )
      .limit(100);
  
    if (error) {
      throw new Error(
        `Cloud bundle list failed: ${error.message}`
      );
    }
  
    return jsonResponse(
      {
        ok: true,
        bundles:
          data ?? []
      }
    );
  }
  
  async function deleteBundle(
    body: JsonObject
  ): Promise<Response> {
    const vaultId =
      requireUuid(
        body.vaultId,
        "vaultId"
      );
  
    const accessToken =
      requireString(
        body.accessToken,
        "accessToken",
        256
      );
  
    const bundleId =
      requireUuid(
        body.bundleId,
        "bundleId"
      );
  
    await verifyVaultAccess(
      vaultId,
      accessToken
    );
  
    const {
      data: bundle,
      error: bundleError
    } = await supabaseAdmin
      .from(
        "cursor_sync_bundle_versions"
      )
      .select(
        [
          "id",
          "project_id",
          "status",
          "storage_path"
        ].join(", ")
      )
      .eq(
        "id",
        bundleId
      )
      .maybeSingle();
  
    if (bundleError) {
      throw new Error(
        `Bundle lookup failed: ${bundleError.message}`
      );
    }
  
    if (!bundle) {
      return errorResponse(
        new Error(
          "The cloud bundle does not exist."
        ),
        404
      );
    }
  
    const {
      data: project,
      error: projectError
    } = await supabaseAdmin
      .from(
        "cursor_sync_projects"
      )
      .select(
        "vault_id"
      )
      .eq(
        "id",
        bundle.project_id
      )
      .maybeSingle();
  
    if (projectError) {
      throw new Error(
        `Bundle project lookup failed: ${projectError.message}`
      );
    }
  
    if (
      !project ||
      project.vault_id !==
        vaultId
    ) {
      throw new Error(
        "The cloud bundle does not belong to this vault."
      );
    }
  
    if (
      bundle.status !==
      "deleted"
    ) {
      const {
        error: removalError
      } = await supabaseAdmin
        .storage
        .from(
          STORAGE_BUCKET
        )
        .remove(
          [
            bundle.storage_path
          ]
        );
  
      if (removalError) {
        throw new Error(
          `Cloud bundle deletion failed: ${removalError.message}`
        );
      }
  
      const {
        error: updateError
      } = await supabaseAdmin
        .from(
          "cursor_sync_bundle_versions"
        )
        .update(
          {
            status:
              "deleted",
  
            deleted_at:
              new Date()
                .toISOString()
          }
        )
        .eq(
          "id",
          bundleId
        );
  
      if (updateError) {
        throw new Error(
          `Cloud bundle metadata update failed: ${updateError.message}`
        );
      }
    }
  
    return jsonResponse(
      {
        ok: true,
        bundleId,
        deleted: true
      }
    );
  }
  
  function errorStatus(
    error: unknown
  ): number {
    const message =
      error instanceof Error
        ? error.message
        : "";
  
    if (
      message.includes(
        "publishable API key"
      ) ||
      message.includes(
        "not authorized for this vault"
      )
    ) {
      return 401;
    }
  
    if (
      message.includes(
        "does not belong"
      )
    ) {
      return 403;
    }
  
    if (
      message.includes(
        "does not exist"
      ) ||
      message.includes(
        "does not have an uploaded project"
      ) ||
      message.includes(
        "No cloud project"
      ) ||
      message.includes(
        "No ready cloud bundle"
      )
    ) {
      return 404;
    }
  
    if (
      message.includes(
        "Project mismatch"
      ) ||
      message.includes(
        "VAULT_PROJECT_MISMATCH"
      ) ||
      message.includes(
        "already uses"
      )
    ) {
      return 409;
    }
  
    if (
      message.includes(
        "must be"
      ) ||
      message.includes(
        "is required"
      ) ||
      message.includes(
        "is too long"
      ) ||
      message.includes(
        "invalid"
      )
    ) {
      return 400;
    }
  
    return 500;
  }
  
  Deno.serve(
    async request => {
      if (
        request.method ===
        "OPTIONS"
      ) {
        return new Response(
          "ok",
          {
            headers:
              corsHeaders
          }
        );
      }
  
      if (
        request.method !==
        "POST"
      ) {
        return errorResponse(
          new Error(
            "Only POST requests are supported."
          ),
          405
        );
      }
  
      try {
        verifyPublishableKey(
          request
        );
  
        const body =
          await parseRequestBody(
            request
          );
  
        const action =
          requireString(
            body.action,
            "action",
            64
          );
  
        switch (action) {
          case "health":
            return jsonResponse(
              {
                ok: true,
  
                service:
                  "cursor-sync-api",
  
                checkedAt:
                  new Date()
                    .toISOString()
              }
            );
  
          case "createVault":
            return await createVault(
              body
            );
  
          case "vaultInfo":
            return await vaultInfo(
              body
            );
  
          case "requestUpload":
            return await requestUpload(
              body
            );
  
          case "finalizeUpload":
            return await finalizeUpload(
              body
            );
  
          case "latestBundle":
            return await latestBundle(
              body
            );
  
          case "listBundles":
            return await listBundles(
              body
            );
  
          case "deleteBundle":
            return await deleteBundle(
              body
            );
  
          default:
            return errorResponse(
              new Error(
                `Unsupported action: ${action}`
              ),
              400
            );
        }
      } catch (error) {
        console.error(
          "cursor-sync-api error:",
          error
        );
  
        return errorResponse(
          error,
          errorStatus(error)
        );
      }
    }
  );