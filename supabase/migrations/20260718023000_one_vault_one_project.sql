begin;

do $$
declare
    duplicate_vault_id uuid;
begin
    select
        project.vault_id
    into duplicate_vault_id
    from public.cursor_sync_projects
        as project
    group by
        project.vault_id
    having
        count(*) > 1
    limit 1;

    if duplicate_vault_id is not null then
        raise exception
            'Vault % currently contains multiple projects. Resolve this before enabling one-project-per-vault.',
            duplicate_vault_id;
    end if;
end;
$$;

do $$
begin
    if not exists (
        select
            1
        from pg_constraint
        where conname =
            'cursor_sync_projects_one_project_per_vault'
          and conrelid =
            'public.cursor_sync_projects'::regclass
    ) then
        alter table public.cursor_sync_projects
            add constraint cursor_sync_projects_one_project_per_vault
            unique (
                vault_id
            );
    end if;
end;
$$;

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

    v_existing_stable_project_id
        text;

    v_normalized_project_id
        text;

    v_next_version
        bigint;
begin
    v_normalized_project_id =
        lower(
            trim(
                p_stable_project_id
            )
        );

    if
        v_normalized_project_id is null
        or v_normalized_project_id
            !~ '^[0-9a-f]{64}$'
    then
        raise exception
            'INVALID_STABLE_PROJECT_ID';
    end if;

    if
        p_project_name is null
        or length(
            trim(
                p_project_name
            )
        ) = 0
    then
        raise exception
            'PROJECT_NAME_REQUIRED';
    end if;

    if
        p_bundle_sha256 is null
        or lower(
            p_bundle_sha256
        ) !~ '^[0-9a-f]{64}$'
    then
        raise exception
            'INVALID_BUNDLE_SHA256';
    end if;

    if
        p_encrypted_size <= 0
    then
        raise exception
            'INVALID_ENCRYPTED_SIZE';
    end if;

    if
        p_conversation_count < 0
    then
        raise exception
            'INVALID_CONVERSATION_COUNT';
    end if;

    /*
     * Serializes the first project binding for this vault.
     * Two devices cannot bind the same vault to different
     * projects concurrently.
     */

    perform pg_advisory_xact_lock(
        hashtextextended(
            p_vault_id::text,
            0
        )
    );

    select
        project.id,
        project.stable_project_id
    into
        v_project_id,
        v_existing_stable_project_id
    from public.cursor_sync_projects
        as project
    where project.vault_id =
        p_vault_id
    limit 1;

    if v_project_id is null then
        insert into public.cursor_sync_projects (
            vault_id,
            stable_project_id,
            project_name,
            git_remote
        )
        values (
            p_vault_id,
            v_normalized_project_id,
            trim(
                p_project_name
            ),
            nullif(
                trim(
                    p_git_remote
                ),
                ''
            )
        )
        returning id
        into v_project_id;
    else
        if
            v_existing_stable_project_id
            <>
            v_normalized_project_id
        then
            raise exception
                'VAULT_PROJECT_MISMATCH';
        end if;

        update public.cursor_sync_projects
        set
            project_name =
                trim(
                    p_project_name
                ),

            git_remote =
                nullif(
                    trim(
                        p_git_remote
                    ),
                    ''
                ),

            updated_at =
                now()
        where id =
            v_project_id;
    end if;

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
    where bundle.project_id =
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

commit;