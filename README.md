# Cursor Team Chat Sync

Synchronize project-specific Cursor Agent conversations across Windows devices and make imported chats appear in Cursor’s native Agent history.

The project is **source-first and self-hosted**:

- The GitHub repository contains the complete extension source.
- Every user or team connects the extension to **their own Supabase project**.
- The author’s database, keys, Sync Keys, and Cursor databases are not included.
- A prebuilt VSIX may be published for convenience, but it is not connected to any database by default.

> **Current tested version:** `0.0.16`  
> **Platform tested:** Windows  
> **Release status:** Public beta

---

## What this project solves

Cursor stores Agent conversations locally. When the same Git project is opened on another computer, its old Agent chats normally do not appear there.

Cursor Team Chat Sync provides a controlled workflow:

```text
Device A
  ↓
Detect current Git project
  ↓
Find exact Cursor conversations for that project
  ↓
Create and encrypt a conversation bundle locally
  ↓
Upload encrypted bundle to the team’s Supabase backend
  ↓
Device B downloads and decrypts the bundle locally
  ↓
Back up both Cursor databases
  ↓
Import missing conversations
  ↓
Update Cursor’s native Agent-history sidebar
```

---

## Main features

- Detects the current project from its Git `origin`
- Creates a stable project ID that matches across devices
- Finds exact Cursor conversations associated with the project
- Encrypts bundles locally before upload
- Stores encrypted bundle versions in a self-hosted Supabase backend
- Uses one private Sync Key per project vault
- Imports chats into Cursor’s native Agent history
- Detects new, identical, and conflicting conversations
- Avoids duplicate imports
- Creates verified backups of both Cursor SQLite databases
- Restores both databases if a committed import later fails
- Preserves safe Cursor-generated UI metadata changes
- Supports repeated imports and sidebar repair

---

## Important: every user connects their own Supabase backend

This repository does **not** provide a shared public database.

Each user, organization, or team must:

1. Create a Supabase project
2. Apply the included migrations
3. Deploy the included `cursor-sync-api` Edge Function
4. Enter their own Supabase URL and publishable key in Cursor Settings
5. Build the extension from source or install a generic prebuilt VSIX

The installed extension reads:

```text
cursorTeamChatSync.supabaseUrl
cursorTeamChatSync.supabasePublishableKey
```

The extension does **not** read its database connection from a project `.env` file.

A `.env` file may be used for local Supabase development, but real `.env` files must never be committed.

---

## How project detection and matching work

The extension reads:

```powershell
git remote get-url origin
```

It normalizes common HTTPS and SSH formats.

These two remotes become the same identity:

```text
https://github.com/example/acme-app.git
git@github.com:example/acme-app.git
```

Canonical identity:

```text
github.com/example/acme-app
```

The extension then calculates:

```text
SHA-256(canonical Git remote) = stable project ID
```

This allows different local paths to match:

```text
C:\Users\Alice\Projects\acme-app
C:\Users\Bob\Desktop\acme-app
```

Both devices must use the same Git repository and the same `origin` remote.

### Projects without a Git remote

Cloud synchronization requires a valid Git `origin` so the project can be matched safely across devices.

Check it with:

```powershell
git remote -v
```

---

## Vaults

A **vault** is the private cloud container used for one synchronized project.

```text
1 project = 1 vault
```

A vault contains:

- Project metadata
- A stable project ID
- Encrypted bundle-version metadata
- Encrypted bundle files
- A hash used to verify access

One Supabase backend can contain many project vaults, but every project has its own Sync Key.

---

## Sync Keys

A Sync Key has this format:

```text
CTS1.<vault-id>.<secret>.<checksum>
```

Its parts are:

- `vault-id` — locates the correct vault
- `secret` — derives encryption and access credentials locally
- `checksum` — detects an incorrectly copied key

### Is a new key generated for every upload?

No.

The first upload to a new vault creates one key:

```text
Project → Vault → Sync Key
```

Later uploads normally reuse the same saved key:

```text
Bundle version 1 → 3 chats
Bundle version 2 → 4 chats
Bundle version 3 → 7 chats
```

A new Sync Key is generated only when the user deliberately chooses:

```text
Create New Sync Vault
```

### Sync Key security

Treat the Sync Key like a password.

Anyone who has the complete key may be able to access and decrypt that project’s cloud bundles.

The complete key must never be:

- committed to Git
- added to `.env.example`
- posted in an issue
- included in screenshots
- shared publicly

Saved keys use Cursor/VS Code SecretStorage.

---

## Encryption and cloud storage

Before upload:

1. The extension builds an exact conversation bundle
2. The bundle is encrypted locally
3. The encrypted result is verified
4. Only the encrypted bundle is uploaded

The backend stores:

```text
Vault metadata
Project metadata
Bundle version metadata
Encrypted bundle file
```

