import { sql, type Database } from '@titan/database'
import type { SQL } from 'drizzle-orm'
import { DELETED_HOST_ID } from './config.js'
import { GomafiaTakenError, type MafboardRepo } from './repo.js'
import type {
  DeviceSession, GoMafiaClubJSON, GoMafiaPlayerJSON, LoginTicket, MafboardUser, RefreshTokenRow, StoredActiveGame, StoredGame, TicketGuard, TicketPatch,
  TicketStatus, TicketStep,
} from './types.js'

// Хранилище MafBoard в Postgres (raw SQL, как modules/smm/db.ts). Даты передаём
// строкой с приведением ::timestamptz — объект Date postgres-js в шаблоне не сериализует.

type Row = Record<string, unknown>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DELETED_HOST_JSON = JSON.stringify(DELETED_HOST_ID)

function rows(res: unknown): Row[] {
  return (Array.isArray(res) ? res : ((res as { rows?: Row[] }).rows ?? [])) as Row[]
}

const str = (v: unknown): string | null => (v == null ? null : String(v))
const num = (v: unknown): number | null => (v == null ? null : Number(v))
const date = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)))
const dateOrNull = (v: unknown): Date | null => (v == null ? null : date(v))
const iso = (d: Date): string => d.toISOString()

function json<T>(v: unknown): T | null {
  if (v == null) return null
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T
    } catch {
      return null
    }
  }
  return v as T
}

function toUser(r: Row): MafboardUser {
  const player = json<GoMafiaPlayerJSON>(r['gomafia_player'])
  return {
    id: String(r['id']),
    tgId: Number(r['tg_id']),
    tgUsername: str(r['tg_username']),
    tgFirstName: String(r['tg_first_name'] ?? ''),
    tgLastName: str(r['tg_last_name']),
    phone: str(r['phone']),
    termsVersion: str(r['terms_version']),
    gomafia: player
      ? {
          player,
          club: json<GoMafiaClubJSON>(r['gomafia_club']),
          linkedAt: date(r['gomafia_linked_at']),
          syncedAt: date(r['gomafia_synced_at']),
        }
      : null,
  }
}

function toTicket(r: Row): LoginTicket {
  return {
    id: String(r['id']),
    deepCode: String(r['deep_code']),
    confirmCode: String(r['confirm_code']),
    deviceSecretHash: String(r['device_secret_hash']),
    deviceName: String(r['device_name']),
    platform: String(r['platform']),
    status: String(r['status']) as TicketStatus,
    step: String(r['step']) as TicketStep,
    tgId: num(r['tg_id']),
    tgUsername: str(r['tg_username']),
    tgFirstName: str(r['tg_first_name']),
    tgLastName: str(r['tg_last_name']),
    phone: str(r['phone']),
    termsVersion: str(r['terms_version']),
    userId: str(r['user_id']),
    openedAt: dateOrNull(r['opened_at']),
    note: str(r['note']),
    createdAt: date(r['created_at']),
    expiresAt: date(r['expires_at']),
  }
}

function toSession(r: Row): DeviceSession {
  return {
    id: String(r['id']),
    userId: String(r['user_id']),
    deviceName: str(r['device_name']),
    platform: str(r['platform']),
    createdAt: date(r['created_at']),
    lastUsedAt: date(r['last_used_at']),
    expiresAt: date(r['expires_at']),
    revokedAt: dateOrNull(r['revoked_at']),
  }
}

function toGame(r: Row): StoredGame {
  return {
    id: String(r['id']),
    hostUserId: r['host_user_id'] == null ? null : String(r['host_user_id']),
    clubId: num(r['club_id']),
    format: String(r['format']),
    variant: String(r['variant']),
    startedAt: date(r['started_at']),
    finishedAt: date(r['finished_at']),
    schemaVersion: Number(r['schema_version']),
    record: json<unknown>(r['record']),
  }
}

function toActiveGame(r: Row): StoredActiveGame {
  return {
    id: String(r['id']),
    hostUserId: String(r['host_user_id']),
    revision: Number(r['revision']),
    updatedAt: date(r['updated_at']),
    snapshot: json<unknown>(r['snapshot']),
  }
}

