create extension if not exists pgcrypto;

create table if not exists public.cursor_sync_vaults (
    id uuid primary key,

    access_token_hash text not null,

    created_at timestamptz not null
        default now(),

    updated_at timestamptz not null
        default now(),

    constraint cursor_sync_vault_access_token_hash_format
        check (
            access_token_hash ~ '^[0-9a-f]{64}$'
        )
);

create table if not exists public.cursor_sync_projects (
    id uuid primary key
        default gen_random_uuid(),

    vault_id uuid not null
        references public.cursor_sync_vaults(id)
        on delete cascade,

    stable_project_id text not null,

    project_name text not null,

    git_remote text,

    created_at timestamptz not null
        default now(),

    updated_at timestamptz not null
        default now(),

    constraint cursor_sync_project_vault_stable_unique
        unique (
            vault_id,
            stable_project_id
        ),

    constraint cursor_sync_project_stable_id_format
        check (
            stable_project_id ~ '^[0-9a-f]{64}$'
        )
);

create table if not exists public.cursor_sync_bundle_versions (
    id uuid primary key,

    project_id uuid not null
        references public.cursor_sync_projects(id)
        on delete cascade,

    version_number bigint not null,

    status text not null
        default 'pending',

    storage_path text not null
        unique,

    bundle_sha256 text not null,

    encrypted_size bigint not null,

    conversation_count integer not null,

    created_at timestamptz not null
        default now(),

    ready_at timestamptz,

    deleted_at timestamptz,

    constraint cursor_sync_bundle_status_valid
        check (
            status in (
                'pending',
                'ready',
                'deleted'
            )
        ),

    constraint cursor_sync_bundle_sha256_format
        check (
            bundle_sha256 ~ '^[0-9a-f]{64}$'
        ),

    constraint cursor_sync_bundle_size_valid
        check (
            encrypted_size > 0
        ),

    constraint cursor_sync_bundle_conversation_count_valid
        check (
            conversation_count >= 0
        ),

    constraint cursor_sync_bundle_project_version_unique
        unique (
            project_id,
            version_number
        )
);

create table if not exists public.cursor_sync_devices (
    id uuid primary key
        default gen_random_uuid(),

    vault_id uuid not null
        references public.cursor_sync_vaults(id)
        on delete cascade,

    installation_id text not null,

    device_name text,

    last_seen_at timestamptz not null
        default now(),

    created_at timestamptz not null
        default now(),

    constraint cursor_sync_device_vault_installation_unique
        unique (
            vault_id,
            installation_id
        )
);

create table if not exists public.cursor_sync_conversation_exclusions (
    id uuid primary key
        default gen_random_uuid(),

    project_id uuid not null
        references public.cursor_sync_projects(id)
        on delete cascade,

    composer_id text not null,

    excluded_at timestamptz not null
        default now(),

    constraint cursor_sync_exclusion_project_composer_unique
        unique (
            project_id,
            composer_id
        )
);

create index if not exists cursor_sync_projects_vault_idx
    on public.cursor_sync_projects (
        vault_id
    );

create index if not exists cursor_sync_bundles_project_status_version_idx
    on public.cursor_sync_bundle_versions (
        project_id,
        status,
        version_number desc
    );

create index if not exists cursor_sync_devices_vault_idx
    on public.cursor_sync_devices (
        vault_id
    );

alter table public.cursor_sync_vaults
    enable row level security;

alter table public.cursor_sync_projects
    enable row level security;

alter table public.cursor_sync_bundle_versions
    enable row level security;

alter table public.cursor_sync_devices
    enable row level security;

alter table public.cursor_sync_conversation_exclusions
    enable row level security;

revoke all
    on table public.cursor_sync_vaults
    from anon, authenticated;

revoke all
    on table public.cursor_sync_projects
    from anon, authenticated;

revoke all
    on table public.cursor_sync_bundle_versions
    from anon, authenticated;

revoke all
    on table public.cursor_sync_devices
    from anon, authenticated;

revoke all
    on table public.cursor_sync_conversation_exclusions
    from anon, authenticated;

grant all
    on table public.cursor_sync_vaults
    to service_role;

grant all
    on table public.cursor_sync_projects
    to service_role;

grant all
    on table public.cursor_sync_bundle_versions
    to service_role;

grant all
    on table public.cursor_sync_devices
    to service_role;

grant all
    on table public.cursor_sync_conversation_exclusions
    to service_role;

insert into storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
values (
    'cursor-chat-bundles',
    'cursor-chat-bundles',
    false,
    536870912,
    array[
        'application/octet-stream'
    ]
)
on conflict (id)
do update set
    public =
        excluded.public,

    file_size_limit =
        excluded.file_size_limit,

    allowed_mime_types =
        excluded.allowed_mime_types;

create or replace function public.reserve_cursor_sync_bundle(
    p_bundle_id uuid,
    p_vault_id uuid,
    p_stable_project_id text,
    p_project_name text,
    p_git_remote text,
    p_storage_path text,
    p_bundle_sha256 text,
    p_encrypted_size bigint,
    p_conversation_count integer
)
returns table (
    project_id uuid,
    bundle_id uuid,
    version_number bigint,
    storage_path text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_project_id uuid;
    v_next_version bigint;
begin
    if
        p_stable_project_id is null
        or length(
            trim(
                p_stable_project_id
            )
        ) = 0
    then
        raise exception
            'Stable project ID is required.';
    end if;

    if
        p_stable_project_id
        !~ '^[0-9a-f]{64}$'
    then
        raise exception
            'Stable project ID must be SHA-256.';
    end if;

    perform pg_advisory_xact_lock(
        hashtextextended(
            p_vault_id::text
            || ':'
            || p_stable_project_id,
            0
        )
    );

    insert into public.cursor_sync_projects (
        vault_id,
        stable_project_id,
        project_name,
        git_remote
    )
    values (
        p_vault_id,
        lower(
            p_stable_project_id
        ),
        p_project_name,
        p_git_remote
    )
    on conflict (
        vault_id,
        stable_project_id
    )
    do update set
        project_name =
            excluded.project_name,

        git_remote =
            excluded.git_remote,

        updated_at =
            now()
    returning id
    into v_project_id;

    select
        coalesce(
            max(
                bundle.version_number
            ),
            0
        ) + 1
    into v_next_version
    from public.cursor_sync_bundle_versions
        as bundle
    where
        bundle.project_id =
            v_project_id;

    insert into public.cursor_sync_bundle_versions (
        id,
        project_id,
        version_number,
        status,
        storage_path,
        bundle_sha256,
        encrypted_size,
        conversation_count
    )
    values (
        p_bundle_id,
        v_project_id,
        v_next_version,
        'pending',
        p_storage_path,
        lower(
            p_bundle_sha256
        ),
        p_encrypted_size,
        p_conversation_count
    );

    return query
    select
        v_project_id,
        p_bundle_id,
        v_next_version,
        p_storage_path;
end;
$$;

revoke all
    on function public.reserve_cursor_sync_bundle(
        uuid,
        uuid,
        text,
        text,
        text,
        text,
        text,
        bigint,
        integer
    )
    from public, anon, authenticated;

grant execute
    on function public.reserve_cursor_sync_bundle(
        uuid,
        uuid,
        text,
        text,
        text,
        text,
        text,
        bigint,
        integer
    )
    to service_role;