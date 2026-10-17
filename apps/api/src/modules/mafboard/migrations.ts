import { db as mainDb, sql, type Database } from '@titan/database'
import { databaseName } from './config.js'

// ─────────────────────────────────────────────────────────────────────────────
// Схема БД MafBoard. Это ОТДЕЛЬНАЯ база (MAFBOARD_DATABASE_URL), а не клуб-БД:
// миграции из src/migrations/sql раскатываются на все клубы, а пользователи
// MafBoard — ведущие из любых клубов GoMafia. Поэтому свой список и своя таблица
// учёта `_mafboard_migrations`. Миграции только добавляются; применённые не правим.
// ─────────────────────────────────────────────────────────────────────────────

export const MAFBOARD_MIGRATIONS: readonly { id: string; sql: string }[] = [
  {
    id: '001_mafboard_init',
    sql: `
      CREATE TABLE IF NOT EXISTS mb_users (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tg_id             bigint NOT NULL UNIQUE,
        tg_username       text,
        tg_first_name     text NOT NULL DEFAULT '',
        tg_last_name      text,
        phone             text,
        terms_version     text,
        terms_accepted_at timestamptz,
        gomafia_id        integer UNIQUE,
        gomafia_player    jsonb,
        gomafia_club      jsonb,
        gomafia_linked_at timestamptz,
        gomafia_synced_at timestamptz,
        created_at        timestamptz NOT NULL DEFAULT now(),
        updated_at        timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS mb_login_tickets (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        deep_code          text NOT NULL UNIQUE,
        confirm_code       text NOT NULL,
        device_secret_hash text NOT NULL,
        device_name        text NOT NULL,
        platform           text NOT NULL,
        status             text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'confirmed', 'rejected', 'claimed')),
        step               text NOT NULL DEFAULT 'created'
                           CHECK (step IN ('created', 'terms', 'contact', 'confirm', 'done')),
        tg_id              bigint,
        tg_username        text,
        tg_first_name      text,
        tg_last_name       text,
        phone              text,
        terms_version      text,
        user_id            uuid REFERENCES mb_users(id) ON DELETE CASCADE,
        opened_at          timestamptz,
        note               text,
        created_at         timestamptz NOT NULL DEFAULT now(),
        expires_at         timestamptz NOT NULL,
        claimed_at         timestamptz
      );
      CREATE INDEX IF NOT EXISTS mb_login_tickets_tg_open_idx
        ON mb_login_tickets (tg_id, created_at DESC) WHERE status = 'pending';
      CREATE INDEX IF NOT EXISTS mb_login_tickets_expires_idx ON mb_login_tickets (expires_at);

      CREATE TABLE IF NOT EXISTS mb_refresh_tokens (
        token_hash  text PRIMARY KEY,
        user_id     uuid NOT NULL REFERENCES mb_users(id) ON DELETE CASCADE,
        device_name text,
        platform    text,
        created_at  timestamptz NOT NULL DEFAULT now(),
        expires_at  timestamptz NOT NULL,
        revoked_at  timestamptz,
        replaced_by text
      );
      CREATE INDEX IF NOT EXISTS mb_refresh_tokens_user_idx ON mb_refresh_tokens (user_id) WHERE revoked_at IS NULL;

      CREATE TABLE IF NOT EXISTS mb_games (
        id             uuid PRIMARY KEY,
        host_user_id   uuid NOT NULL REFERENCES mb_users(id),
        club_id        integer,
        format         text NOT NULL,
        variant        text NOT NULL,
        started_at     timestamptz NOT NULL,
        finished_at    timestamptz NOT NULL,
        schema_version integer NOT NULL,
        record         jsonb NOT NULL,
        received_at    timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS mb_games_host_idx ON mb_games (host_user_id, finished_at);
      CREATE INDEX IF NOT EXISTS mb_games_club_idx ON mb_games (club_id, finished_at) WHERE club_id IS NOT NULL;
    `,
  },
  {
    // Сессии устройств для блока «Сессии» в профиле. Refresh-токены одной сессии —
    // цепочка ротаций (replaced_by), устройство записано только у первого токена.
    // Существующую цепочку превращаем в сессию с id = md5(хэш первого токена).
    id: '002_mafboard_sessions',
    sql: `
      CREATE TABLE IF NOT EXISTS mb_sessions (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id      uuid NOT NULL REFERENCES mb_users(id) ON DELETE CASCADE,
        device_name  text,
        platform     text,
        created_at   timestamptz NOT NULL DEFAULT now(),
        last_used_at timestamptz NOT NULL DEFAULT now(),
        expires_at   timestamptz NOT NULL,
        revoked_at   timestamptz
      );
      CREATE INDEX IF NOT EXISTS mb_sessions_user_idx ON mb_sessions (user_id, last_used_at DESC) WHERE revoked_at IS NULL;
      CREATE INDEX IF NOT EXISTS mb_sessions_expires_idx ON mb_sessions (expires_at);

      ALTER TABLE mb_refresh_tokens ADD COLUMN IF NOT EXISTS session_id uuid;

      WITH RECURSIVE chain AS (
        SELECT r.token_hash, r.token_hash AS root
        FROM mb_refresh_tokens r
        WHERE NOT EXISTS (SELECT 1 FROM mb_refresh_tokens p WHERE p.replaced_by = r.token_hash)
        UNION ALL
        SELECT n.token_hash, chain.root
        FROM chain
        JOIN mb_refresh_tokens cur ON cur.token_hash = chain.token_hash
        JOIN mb_refresh_tokens n ON n.token_hash = cur.replaced_by
      )
      UPDATE mb_refresh_tokens t SET session_id = md5(chain.root)::uuid
      FROM chain WHERE t.token_hash = chain.token_hash AND t.session_id IS NULL;

      INSERT INTO mb_sessions (id, user_id, device_name, platform, created_at, last_used_at, expires_at, revoked_at)
      SELECT root.session_id, root.user_id, root.device_name, root.platform, root.created_at,
             family.last_used_at, family.expires_at, family.revoked_at
      FROM mb_refresh_tokens root
      JOIN (
        SELECT session_id,
               max(created_at) AS last_used_at,
               max(expires_at) AS expires_at,
               CASE WHEN bool_or(revoked_at IS NULL) THEN NULL ELSE max(revoked_at) END AS revoked_at
        FROM mb_refresh_tokens GROUP BY session_id
      ) family ON family.session_id = root.session_id
      WHERE root.session_id = md5(root.token_hash)::uuid
      ON CONFLICT (id) DO NOTHING;

      ALTER TABLE mb_refresh_tokens ALTER COLUMN session_id SET NOT NULL;
      ALTER TABLE mb_refresh_tokens
        ADD CONSTRAINT mb_refresh_tokens_session_fk FOREIGN KEY (session_id) REFERENCES mb_sessions(id) ON DELETE CASCADE;
      CREATE INDEX IF NOT EXISTS mb_refresh_tokens_session_idx ON mb_refresh_tokens (session_id) WHERE revoked_at IS NULL;
    `,
  },
  {
    // Идущие игры: последний снимок журнала с телефона ведущего. Снимок со старшей ревизией
    // не перезаписывается младшей; после загрузки законченной игры снимок удаляется.
    id: '003_mafboard_active_games',
    sql: `
      CREATE TABLE IF NOT EXISTS mb_active_games (
        id           uuid PRIMARY KEY,
        host_user_id uuid NOT NULL REFERENCES mb_users(id) ON DELETE CASCADE,
        revision     integer NOT NULL,
        updated_at   timestamptz NOT NULL,
        snapshot     jsonb NOT NULL
      );
      CREATE INDEX IF NOT EXISTS mb_active_games_host_idx ON mb_active_games (host_user_id, updated_at DESC);
    `,
  },
]