/** Колонки билета, которые можно менять, и их приведение. */
function ticketAssignments(patch: TicketPatch): SQL[] {
  const sets: SQL[] = []
  const text = (column: string, value: string | null | undefined) => {
    if (value !== undefined) sets.push(sql`${sql.identifier(column)} = ${value}`)
  }
  text('status', patch.status)
  text('step', patch.step)
  text('tg_username', patch.tgUsername)
  text('tg_first_name', patch.tgFirstName)
  text('tg_last_name', patch.tgLastName)
  text('phone', patch.phone)
  text('terms_version', patch.termsVersion)
  text('note', patch.note)
  if (patch.tgId !== undefined) sets.push(sql`tg_id = ${patch.tgId}`)
  if (patch.userId !== undefined) sets.push(sql`user_id = ${patch.userId}::uuid`)
  if (patch.openedAt !== undefined) sets.push(sql`opened_at = ${patch.openedAt ? iso(patch.openedAt) : null}::timestamptz`)
  return sets
}

export class PgMafboardRepo implements MafboardRepo {
  constructor(private readonly db: Database) {}

  private async query(statement: SQL): Promise<Row[]> {
    return rows(await this.db.execute(statement))
  }

  private async one(statement: SQL): Promise<Row | null> {
    return (await this.query(statement))[0] ?? null
  }

  // ─── Пользователи ──────────────────────────────────────────────────────────

  async userById(id: string): Promise<MafboardUser | null> {
    if (!UUID.test(id)) return null
    const row = await this.one(sql`SELECT * FROM mb_users WHERE id = ${id}::uuid`)
    return row ? toUser(row) : null
  }

  async userByTgId(tgId: number): Promise<MafboardUser | null> {
    const row = await this.one(sql`SELECT * FROM mb_users WHERE tg_id = ${tgId}`)
    return row ? toUser(row) : null
  }

  async userByGomafiaId(gomafiaId: number): Promise<MafboardUser | null> {
    const row = await this.one(sql`SELECT * FROM mb_users WHERE gomafia_id = ${gomafiaId}`)
    return row ? toUser(row) : null
  }

  async upsertUserFromTelegram(p: Parameters<MafboardRepo['upsertUserFromTelegram']>[0]): Promise<MafboardUser> {
    const row = await this.one(sql`
      INSERT INTO mb_users (tg_id, tg_username, tg_first_name, tg_last_name, phone, terms_version, terms_accepted_at)
      VALUES (${p.tgId}, ${p.tgUsername}, ${p.tgFirstName}, ${p.tgLastName}, ${p.phone}, ${p.termsVersion}, now())
      ON CONFLICT (tg_id) DO UPDATE SET
        tg_username = EXCLUDED.tg_username,
        tg_first_name = EXCLUDED.tg_first_name,
        tg_last_name = EXCLUDED.tg_last_name,
        phone = EXCLUDED.phone,
        terms_accepted_at = CASE WHEN mb_users.terms_version IS DISTINCT FROM EXCLUDED.terms_version
                                 THEN now() ELSE mb_users.terms_accepted_at END,
        terms_version = EXCLUDED.terms_version,
        updated_at = now()
      RETURNING *
    `)
    if (!row) throw new Error('[mafboard] upsert пользователя не вернул строку')
    return toUser(row)
  }

  async deleteUser(userId: string): Promise<boolean> {
    if (!UUID.test(userId)) return false
    // Одним запросом: личные игры удаляются, из игр клуба убирается ведущий (клуб в записи остаётся),
    // остальное — каскадом от mb_users.
    const deleted = await this.query(sql`
      WITH personal AS (
        DELETE FROM mb_games WHERE host_user_id = ${userId}::uuid AND club_id IS NULL
      ), club AS (
        UPDATE mb_games SET host_user_id = NULL,
          record = jsonb_set(record #- '{setup,host,goMafiaPlayerID}', '{setup,host,userID}', ${DELETED_HOST_JSON}::jsonb)
        WHERE host_user_id = ${userId}::uuid AND club_id IS NOT NULL
      )
      DELETE FROM mb_users WHERE id = ${userId}::uuid RETURNING id
    `)
    return deleted.length > 0
  }

  async setGomafiaLink(
    userId: string,
    link: { player: GoMafiaPlayerJSON; club: GoMafiaClubJSON | null } | null,
    at: Date,
  ): Promise<MafboardUser | null> {
    if (!UUID.test(userId)) return null
    if (!link) {
      const row = await this.one(sql`
        UPDATE mb_users SET gomafia_id = NULL, gomafia_player = NULL, gomafia_club = NULL,
          gomafia_linked_at = NULL, gomafia_synced_at = NULL, updated_at = now()
        WHERE id = ${userId}::uuid RETURNING *
      `)
      return row ? toUser(row) : null
    }
    try {
      const row = await this.one(sql`
        UPDATE mb_users SET
          gomafia_linked_at = CASE WHEN gomafia_id = ${link.player.id}
                                   THEN COALESCE(gomafia_linked_at, ${iso(at)}::timestamptz)
                                   ELSE ${iso(at)}::timestamptz END,
          gomafia_id = ${link.player.id},
          gomafia_player = ${JSON.stringify(link.player)}::jsonb,
          gomafia_club = ${link.club ? JSON.stringify(link.club) : null}::jsonb,
          gomafia_synced_at = ${iso(at)}::timestamptz,
          updated_at = now()
        WHERE id = ${userId}::uuid RETURNING *
      `)
      return row ? toUser(row) : null
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new GomafiaTakenError()
      throw error
    }
  }