The backend does not need the plaintext bundle.

The extension uses the Supabase publishable key as a client credential. Administrative database access remains inside the Edge Function.

Never place a Supabase secret key or service-role key in Cursor Settings.

---

# Installation from source

This is the primary installation method for developers and self-hosted users.

## Requirements

Install:

- Windows 10 or Windows 11
- Cursor
- Git
- Python 3
- Node.js 20 or newer
- npm
- A Supabase account

Confirm the tools:

```powershell
git --version
node --version
npm --version
py -3 --version
```

---

## 1. Clone the repository

```powershell
git clone `
  "https://github.com/RaoTabeed/cursor-team-chat-sync.git"

cd ".\cursor-team-chat-sync"
```

---

## 2. Install Node dependencies

```powershell
npm ci
```

---

# Supabase backend setup

## 3. Create a Supabase project

Create a new project in Supabase.

Record:

```text
Project reference
Project URL
Publishable key
```

Do not copy the secret key or service-role key into the extension.

---

## 4. Log in to the Supabase CLI

```powershell
npx supabase login
```

---

## 5. Link the local repository to your Supabase project

```powershell
npx supabase link `
  --project-ref "YOUR_PROJECT_REF"
```

Example project URL:

```text
https://YOUR_PROJECT_REF.supabase.co
```

The generated local linkage under `supabase/.temp/` must not be committed.

---

## 6. Apply the database migrations

Preview the migration:

```powershell
npx supabase db push `
  --dry-run
```

Apply it:

```powershell
npx supabase db push
```

The repository contains the required migrations under:

```text
supabase/migrations/
```

They create the vault, project, bundle-version, device, exclusion, index, storage, and security structures required by the extension.

---

## 7. Deploy the Edge Function

```powershell
npx supabase functions deploy `
  cursor-sync-api `
  --no-verify-jwt
```

The project configuration also contains:

```toml
[functions.cursor-sync-api]
verify_jwt = false
```

The function performs its own publishable-key and vault-access checks.

Supabase supplies server-side environment variables to the hosted function. The extension must never receive the service-role key.

---

# Build the extension

## 8. Validate the source

```powershell
npm run check

if ($LASTEXITCODE -ne 0) {
  throw "TypeScript validation failed."
}
```

Validate the Python workers:

```powershell
py -3 -m py_compile `
  ".\scripts\apply_conversation_import.py"

if ($LASTEXITCODE -ne 0) {
  throw "Import worker validation failed."
}

py -3 -m py_compile `
  ".\scripts\validate_conversation_bundle.py"

if ($LASTEXITCODE -ne 0) {
  throw "Bundle validator validation failed."
}
```

---

## 9. Compile the extension

```powershell
npm run compile

if ($LASTEXITCODE -ne 0) {
  throw "Extension compilation failed."
}
```

---

## 10. Package a VSIX locally

```powershell
npx @vscode/vsce package `
  --out ".\cursor-team-chat-sync-0.0.12.vsix"
```

Confirm:

```powershell
Test-Path `
  ".\cursor-team-chat-sync-0.0.12.vsix"
```

Expected:

```text
True
```

---

## 11. Install the VSIX in Cursor

In Cursor:

1. Press `Ctrl+Shift+P`
2. Run:

```text
Extensions: Install from VSIX...
```

3. Select:

```text
cursor-team-chat-sync-0.0.12.vsix
```

4. Reload Cursor

---

# Configure the extension

Open Cursor Settings and configure:

```text
cursorTeamChatSync.supabaseUrl
cursorTeamChatSync.supabasePublishableKey
```

You can also add them to your Cursor user `settings.json`:

```json
{
  "cursorTeamChatSync.supabaseUrl": "https://YOUR_PROJECT_REF.supabase.co",
  "cursorTeamChatSync.supabasePublishableKey": "YOUR_SUPABASE_PUBLISHABLE_KEY"
}
```

Use only the publishable client key.

Do not use:

```text
Supabase secret key
Supabase service-role key
Database password
CTS1 Sync Key
```

inside `settings.json`.

---

# Optional prebuilt VSIX

A GitHub Release may include a prebuilt generic VSIX.

The prebuilt extension is still not connected to the author’s backend. After installation, every user must enter their own Supabase URL and publishable key in Cursor Settings.

The source code remains available so users can inspect, modify, compile, and package the extension themselves.

Recommended release model:

```text
GitHub repository
  → complete source code
  → Supabase migrations
  → Edge Function
  → Python workers
  → setup documentation

GitHub Release
  → optional generic prebuilt VSIX
