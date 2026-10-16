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
