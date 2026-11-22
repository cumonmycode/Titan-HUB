import { db as mainDb, sql, type Database } from '@titan/database'
import { databaseName } from './config.js'

// ─────────────────────────────────────────────────────────────────────────────
// Схема БД MafBoard. Это ОТДЕЛЬНАЯ база (MAFBOARD_DATABASE_URL), а не клуб-БД:
// миграции из src/migrations/sql раскатываются на все клубы, а пользователи
// MafBoard — ведущие из любых клубов GoMafia. Поэтому свой список и своя таблица
// учёта `_mafboard_migrations`. Миграции только добавляются; применённые не правим.
// ─────────────────────────────────────────────────────────────────────────────

/** Номер клуба GoMafia из снимка привязки; кривой jsonb даёт NULL, а не ошибку приведения. */
const SNAPSHOT_CLUB_ID = `CASE WHEN gomafia_club->>'id' ~ '^[1-9][0-9]{0,8}$' THEN (gomafia_club->>'id')::integer END`

/**
 * Сверка клубов с тем, что уже лежит в базе. Повторяемая: выполняется при каждом старте после
 * миграций и только дозаполняет пустое:
 *  1. Клуб на каждый клуб GoMafia из привязок, пула судей и игр; название и город — из самого
 *     свежего полного снимка (с президентом), иначе заглушка.
 *  2. Игры клуба получают ссылку на его запись.
 * Подключение Titan сверка не трогает: оно принадлежит клубу и меняется только подключением и
 * отключением (titanRoutes.ts). Подключения из личных записей президентов перенесла первая
 * выкладка клубов (2026-11-22); базе, которая её не проходила, клуб Titan нужно подключить заново.
 */