```

---

# Upload chats from Device A

## 1. Prepare the project

Open a local clone of the Git project in Cursor.

Confirm its remote:

```powershell
git remote -v
```

Create the Agent conversations you want to synchronize.

---

## 2. Inspect project matching

Press `Ctrl+Shift+P` and run:

```text
Cursor Team Chat Sync: Inspect Current Project
```

Confirm:

```text
Git repository detected
Origin remote detected
Canonical remote created
Stable project ID created
Cursor workspace database matched
```

---

## 3. Upload all project chats

Run:

```text
Cursor Team Chat Sync: Upload All Chats to Cloud
```

For the first upload choose:

```text
Create New Sync Vault
```

The extension will:

1. Detect the project
2. Generate a vault
3. Generate a CTS1 Sync Key
4. Find project conversations
5. Build the exact bundle
6. Encrypt it locally
7. Upload the encrypted bundle
8. Save the key in SecretStorage
9. Copy the new key to the clipboard

Store the key safely.

For later uploads choose:

```text
Use Saved Sync Vault
```

Each later upload creates a new bundle version using the same project vault and key.

---

# Import chats on Device B

## 1. Clone the same project

```powershell
git clone `
  "THE_SAME_GIT_REMOTE"

cd ".\PROJECT_FOLDER"
```

Open the project in Cursor.

---

## 2. Initialize Cursor’s workspace database

For a completely new clone:

1. Create one temporary Agent chat
2. Wait for Cursor’s response
3. Close Cursor normally
4. Reopen the same project

This allows Cursor to create a valid workspace database.

---

## 3. Inspect the destination project

Run:

```text
Cursor Team Chat Sync: Inspect Current Project
```

The stable project ID should match Device A.

---

## 4. Import from cloud

Run:

```text
Cursor Team Chat Sync: Import Chats from Cloud
```

Choose:

```text
Paste Another Sync Key
```

or:

```text
Use Saved Sync Key
```

Paste the complete CTS1 key when requested.

The extension downloads the latest encrypted bundle, decrypts it locally, and validates each conversation.

Possible classifications:

```text
Missing locally           → new
Already present safely    → identical
Real record difference    → conflict
```

When there are no conflicts, choose:

```text
Import and Close Cursor
```

Cursor closes while the detached worker performs the database import.

Wait several seconds and reopen the same project.

The imported conversations should appear in native Agent history.

---

# How conversations are saved locally

Cursor uses two SQLite databases.

## Global database

```text
%APPDATA%\Cursor\User\globalStorage\state.vscdb
```

It contains:

- conversation records
- message records
- composer data
- global composer headers

## Workspace database

```text
%APPDATA%\Cursor\User\workspaceStorage\<workspace-id>\state.vscdb
```

It contains project-specific sidebar metadata, including:

```text
ItemTable
  key: composer.composerData
  field: allComposers
```

Updating both databases is required for imported chats to appear in Cursor’s native history.

---

# Import safety

Before modifying either database, the worker:

1. Waits for Cursor’s extension-host process to exit
2. Waits until both databases are writable
3. Runs SQLite integrity checks
4. Creates logical SQLite backups
5. Verifies the backups
6. Imports new records transactionally
7. Updates global headers
8. Updates workspace `allComposers`
9. Verifies sidebar visibility
10. Restores both backups if a committed import later fails

Do not manually delete Cursor databases to bypass an import problem.

---

# Repeated imports

Importing the same bundle again should report:

```text
New conversations: 0
Identical conversations: <existing count>
Conflicts: 0
```

The command may show:

```text
Repair Sidebar and Close Cursor
```

This verifies and repairs native sidebar metadata without creating duplicate conversations.

---

# New upload behavior

Example:

```text
Initial upload
  → 3 chats
  → bundle version 1

Create one new chat on Device A

Upload again with the saved vault
  → 4 chats
  → bundle version 2

Import on Device B
  → 1 new
  → 3 identical
  → 0 conflicts
```

A new Sync Key is not generated for bundle version 2.

---

# Cloud bundle management

Run:

```text
Cursor Team Chat Sync: Manage Cloud Bundle Versions
```

This allows an authorized user to inspect and delete old encrypted cloud bundle versions.

Deleting a cloud bundle does not delete chats already imported into Cursor.

---

# Available commands

## Main workflow

```text
Cursor Team Chat Sync: Upload All Chats to Cloud
Cursor Team Chat Sync: Import Chats from Cloud
Cursor Team Chat Sync: Manage Cloud Bundle Versions
Cursor Team Chat Sync: Copy Saved Sync Key
```

## Project and database inspection

```text
Cursor Team Chat Sync: Inspect Local Cursor Storage
Cursor Team Chat Sync: Inspect Current Project
Cursor Team Chat Sync: Inspect Current Project Databases
Cursor Team Chat Sync: Index Project Conversations
Cursor Team Chat Sync: Trace Project Conversation Storage
```

## Local bundle tools