function rows<T = Record<string, unknown>>(res: unknown): T[] {
  return (Array.isArray(res) ? res : ((res as { rows?: T[] }).rows ?? [])) as T[]
}

/**
 * Создать БД MafBoard, если её ещё нет (код Postgres 3D000 — «БД не существует»).
 * Создаём через основную БД тем же пользователем — как провижининг клуб-БД.
 */
export async function ensureMafboardDatabase(url: string, target: Database): Promise<void> {
  try {
    await target.execute(sql`SELECT 1`)
    return
  } catch (error) {
    if ((error as { code?: string }).code !== '3D000') throw error
  }
  const name = databaseName(url)
  console.log(`[mafboard] создаю БД «${name}»…`)
  await mainDb.execute(sql.raw(`CREATE DATABASE "${name}"`))
}

/** Применить новые миграции MafBoard, каждую — в своей транзакции. */
export async function runMafboardMigrations(target: Database): Promise<void> {
  await target.execute(sql`
    CREATE TABLE IF NOT EXISTS _mafboard_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  const applied = new Set(rows<{ id: string }>(await target.execute(sql`SELECT id FROM _mafboard_migrations`)).map((r) => r.id))

  for (const migration of MAFBOARD_MIGRATIONS) {
    if (applied.has(migration.id)) continue
    console.log(`[mafboard] применяю миграцию ${migration.id}…`)
    await target.transaction(async (tx) => {
      await tx.execute(sql.raw(migration.sql))
      await tx.execute(sql`INSERT INTO _mafboard_migrations (id) VALUES (${migration.id})`)
    })
  }
}