  // ─── Билеты входа ──────────────────────────────────────────────────────────

  async createTicket(input: Parameters<MafboardRepo['createTicket']>[0]): Promise<LoginTicket> {
    const row = await this.one(sql`
      INSERT INTO mb_login_tickets (deep_code, confirm_code, device_secret_hash, device_name, platform, expires_at)
      VALUES (${input.deepCode}, ${input.confirmCode}, ${input.deviceSecretHash}, ${input.deviceName}, ${input.platform},
              ${iso(input.expiresAt)}::timestamptz)
      RETURNING *
    `)
    if (!row) throw new Error('[mafboard] билет не создан')
    return toTicket(row)
  }

  async ticketById(id: string): Promise<LoginTicket | null> {
    if (!UUID.test(id)) return null
    const row = await this.one(sql`SELECT * FROM mb_login_tickets WHERE id = ${id}::uuid`)
    return row ? toTicket(row) : null
  }

  async ticketByDeepCode(deepCode: string): Promise<LoginTicket | null> {
    const row = await this.one(sql`SELECT * FROM mb_login_tickets WHERE deep_code = ${deepCode}`)
    return row ? toTicket(row) : null
  }

  async openTicketForTg(tgId: number, step: TicketStep, now: Date): Promise<LoginTicket | null> {
    const row = await this.one(sql`
      SELECT * FROM mb_login_tickets
      WHERE tg_id = ${tgId} AND status = 'pending' AND step = ${step} AND expires_at > ${iso(now)}::timestamptz
      ORDER BY created_at DESC LIMIT 1
    `)
    return row ? toTicket(row) : null
  }

  async updateTicket(id: string, patch: TicketPatch, guard?: TicketGuard): Promise<LoginTicket | null> {
    if (!UUID.test(id)) return null
    const sets = ticketAssignments(patch)
    if (sets.length === 0) return this.ticketById(id)
    const condition = guard
      ? sql` AND status = 'pending' AND (tg_id = ${guard.tgId} OR (${guard.allowUnbound} AND tg_id IS NULL))`
      : sql``
    const row = await this.one(sql`
      UPDATE mb_login_tickets SET ${sql.join(sets, sql`, `)} WHERE id = ${id}::uuid${condition} RETURNING *
    `)
    return row ? toTicket(row) : null
  }

  async claimTicket(id: string, deviceSecretHash: string, now: Date): Promise<LoginTicket | null> {
    if (!UUID.test(id)) return null
    const row = await this.one(sql`
      UPDATE mb_login_tickets SET status = 'claimed', claimed_at = ${iso(now)}::timestamptz
      WHERE id = ${id}::uuid AND status = 'confirmed'
        AND expires_at > ${iso(now)}::timestamptz AND device_secret_hash = ${deviceSecretHash}
      RETURNING *
    `)
    return row ? toTicket(row) : null
  }

  async purgeExpired(before: Date): Promise<{ tickets: number; sessions: number; refreshTokens: number }> {
    const tickets = await this.query(sql`DELETE FROM mb_login_tickets WHERE expires_at < ${iso(before)}::timestamptz RETURNING id`)
    // Токены истёкшей сессии удаляются каскадом; отдельно — старые токены живых сессий.
    const sessions = await this.query(sql`DELETE FROM mb_sessions WHERE expires_at < ${iso(before)}::timestamptz RETURNING id`)
    const tokens = await this.query(sql`DELETE FROM mb_refresh_tokens WHERE expires_at < ${iso(before)}::timestamptz RETURNING token_hash`)
    return { tickets: tickets.length, sessions: sessions.length, refreshTokens: tokens.length }
  }

  // ─── Сессии устройств ──────────────────────────────────────────────────────