export const CLUBS_RECONCILE_SQL = `
      WITH snap AS (
        SELECT ${SNAPSHOT_CLUB_ID} AS club_id,
               NULLIF(btrim(gomafia_club->>'title'), '') AS name,
               NULLIF(btrim(gomafia_club->>'city'), '') AS city,
               gomafia_club ? 'presidentID' AS is_full,
               gomafia_synced_at
        FROM mb_users
        WHERE jsonb_typeof(gomafia_club) = 'object'
      ), linked AS (
        SELECT DISTINCT ON (club_id) club_id, name, city
        FROM snap
        WHERE club_id IS NOT NULL
        ORDER BY club_id, is_full DESC, gomafia_synced_at DESC NULLS LAST
      ), ids AS (
        SELECT club_id FROM linked
        UNION SELECT club_id FROM mb_club_hosts
        UNION SELECT club_id FROM mb_games WHERE club_id IS NOT NULL
      )
      INSERT INTO mb_clubs (name, city, gomafia_club_id)
      SELECT COALESCE(linked.name, 'Клуб #' || ids.club_id), linked.city, ids.club_id
      FROM ids LEFT JOIN linked USING (club_id)
      ON CONFLICT (gomafia_club_id) DO NOTHING;

      UPDATE mb_games
      SET club_ref = mb_clubs.id
      FROM mb_clubs
      WHERE mb_games.club_id IS NOT NULL
        AND mb_clubs.gomafia_club_id = mb_games.club_id
        AND mb_games.club_ref IS DISTINCT FROM mb_clubs.id;
`

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
  {
    // Удаление аккаунта из приложения (требование App Store): игры клуба остаются в его истории
    // обезличенными — без ведущего (host_user_id = NULL), личные игры удаляются вместе с аккаунтом.
    id: '004_mafboard_account_deletion',
    sql: `
      ALTER TABLE mb_games ALTER COLUMN host_user_id DROP NOT NULL;
      ALTER TABLE mb_games DROP CONSTRAINT IF EXISTS mb_games_host_user_id_fkey;
      ALTER TABLE mb_games
        ADD CONSTRAINT mb_games_host_user_id_fkey FOREIGN KEY (host_user_id) REFERENCES mb_users(id) ON DELETE SET NULL;
    `,
  },
  {
    // Вход в MBS по QR-коду: билет с экрана ноутбука подтверждает телефон, где ведущий уже вошёл.
    // В отличие от входа через бота, нового пользователя здесь не создаётся.
    id: '005_mafboard_qr_tickets',
    sql: `
      CREATE TABLE IF NOT EXISTS mb_qr_tickets (
        id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        scan_code          text NOT NULL UNIQUE,
        confirm_code       text NOT NULL,
        choice_codes       jsonb NOT NULL,
        device_secret_hash text NOT NULL,
        device_name        text NOT NULL,
        platform           text NOT NULL CHECK (platform IN ('macos', 'windows')),
        status             text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'confirmed', 'rejected', 'claimed')),
        user_id            uuid REFERENCES mb_users(id) ON DELETE CASCADE,
        created_at         timestamptz NOT NULL DEFAULT now(),
        expires_at         timestamptz NOT NULL,
        claimed_at         timestamptz
      );
      CREATE INDEX IF NOT EXISTS mb_qr_tickets_expires_idx ON mb_qr_tickets (expires_at);
    `,
  },
  {
    // Настройки MafBoard Studio: профили ведущего в облаке, чтобы на любом Mac после входа они
    // подтягивались сами. Секреты (ключи потоков) — шифротекстом ключа сервера, см. studio.ts.
    id: '006_mafboard_studio_settings',
    sql: `
      CREATE TABLE IF NOT EXISTS mb_studio_settings (
        user_id    uuid PRIMARY KEY REFERENCES mb_users(id) ON DELETE CASCADE,
        revision   integer NOT NULL,
        updated_at timestamptz NOT NULL,
        document   jsonb NOT NULL,
        secrets    text
      );
    `,
  },
  {
    // Titan Connect: клуб Titan HUB ведущего (ключ — шифротекстом в titan_link) и ручные
    // сопоставления клиентов клуба с GoMafia, общие для всех ведущих этого клуба.
    id: '007_mafboard_titan_connect',
    sql: `
      ALTER TABLE mb_users ADD COLUMN IF NOT EXISTS titan_link jsonb;
      CREATE TABLE IF NOT EXISTS mb_titan_matches (
        api_base   text NOT NULL,
        client_id  text NOT NULL,
        gomafia_id integer,
        set_by     uuid REFERENCES mb_users(id) ON DELETE SET NULL,
        set_at     timestamptz NOT NULL,
        PRIMARY KEY (api_base, client_id)
      );
    `,
  },
  {
    // Вход в АИМ (admin.gomafia.pro) для турниров GoMafia: сервер сам вносит протоколы, поэтому
    // хранит логин и пароль — только шифротекстом ключа сервера (aim.ts). Стираются при
    // отвязке GoMafia и вместе с аккаунтом.
    id: '008_mafboard_aim_credentials',
    sql: `
      CREATE TABLE IF NOT EXISTS mb_aim_credentials (
        user_id    uuid PRIMARY KEY REFERENCES mb_users(id) ON DELETE CASCADE,
        sealed     text NOT NULL,
        updated_at timestamptz NOT NULL
      );
    `,
  },
  {
    // Протоколы судей турниров GoMafia, которые ждут подтверждения ГС: обычный судья не может сам
    // внести стол в АИМ — его протокол вносит ГС от своего имени. Плюс открытые ссылки на итоги игр.
    id: '009_mafboard_protocol_queue_and_shares',
    sql: `
      CREATE TABLE IF NOT EXISTS mb_tournament_protocols (
        id                 uuid PRIMARY KEY,
        tournament_id      integer NOT NULL,
        tournament_title   text NOT NULL,
        game_number        integer NOT NULL,
        table_number       integer NOT NULL,
        referee_user_id    uuid NOT NULL REFERENCES mb_users(id) ON DELETE CASCADE,
        referee_name       text NOT NULL,
        reviewer_gomafia_id integer,
        protocol           jsonb NOT NULL,
        status             text NOT NULL,
        reason             text,
        decided_by         uuid,
        created_at         timestamptz NOT NULL,
        updated_at         timestamptz NOT NULL,
        UNIQUE (tournament_id, game_number, table_number, referee_user_id)
      );
      CREATE INDEX IF NOT EXISTS mb_tournament_protocols_tournament ON mb_tournament_protocols (tournament_id, status);

      CREATE TABLE IF NOT EXISTS mb_shares (
        token      text PRIMARY KEY,
        user_id    uuid NOT NULL REFERENCES mb_users(id) ON DELETE CASCADE,
        game_id    uuid NOT NULL,
        snapshot   jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        UNIQUE (user_id, game_id)
      );
    `,
  },
  {
    // С 2026-11-17 GoMafia отдаёт профили, клубы, турниры и поиск только после входа: сервер ходит
    // туда входом самого пользователя. Логин и пароль GoMafia — шифротекстом (gomafiaSessions.ts),
    // сохраняются при привязке, стираются при отвязке и вместе с аккаунтом.
    id: '010_mafboard_gomafia_credentials',
    sql: `
      CREATE TABLE IF NOT EXISTS mb_gomafia_credentials (
        user_id    uuid PRIMARY KEY REFERENCES mb_users(id) ON DELETE CASCADE,
        sealed     text NOT NULL,
        updated_at timestamptz NOT NULL
      );
    `,
  },
  {
    // Пул судей клуба: вести рейтинговые игры клуба GoMafia может его президент и резиденты, которых
    // он добавил. Судья без пароля GoMafia оставляет заявку с ником — президент её подтверждает, и
    // аккаунт привязывается к игроку без входа в GoMafia (gomafia_link_source = 'club').
    id: '011_mafboard_club_hosts',
    sql: `
      ALTER TABLE mb_users ADD COLUMN IF NOT EXISTS gomafia_link_source text;
      CREATE TABLE IF NOT EXISTS mb_club_hosts (
        club_id    integer NOT NULL,
        gomafia_id integer NOT NULL,
        nickname   text NOT NULL,
        granted_by uuid REFERENCES mb_users(id) ON DELETE SET NULL,
        granted_at timestamptz NOT NULL,
        PRIMARY KEY (club_id, gomafia_id)
      );
      CREATE TABLE IF NOT EXISTS mb_club_requests (
        user_id    uuid PRIMARY KEY REFERENCES mb_users(id) ON DELETE CASCADE,
        nickname   text NOT NULL,
        created_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS mb_club_requests_nickname ON mb_club_requests (lower(nickname));
    `,
  },
  {
    // Клуб — своя запись MafBoard: на неё ссылаются игры и подключение Titan HUB, а клуб GoMafia —
    // одно из её подключений (клубы без GoMafia появятся позже). Миграция только добавляет:
    // mb_games.club_id и mb_users.titan_link остаются, прежний код поверх этой схемы работает.
    // Здесь только схема: данные заполняет сверка (reconcileMafboardClubs) отдельным шагом, чтобы
    // её сбой на кривых данных не откатил таблицу, от которой зависит приём игр.
    id: '012_mafboard_clubs',
    sql: `
      CREATE TABLE IF NOT EXISTS mb_clubs (
        id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name            text NOT NULL,
        city            text,
        gomafia_club_id integer UNIQUE,
        titan_link      jsonb,
        titan_linked_by uuid REFERENCES mb_users(id) ON DELETE SET NULL,
        owner_user_id   uuid REFERENCES mb_users(id) ON DELETE SET NULL,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE mb_games ADD COLUMN IF NOT EXISTS club_ref uuid REFERENCES mb_clubs(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS mb_games_club_ref_idx ON mb_games (club_ref, finished_at) WHERE club_ref IS NOT NULL;
    `,
  },
  {
    // Члены клуба и приглашения: клуб без GoMafia (создан кодом Titan Connect) и судьи, вступившие по
    // ссылке. Права в клубе GoMafia по-прежнему считаются и из GoMafia (президент, пул судей) — записи
    // членства к ним добавляются. Один клуб Titan HUB (`apiBase`) — один клуб MafBoard.
    id: '013_mafboard_club_members',
    sql: `
      CREATE TABLE IF NOT EXISTS mb_club_members (
        club_id  uuid NOT NULL REFERENCES mb_clubs(id) ON DELETE CASCADE,
        user_id  uuid NOT NULL REFERENCES mb_users(id) ON DELETE CASCADE,
        role     text NOT NULL CHECK (role IN ('owner', 'judge')),
        added_by uuid REFERENCES mb_users(id) ON DELETE SET NULL,
        added_at timestamptz NOT NULL,
        PRIMARY KEY (club_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS mb_club_members_user_idx ON mb_club_members (user_id);
      CREATE TABLE IF NOT EXISTS mb_club_invites (
        id         uuid PRIMARY KEY,
        club_id    uuid NOT NULL REFERENCES mb_clubs(id) ON DELETE CASCADE,
        token_hash text NOT NULL UNIQUE,
        created_by uuid REFERENCES mb_users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS mb_club_invites_club_idx ON mb_club_invites (club_id, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS mb_clubs_titan_api_base_idx ON mb_clubs ((titan_link->>'apiBase')) WHERE titan_link IS NOT NULL;
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

/** Сверить клубы с привязками, пулом судей и играми (`CLUBS_RECONCILE_SQL`). Повтор ничего не меняет. */
export async function reconcileMafboardClubs(target: Database): Promise<void> {
  await target.transaction(async (tx) => {
    await tx.execute(sql.raw(CLUBS_RECONCILE_SQL))
  })
}