```text
Cursor Team Chat Sync: Build Conversation Bundle Manifest
Cursor Team Chat Sync: Export Exact Conversation Bundle
Cursor Team Chat Sync: Export Encrypted Conversation Bundle
Cursor Team Chat Sync: Validate Encrypted Bundle for Import
Cursor Team Chat Sync: Import Encrypted Conversation Bundle
```

---

# Repository structure

```text
cursor-team-chat-sync/
├── src/
│   ├── cloud/          Supabase client and cloud services
│   ├── commands/       Cursor command implementations
│   ├── conversations/  Conversation indexing and tracing
│   ├── crypto/         Sync Key and bundle encryption
│   ├── cursor/         Cursor storage discovery
│   ├── database/       SQLite inspection
│   ├── export/         Exact bundle generation
│   ├── git/            Git inspection and normalization
│   ├── import/         Import validation and job scheduling
│   ├── logging/        Output-channel logging
│   ├── projects/       Stable project identity
│   └── runtime/        Python process execution
├── scripts/
│   ├── apply_conversation_import.py
│   ├── build_conversation_bundle_manifest.py
│   ├── export_conversation_bundle.py
│   ├── index_project_conversations.py
│   ├── inspect_cursor_database.py
│   ├── trace_project_conversation_storage.py
│   └── validate_conversation_bundle.py
├── supabase/
│   ├── functions/
│   │   └── cursor-sync-api/
│   ├── migrations/
│   └── config.toml
├── package.json
├── package-lock.json
└── tsconfig.json
```

---

# Files that must not be committed

```text
node_modules/
out/
*.vsix
.env
.env.*
supabase/.temp/
supabase/.branches/
__pycache__/
*.pyc
*.vscdb
*.sqlite
*.db
*.backup
*.before-*
CTS1 keys
Cursor chat bundles
Cursor database backups
```

Safe files to commit include:

```text
src/
scripts/
supabase/functions/
supabase/migrations/
supabase/config.toml
package.json
package-lock.json
tsconfig.json
README.md
.gitignore
.vscodeignore
.env.example
```

---

# Development

Install dependencies:

```powershell
npm ci
```

Type-check:

```powershell
npm run check
```

Compile:

```powershell
npm run compile
```

Watch:

```powershell
npm run watch
```

List files that would enter a VSIX:

```powershell
npx @vscode/vsce ls
```

Package:

```powershell
npx @vscode/vsce package
```

---

# Troubleshooting

## Supabase configuration is missing

Set:

```text
cursorTeamChatSync.supabaseUrl
cursorTeamChatSync.supabasePublishableKey
```

in Cursor Settings.

---

## Project mismatch

On both devices run:

```powershell
git remote get-url origin
```

Then run:

```text
Cursor Team Chat Sync: Inspect Current Project
```

Both devices must produce the same canonical remote and stable project ID.

---

## No valid Cursor workspace was found

1. Open the project
2. Create one temporary Agent chat
3. Wait for the response
4. Close Cursor
5. Reopen the same project
6. Retry the import

---

## Conflicts are reported

The extension stops before importing.

Review the **Cursor Team Chat Sync** Output panel.

A real message or required-record difference is treated as a conflict instead of being overwritten automatically.

---

## Chats imported but are not visible

Run the same cloud import again.

When the conversations are already present, choose:

```text
Repair Sidebar and Close Cursor
```

---

## Cursor closed during import

This is expected.

The databases should not be edited while Cursor’s extension host is using them. Reopen Cursor after the detached worker finishes.

---

# Security checklist

Before publishing or contributing:

```text
[ ] No real CTS1 Sync Key
[ ] No Supabase secret key
[ ] No Supabase service-role key
[ ] No database password
[ ] No Cursor state.vscdb file
[ ] No plaintext chat bundle
[ ] No real .env file
[ ] No supabase/.temp folder
[ ] No old repair/finalize scripts
[ ] No backup source files
[ ] No generated Python bytecode
```

---

# Current limitations

- Windows is the tested platform
- Cursor must close during database import
- The same Git `origin` is required for reliable cross-device matching
- Real two-sided edits of the same conversation are not automatically merged
- Cursor’s internal database schema may change in future releases
- Each team must self-host and maintain its own Supabase backend
- This project is currently a public beta

---

# Publishing the source repository

Before publishing:

```powershell
npm run check
npm run compile

py -3 -m py_compile `
  ".\scripts\apply_conversation_import.py"

py -3 -m py_compile `
  ".\scripts\validate_conversation_bundle.py"
```

Review tracked files:

```powershell
git status
git diff --check
git ls-files
```

Commit:

```powershell
git add .

git commit `
  -m "Release Cursor Team Chat Sync 0.0.12 public beta"
```

Push:

```powershell
git branch -M main

git push `
  -u `
  origin `
  main
```

The complete source code is the main release. A generic prebuilt VSIX may be attached separately to a GitHub Release for convenience.