  async createSession(input: Parameters<MafboardRepo['createSession']>[0]): Promise<DeviceSession> {
    const row = await this.one(sql`
      WITH session AS (
        INSERT INTO mb_sessions (user_id, device_name, platform, created_at, last_used_at, expires_at)
        VALUES (${input.userId}::uuid, ${input.deviceName}, ${input.platform}, ${iso(input.at)}::timestamptz,
                ${iso(input.at)}::timestamptz, ${iso(input.expiresAt)}::timestamptz)
        RETURNING *
      ), token AS (
        INSERT INTO mb_refresh_tokens (token_hash, user_id, session_id, device_name, platform, created_at, expires_at)
        SELECT ${input.refreshTokenHash}, user_id, id, device_name, platform, created_at, expires_at FROM session
      )
      SELECT * FROM session
    `)
    if (!row) throw new Error('[mafboard] сессия не создана')
    return toSession(row)
  }

  async sessionById(id: string): Promise<DeviceSession | null> {
    if (!UUID.test(id)) return null
    const row = await this.one(sql`SELECT * FROM mb_sessions WHERE id = ${id}::uuid`)
    return row ? toSession(row) : null
  }

  async sessionsByUser(userId: string, now: Date, limit: number): Promise<DeviceSession[]> {
    const found = await this.query(sql`
      SELECT * FROM mb_sessions
      WHERE user_id = ${userId}::uuid AND revoked_at IS NULL AND expires_at > ${iso(now)}::timestamptz
      ORDER BY last_used_at DESC LIMIT ${limit}
    `)
    return found.map(toSession)
  }

  async extendSession(input: Parameters<MafboardRepo['extendSession']>[0]): Promise<boolean> {
    const inserted = await this.query(sql`
      WITH session AS (
        UPDATE mb_sessions SET last_used_at = GREATEST(last_used_at, ${iso(input.at)}::timestamptz),
                               expires_at = ${iso(input.expiresAt)}::timestamptz
        WHERE id = ${input.sessionId}::uuid AND revoked_at IS NULL
        RETURNING id, user_id
      )
      INSERT INTO mb_refresh_tokens (token_hash, user_id, session_id, created_at, expires_at)
      SELECT ${input.refreshTokenHash}, user_id, id, ${iso(input.at)}::timestamptz, ${iso(input.expiresAt)}::timestamptz FROM session
      RETURNING token_hash
    `)
    return inserted.length > 0
  }

  async touchSession(id: string, at: Date): Promise<void> {
    if (!UUID.test(id)) return
    await this.db.execute(sql`
      UPDATE mb_sessions SET last_used_at = ${iso(at)}::timestamptz
      WHERE id = ${id}::uuid AND last_used_at < ${iso(at)}::timestamptz
    `)
  }

  async revokeSession(userId: string, sessionId: string, at: Date): Promise<boolean> {
    if (!UUID.test(userId) || !UUID.test(sessionId)) return false
    const revoked = await this.query(sql`
      WITH session AS (
        UPDATE mb_sessions SET revoked_at = ${iso(at)}::timestamptz
        WHERE id = ${sessionId}::uuid AND user_id = ${userId}::uuid AND revoked_at IS NULL
        RETURNING id
      ), tokens AS (
        UPDATE mb_refresh_tokens SET revoked_at = ${iso(at)}::timestamptz
        WHERE session_id IN (SELECT id FROM session) AND revoked_at IS NULL
      )
      SELECT id FROM session
    `)
    return revoked.length > 0
  }

  async revokeAllSessions(userId: string, at: Date): Promise<void> {
    await this.db.execute(sql`
      WITH sessions AS (
        UPDATE mb_sessions SET revoked_at = ${iso(at)}::timestamptz
        WHERE user_id = ${userId}::uuid AND revoked_at IS NULL
      )
      UPDATE mb_refresh_tokens SET revoked_at = ${iso(at)}::timestamptz
      WHERE user_id = ${userId}::uuid AND revoked_at IS NULL
    `)
  }

  // ─── Refresh-токены ────────────────────────────────────────────────────────

  async refreshToken(tokenHash: string): Promise<RefreshTokenRow | null> {
    const row = await this.one(sql`
      SELECT t.token_hash, t.user_id, t.session_id, t.expires_at, t.revoked_at, s.revoked_at AS session_revoked_at
      FROM mb_refresh_tokens t JOIN mb_sessions s ON s.id = t.session_id
      WHERE t.token_hash = ${tokenHash}
    `)
    return row
      ? {
          tokenHash: String(row['token_hash']),
          userId: String(row['user_id']),
          sessionId: String(row['session_id']),
          expiresAt: date(row['expires_at']),
          revokedAt: dateOrNull(row['revoked_at']),
          sessionRevokedAt: dateOrNull(row['session_revoked_at']),
        }
      : null
  }

  async revokeRefreshToken(tokenHash: string, at: Date, replacedBy: string | null): Promise<boolean> {
    const updated = await this.query(sql`
      UPDATE mb_refresh_tokens SET revoked_at = ${iso(at)}::timestamptz, replaced_by = ${replacedBy}
      WHERE token_hash = ${tokenHash} AND revoked_at IS NULL RETURNING token_hash
    `)
    return updated.length > 0
  }

  // ─── Игры ──────────────────────────────────────────────────────────────────

  async insertGame(game: StoredGame): Promise<'inserted' | 'exists' | 'conflict'> {
    // Та же игра того же ведущего — обновляем запись (ведущий мог отменить конец игры и доиграть иначе).
    const saved = await this.query(sql`
      INSERT INTO mb_games (id, host_user_id, club_id, format, variant, started_at, finished_at, schema_version, record)
      VALUES (${game.id}::uuid, ${game.hostUserId}::uuid, ${game.clubId}, ${game.format}, ${game.variant},
              ${iso(game.startedAt)}::timestamptz, ${iso(game.finishedAt)}::timestamptz, ${game.schemaVersion},
              ${JSON.stringify(game.record)}::jsonb)
      ON CONFLICT (id) DO UPDATE
        SET club_id = EXCLUDED.club_id, format = EXCLUDED.format, variant = EXCLUDED.variant,
            started_at = EXCLUDED.started_at, finished_at = EXCLUDED.finished_at,
            schema_version = EXCLUDED.schema_version, record = EXCLUDED.record
        WHERE mb_games.host_user_id = EXCLUDED.host_user_id
      RETURNING (xmax = 0) AS inserted
    `)
    const row = saved[0]
    if (!row) return 'conflict'
    return row['inserted'] === true || row['inserted'] === 't' ? 'inserted' : 'exists'
  }

  async gamesByHost(userId: string, since: Date | null, limit: number): Promise<StoredGame[]> {
    const found = await this.query(sql`
      SELECT * FROM mb_games
      WHERE host_user_id = ${userId}::uuid AND (${since ? iso(since) : null}::timestamptz IS NULL OR finished_at > ${since ? iso(since) : null}::timestamptz)
      ORDER BY finished_at ASC LIMIT ${limit}
    `)
    return found.map(toGame)
  }

  async gamesByClub(clubId: number, since: Date | null, limit: number): Promise<StoredGame[]> {
    const found = await this.query(sql`
      SELECT * FROM mb_games
      WHERE club_id = ${clubId} AND (${since ? iso(since) : null}::timestamptz IS NULL OR finished_at > ${since ? iso(since) : null}::timestamptz)
      ORDER BY finished_at ASC LIMIT ${limit}
    `)
    return found.map(toGame)
  }
  async saveActiveGame(game: StoredActiveGame): Promise<'saved' | 'stale' | 'conflict'> {
    const finished = await this.one(sql`SELECT host_user_id FROM mb_games WHERE id = ${game.id}::uuid`)
    if (finished) return String(finished['host_user_id']) === game.hostUserId ? 'stale' : 'conflict'
    const saved = await this.query(sql`
      INSERT INTO mb_active_games (id, host_user_id, revision, updated_at, snapshot)
      VALUES (${game.id}::uuid, ${game.hostUserId}::uuid, ${game.revision}, ${iso(game.updatedAt)}::timestamptz,
              ${JSON.stringify(game.snapshot)}::jsonb)
      ON CONFLICT (id) DO UPDATE
        SET revision = EXCLUDED.revision, updated_at = EXCLUDED.updated_at, snapshot = EXCLUDED.snapshot
        WHERE mb_active_games.host_user_id = EXCLUDED.host_user_id AND mb_active_games.revision <= EXCLUDED.revision
      RETURNING id
    `)
    if (saved.length > 0) return 'saved'
    const existing = await this.one(sql`SELECT host_user_id FROM mb_active_games WHERE id = ${game.id}::uuid`)
    return existing && String(existing['host_user_id']) === game.hostUserId ? 'stale' : 'conflict'
  }

  async activeGamesByHost(userId: string, limit: number): Promise<StoredActiveGame[]> {
    const found = await this.query(sql`
      SELECT * FROM mb_active_games WHERE host_user_id = ${userId}::uuid ORDER BY updated_at DESC LIMIT ${limit}
    `)
    return found.map(toActiveGame)
  }

  async deleteActiveGame(userId: string, id: string): Promise<void> {
    await this.query(sql`DELETE FROM mb_active_games WHERE id = ${id}::uuid AND host_user_id = ${userId}::uuid`)
  }

}
