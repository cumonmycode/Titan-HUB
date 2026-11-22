import { sql, type Database } from '@titan/database'
import type { SQL } from 'drizzle-orm'
import { DELETED_HOST_ID } from './config.js'
import { GomafiaTakenError, type GomafiaLinkInput, type MafboardRepo } from './repo.js'
import type {
  DeviceSession, GoMafiaClubJSON, GoMafiaPlayerJSON, LoginTicket, MafboardUser, QrTicket, QrTicketStatus, RefreshTokenRow, StoredActiveGame, StoredClub, StoredClubHost, StoredClubInvite, StoredClubMember, StoredClubRequest, StoredGame, StoredProtocolSubmission, StoredShare, StoredStudioSettings,
  TicketGuard, TicketPatch, TicketStatus, TicketStep, TitanLinkState,
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

/** titan_link хранит дату строкой ISO — как её записал JSON.stringify. */
function toTitanLink(v: unknown): TitanLinkState | null {
  const raw = json<Omit<TitanLinkState, 'linkedAt'> & { linkedAt: string }>(v)
  return raw ? { ...raw, linkedAt: date(raw.linkedAt) } : null
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
          // Привязки до пула судей сделаны входом в GoMafia.
          source: r['gomafia_link_source'] === 'club' ? 'club' : 'password',
          linkedAt: date(r['gomafia_linked_at']),
          syncedAt: date(r['gomafia_synced_at']),
        }
      : null,
    titan: toTitanLink(r['titan_link']),
  }
}

function toClubHost(r: Row): StoredClubHost {
  return {
    clubId: Number(r['club_id']),
    gomafiaId: Number(r['gomafia_id']),
    nickname: String(r['nickname']),
    grantedBy: str(r['granted_by']),
    grantedAt: date(r['granted_at']),
  }
}

function toClub(r: Row): StoredClub {
  return {
    id: String(r['id']),
    name: String(r['name']),
    city: str(r['city']),
    gomafiaClubId: num(r['gomafia_club_id']),
    titan: toTitanLink(r['titan_link']),
    titanLinkedBy: str(r['titan_linked_by']),
    ownerUserId: str(r['owner_user_id']),
  }
}

function toClubMember(r: Row): StoredClubMember {
  return {
    clubId: String(r['club_id']),
    userId: String(r['user_id']),
    role: r['role'] === 'owner' ? 'owner' : 'judge',
    addedBy: str(r['added_by']),
    addedAt: date(r['added_at']),
  }
}

function toClubInvite(r: Row): StoredClubInvite {
  return {
    id: String(r['id']),
    clubId: String(r['club_id']),
    tokenHash: String(r['token_hash']),
    createdBy: str(r['created_by']),
    createdAt: date(r['created_at']),
    expiresAt: date(r['expires_at']),
    revokedAt: dateOrNull(r['revoked_at']),
  }
}

function toClubRequest(r: Row): StoredClubRequest {
  return { userId: String(r['user_id']), nickname: String(r['nickname']), createdAt: date(r['created_at']) }
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

function toQrTicket(r: Row): QrTicket {
  return {
    id: String(r['id']),
    scanCode: String(r['scan_code']),
    confirmCode: String(r['confirm_code']),
    choiceCodes: json<number[]>(r['choice_codes']) ?? [],
    deviceSecretHash: String(r['device_secret_hash']),
    deviceName: String(r['device_name']),
    platform: String(r['platform']),
    status: String(r['status']) as QrTicketStatus,
    userId: str(r['user_id']),
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
    clubRef: str(r['club_ref']),
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

function toSubmission(r: Row): StoredProtocolSubmission {
  return {
    id: String(r['id']),
    tournamentId: Number(r['tournament_id']),
    tournamentTitle: String(r['tournament_title']),
    gameNumber: Number(r['game_number']),
    tableNumber: Number(r['table_number']),
    refereeUserId: String(r['referee_user_id']),
    refereeName: String(r['referee_name']),
    reviewerGomafiaId: r['reviewer_gomafia_id'] == null ? null : Number(r['reviewer_gomafia_id']),
    protocol: json<unknown>(r['protocol']),
    status: String(r['status']) as StoredProtocolSubmission['status'],
    reason: r['reason'] == null ? null : String(r['reason']),
    decidedBy: r['decided_by'] == null ? null : String(r['decided_by']),
    createdAt: date(r['created_at']),
    updatedAt: date(r['updated_at']),
  }
}

function toShare(r: Row): StoredShare {
  return {
    token: String(r['token']),
    userId: String(r['user_id']),
    gameId: String(r['game_id']),
    snapshot: json<unknown>(r['snapshot']),
    createdAt: date(r['created_at']),
  }
}

function toStudioSettings(r: Row): StoredStudioSettings {
  return {
    userId: String(r['user_id']),
    revision: Number(r['revision']),
    updatedAt: date(r['updated_at']),
    document: json<Record<string, unknown>>(r['document']) ?? {},
    secrets: r['secrets'] == null ? null : String(r['secrets']),
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

  async verifiedGomafiaIds(gomafiaIds: number[]): Promise<Set<number>> {
    const ids = [...new Set(gomafiaIds.filter((id) => Number.isInteger(id)))]
    if (ids.length === 0) return new Set()
    const found = await this.query(sql`SELECT gomafia_id FROM mb_users WHERE gomafia_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)
    return new Set(found.map((row) => Number(row['gomafia_id'])))
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

  async setGomafiaLink(userId: string, link: GomafiaLinkInput | null, at: Date): Promise<MafboardUser | null> {
    if (!UUID.test(userId)) return null
    if (!link) {
      const row = await this.one(sql`
        UPDATE mb_users SET gomafia_id = NULL, gomafia_player = NULL, gomafia_club = NULL,
          gomafia_linked_at = NULL, gomafia_synced_at = NULL, gomafia_link_source = NULL, updated_at = now()
        WHERE id = ${userId}::uuid RETURNING *
      `)
      return row ? toUser(row) : null
    }
    try {
      // SET читает старые значения строки: способ подтверждения сохраняется, пока аккаунт GoMafia тот же.
      const row = await this.one(sql`
        UPDATE mb_users SET
          gomafia_linked_at = CASE WHEN gomafia_id = ${link.player.id}
                                   THEN COALESCE(gomafia_linked_at, ${iso(at)}::timestamptz)
                                   ELSE ${iso(at)}::timestamptz END,
          gomafia_link_source = COALESCE(
            ${link.source ?? null}::text,
            CASE WHEN gomafia_id = ${link.player.id} THEN gomafia_link_source END,
            'password'
          ),
          gomafia_id = ${link.player.id},
          gomafia_player = ${JSON.stringify(link.player)}::jsonb,
          gomafia_club = ${link.club ? JSON.stringify(link.club) : null}::jsonb,
          gomafia_synced_at = ${iso(at)}::timestamptz,
          updated_at = now()
        WHERE id = ${userId}::uuid RETURNING *
      `)
      if (row) await this.syncClub(link)
      return row ? toUser(row) : null
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new GomafiaTakenError()
      throw error
    }
  }

  /**
   * Запись клуба MafBoard для клуба GoMafia из привязки. Неполный снимок (без президента: страница
   * клуба не открылась) клуб только заводит — название и город из заглушки не берём. Подключение
   * Titan клуба здесь не меняется. Права считаются по привязке, поэтому сбой здесь привязку не
   * отменяет: запись клуба восстановит сверка при старте (`reconcileMafboardClubs`).
   */
  private async syncClub(link: GomafiaLinkInput): Promise<void> {
    const club = link.club
    if (!club) return
    const isFull = club.presidentID !== undefined
    try {
      await this.query(sql`
        INSERT INTO mb_clubs (name, city, gomafia_club_id) VALUES (${club.title}, ${club.city}, ${club.id})
        ON CONFLICT (gomafia_club_id) DO UPDATE
          SET name = EXCLUDED.name, city = COALESCE(EXCLUDED.city, mb_clubs.city), updated_at = now()
          WHERE ${isFull}::boolean
            AND (mb_clubs.name, mb_clubs.city) IS DISTINCT FROM (EXCLUDED.name, COALESCE(EXCLUDED.city, mb_clubs.city))
      `)
    } catch (error) {
      console.warn(`[mafboard] запись клуба GoMafia ${club.id} не обновлена — её восстановит сверка при старте:`, error)
    }
  }

  // ─── Клубы ─────────────────────────────────────────────────────────────────

  async clubByGomafiaId(gomafiaClubId: number): Promise<StoredClub | null> {
    if (!Number.isInteger(gomafiaClubId)) return null
    const row = await this.one(sql`SELECT * FROM mb_clubs WHERE gomafia_club_id = ${gomafiaClubId}`)
    return row ? toClub(row) : null
  }

  async setClubTitanLink(clubId: string, link: TitanLinkState | null, linkedBy: string | null): Promise<TitanLinkState | null> {
    if (!UUID.test(clubId)) return null
    // Прежнее подключение читается под блокировкой строки: два подключения подряд не потеряют ключ для отзыва.
    const row = await this.one(sql`
      WITH previous AS (SELECT id, titan_link FROM mb_clubs WHERE id = ${clubId}::uuid FOR UPDATE)
      UPDATE mb_clubs SET
        titan_link = ${link ? JSON.stringify(link) : null}::jsonb,
        titan_linked_by = ${link ? linkedBy : null}::uuid,
        updated_at = now()
      FROM previous
      WHERE mb_clubs.id = previous.id
      RETURNING previous.titan_link AS previous_link
    `)
    return row ? toTitanLink(row['previous_link']) : null
  }

  async clubsLinkedBy(userId: string): Promise<StoredClub[]> {
    if (!UUID.test(userId)) return []
    const found = await this.query(sql`
      SELECT * FROM mb_clubs WHERE titan_linked_by = ${userId}::uuid AND titan_link IS NOT NULL ORDER BY created_at, id
    `)
    return found.map(toClub)
  }

  async clubByTitanConnection(connectionId: string): Promise<StoredClub | null> {
    const row = await this.one(sql`SELECT * FROM mb_clubs WHERE titan_link->>'connectionId' = ${connectionId} LIMIT 1`)
    return row ? toClub(row) : null
  }

  async clubById(id: string): Promise<StoredClub | null> {
    if (!UUID.test(id)) return null
    const row = await this.one(sql`SELECT * FROM mb_clubs WHERE id = ${id}::uuid`)
    return row ? toClub(row) : null
  }

  async createTitanClub(input: { name: string; titan: TitanLinkState; ownerUserId: string; at: Date }): Promise<StoredClub | 'exists'> {
    try {
      const row = await this.one(sql`
        WITH club AS (
          INSERT INTO mb_clubs (name, titan_link, titan_linked_by, owner_user_id)
          VALUES (${input.name}, ${JSON.stringify(input.titan)}::jsonb, ${input.ownerUserId}::uuid, ${input.ownerUserId}::uuid)
          RETURNING *
        ), owner AS (
          INSERT INTO mb_club_members (club_id, user_id, role, added_by, added_at)
          SELECT id, ${input.ownerUserId}::uuid, 'owner', ${input.ownerUserId}::uuid, ${iso(input.at)}::timestamptz FROM club
        )
        SELECT * FROM club
      `)
      if (!row) throw new Error('клуб не создан')
      return toClub(row)
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return 'exists'
      throw error
    }
  }

  async clubMembers(clubId: string): Promise<StoredClubMember[]> {
    if (!UUID.test(clubId)) return []
    const found = await this.query(sql`SELECT * FROM mb_club_members WHERE club_id = ${clubId}::uuid ORDER BY added_at, user_id`)
    return found.map(toClubMember)
  }

  async membershipsOf(userId: string): Promise<StoredClubMember[]> {
    if (!UUID.test(userId)) return []
    const found = await this.query(sql`SELECT * FROM mb_club_members WHERE user_id = ${userId}::uuid ORDER BY added_at, club_id`)
    return found.map(toClubMember)
  }

  async addClubMember(member: StoredClubMember): Promise<void> {
    await this.query(sql`
      INSERT INTO mb_club_members (club_id, user_id, role, added_by, added_at)
      VALUES (${member.clubId}::uuid, ${member.userId}::uuid, ${member.role}, ${member.addedBy}::uuid, ${iso(member.addedAt)}::timestamptz)
      ON CONFLICT (club_id, user_id) DO NOTHING
    `)
  }

  async removeClubMember(clubId: string, userId: string): Promise<boolean> {
    if (!UUID.test(clubId) || !UUID.test(userId)) return false
    const removed = await this.query(sql`
      DELETE FROM mb_club_members WHERE club_id = ${clubId}::uuid AND user_id = ${userId}::uuid RETURNING user_id
    `)
    return removed.length > 0
  }

  async createClubInvite(invite: StoredClubInvite): Promise<void> {
    await this.query(sql`
      INSERT INTO mb_club_invites (id, club_id, token_hash, created_by, created_at, expires_at)
      VALUES (${invite.id}::uuid, ${invite.clubId}::uuid, ${invite.tokenHash}, ${invite.createdBy}::uuid,
              ${iso(invite.createdAt)}::timestamptz, ${iso(invite.expiresAt)}::timestamptz)
    `)
  }

  async clubInvites(clubId: string, now: Date): Promise<StoredClubInvite[]> {
    if (!UUID.test(clubId)) return []
    const found = await this.query(sql`
      SELECT * FROM mb_club_invites
      WHERE club_id = ${clubId}::uuid AND revoked_at IS NULL AND expires_at > ${iso(now)}::timestamptz
      ORDER BY created_at DESC
    `)
    return found.map(toClubInvite)
  }

  async clubInviteByTokenHash(tokenHash: string): Promise<StoredClubInvite | null> {
    const row = await this.one(sql`SELECT * FROM mb_club_invites WHERE token_hash = ${tokenHash}`)
    return row ? toClubInvite(row) : null
  }

  async revokeClubInvite(clubId: string, inviteId: string, at: Date): Promise<boolean> {
    if (!UUID.test(clubId) || !UUID.test(inviteId)) return false
    const revoked = await this.query(sql`
      UPDATE mb_club_invites SET revoked_at = ${iso(at)}::timestamptz
      WHERE id = ${inviteId}::uuid AND club_id = ${clubId}::uuid AND revoked_at IS NULL RETURNING id
    `)
    return revoked.length > 0
  }

  async gamesByClubRef(clubRef: string, since: Date | null, limit: number): Promise<StoredGame[]> {
    if (!UUID.test(clubRef)) return []
    const found = await this.query(sql`
      SELECT * FROM mb_games
      WHERE club_ref = ${clubRef}::uuid AND (${since ? iso(since) : null}::timestamptz IS NULL OR finished_at > ${since ? iso(since) : null}::timestamptz)
      ORDER BY finished_at ASC LIMIT ${limit}
    `)
    return found.map(toGame)
  }

  async clearTitanMirrors(connectionId: string): Promise<void> {
    await this.query(sql`
      UPDATE mb_users SET titan_link = NULL, updated_at = now() WHERE titan_link->>'connectionId' = ${connectionId}
    `)
  }

  // ─── Пул судей клуба и заявки ──────────────────────────────────────────────

  async clubHosts(clubId: number): Promise<StoredClubHost[]> {
    const found = await this.query(sql`SELECT * FROM mb_club_hosts WHERE club_id = ${clubId} ORDER BY granted_at, gomafia_id`)
    return found.map(toClubHost)
  }

  async isClubHost(clubId: number, gomafiaId: number): Promise<boolean> {
    const row = await this.one(sql`SELECT 1 AS found FROM mb_club_hosts WHERE club_id = ${clubId} AND gomafia_id = ${gomafiaId}`)
    return row != null
  }

  async addClubHost(host: StoredClubHost): Promise<void> {
    await this.query(sql`
      INSERT INTO mb_club_hosts (club_id, gomafia_id, nickname, granted_by, granted_at)
      VALUES (${host.clubId}, ${host.gomafiaId}, ${host.nickname}, ${host.grantedBy}::uuid, ${iso(host.grantedAt)}::timestamptz)
      ON CONFLICT (club_id, gomafia_id) DO UPDATE SET nickname = EXCLUDED.nickname
    `)
  }

  async removeClubHost(clubId: number, gomafiaId: number): Promise<boolean> {
    const deleted = await this.query(sql`DELETE FROM mb_club_hosts WHERE club_id = ${clubId} AND gomafia_id = ${gomafiaId} RETURNING gomafia_id`)
    return deleted.length > 0
  }

  async usersByGomafiaIds(gomafiaIds: number[]): Promise<MafboardUser[]> {
    const ids = [...new Set(gomafiaIds.filter((id) => Number.isInteger(id)))]
    if (ids.length === 0) return []
    const found = await this.query(sql`SELECT * FROM mb_users WHERE gomafia_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)
    return found.map(toUser)
  }

  async clubPresidents(limit: number): Promise<MafboardUser[]> {
    const found = await this.query(sql`
      SELECT * FROM mb_users
      WHERE gomafia_id IS NOT NULL AND gomafia_club->>'presidentID' = gomafia_id::text
      ORDER BY created_at LIMIT ${limit}
    `)
    return found.map(toUser)
  }

  async clubRequest(userId: string): Promise<StoredClubRequest | null> {
    if (!UUID.test(userId)) return null
    const row = await this.one(sql`SELECT * FROM mb_club_requests WHERE user_id = ${userId}::uuid`)
    return row ? toClubRequest(row) : null
  }

  async setClubRequest(userId: string, request: { nickname: string; at: Date } | null): Promise<void> {
    if (!UUID.test(userId)) return
    if (!request) {
      await this.query(sql`DELETE FROM mb_club_requests WHERE user_id = ${userId}::uuid`)
      return
    }
    await this.query(sql`
      INSERT INTO mb_club_requests (user_id, nickname, created_at)
      VALUES (${userId}::uuid, ${request.nickname}, ${iso(request.at)}::timestamptz)
      ON CONFLICT (user_id) DO UPDATE SET nickname = EXCLUDED.nickname, created_at = EXCLUDED.created_at
    `)
  }

  async clubRequestsByNicknames(nicknames: string[]): Promise<StoredClubRequest[]> {
    const names = [...new Set(nicknames.map((name) => name.trim().toLowerCase()).filter(Boolean))]
    if (names.length === 0) return []
    const found = await this.query(sql`
      SELECT * FROM mb_club_requests
      WHERE lower(nickname) IN (${sql.join(names.map((name) => sql`${name}`), sql`, `)})
      ORDER BY created_at, user_id
    `)
    return found.map(toClubRequest)
  }

  // ─── Titan Connect ─────────────────────────────────────────────────────────

  async setTitanLink(userId: string, link: TitanLinkState | null): Promise<MafboardUser | null> {
    if (!UUID.test(userId)) return null
    const row = await this.one(sql`
      UPDATE mb_users SET titan_link = ${link ? JSON.stringify(link) : null}::jsonb, updated_at = now()
      WHERE id = ${userId}::uuid RETURNING *
    `)
    return row ? toUser(row) : null
  }

  async titanMatches(apiBase: string): Promise<Map<string, number | null>> {
    const found = await this.query(sql`SELECT client_id, gomafia_id FROM mb_titan_matches WHERE api_base = ${apiBase}`)
    return new Map(found.map((row) => [String(row['client_id']), num(row['gomafia_id'])]))
  }

  async setTitanMatch(
    apiBase: string,
    clientId: string,
    match: { goMafiaId: number | null; userId: string; at: Date } | null,
  ): Promise<void> {
    if (!match) {
      await this.query(sql`DELETE FROM mb_titan_matches WHERE api_base = ${apiBase} AND client_id = ${clientId}`)
      return
    }
    await this.query(sql`
      INSERT INTO mb_titan_matches (api_base, client_id, gomafia_id, set_by, set_at)
      VALUES (${apiBase}, ${clientId}, ${match.goMafiaId}, ${match.userId}::uuid, ${iso(match.at)}::timestamptz)
      ON CONFLICT (api_base, client_id) DO UPDATE
        SET gomafia_id = EXCLUDED.gomafia_id, set_by = EXCLUDED.set_by, set_at = EXCLUDED.set_at
    `)
  }

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
    const qrTickets = await this.query(sql`DELETE FROM mb_qr_tickets WHERE expires_at < ${iso(before)}::timestamptz RETURNING id`)
    // Токены истёкшей сессии удаляются каскадом; отдельно — старые токены живых сессий.
    const sessions = await this.query(sql`DELETE FROM mb_sessions WHERE expires_at < ${iso(before)}::timestamptz RETURNING id`)
    const tokens = await this.query(sql`DELETE FROM mb_refresh_tokens WHERE expires_at < ${iso(before)}::timestamptz RETURNING token_hash`)
    return { tickets: tickets.length + qrTickets.length, sessions: sessions.length, refreshTokens: tokens.length }
  }

  // ─── Билеты входа в MBS по QR ──────────────────────────────────────────────

  async createQrTicket(input: Parameters<MafboardRepo['createQrTicket']>[0]): Promise<QrTicket> {
    const row = await this.one(sql`
      INSERT INTO mb_qr_tickets (scan_code, confirm_code, choice_codes, device_secret_hash, device_name, platform, expires_at)
      VALUES (${input.scanCode}, ${input.confirmCode}, ${JSON.stringify(input.choiceCodes)}::jsonb, ${input.deviceSecretHash},
              ${input.deviceName}, ${input.platform}, ${iso(input.expiresAt)}::timestamptz)
      RETURNING *
    `)
    if (!row) throw new Error('[mafboard] билет QR не создан')
    return toQrTicket(row)
  }

  async qrTicketById(id: string): Promise<QrTicket | null> {
    if (!UUID.test(id)) return null
    const row = await this.one(sql`SELECT * FROM mb_qr_tickets WHERE id = ${id}::uuid`)
    return row ? toQrTicket(row) : null
  }

  async qrTicketByScan(scanCode: string): Promise<QrTicket | null> {
    const row = await this.one(sql`SELECT * FROM mb_qr_tickets WHERE scan_code = ${scanCode}`)
    return row ? toQrTicket(row) : null
  }

  async decideQrTicket(scanCode: string, code: string, userId: string, now: Date): Promise<QrTicket | null> {
    if (!UUID.test(userId)) return null
    const row = await this.one(sql`
      UPDATE mb_qr_tickets SET
        status = CASE WHEN confirm_code = ${code} THEN 'confirmed' ELSE 'rejected' END,
        user_id = CASE WHEN confirm_code = ${code} THEN ${userId}::uuid ELSE NULL END
      WHERE scan_code = ${scanCode} AND status = 'pending' AND expires_at > ${iso(now)}::timestamptz
      RETURNING *
    `)
    return row ? toQrTicket(row) : null
  }

  async claimQrTicket(id: string, deviceSecretHash: string, now: Date): Promise<QrTicket | null> {
    if (!UUID.test(id)) return null
    const row = await this.one(sql`
      UPDATE mb_qr_tickets SET status = 'claimed', claimed_at = ${iso(now)}::timestamptz
      WHERE id = ${id}::uuid AND status = 'confirmed'
        AND expires_at > ${iso(now)}::timestamptz AND device_secret_hash = ${deviceSecretHash}
      RETURNING *
    `)
    return row ? toQrTicket(row) : null
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
      SELECT t.token_hash, t.user_id, t.session_id, t.expires_at, t.revoked_at,
             s.revoked_at AS session_revoked_at, s.platform AS session_platform
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
          sessionPlatform: str(row['session_platform']),
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
      INSERT INTO mb_games (id, host_user_id, club_id, club_ref, format, variant, started_at, finished_at, schema_version, record)
      VALUES (${game.id}::uuid, ${game.hostUserId}::uuid, ${game.clubId},
              COALESCE(${game.clubRef ?? null}::uuid, (SELECT id FROM mb_clubs WHERE gomafia_club_id = ${game.clubId}::integer)),
              ${game.format}, ${game.variant},
              ${iso(game.startedAt)}::timestamptz, ${iso(game.finishedAt)}::timestamptz, ${game.schemaVersion},
              ${JSON.stringify(game.record)}::jsonb)
      ON CONFLICT (id) DO UPDATE
        SET club_id = EXCLUDED.club_id, club_ref = EXCLUDED.club_ref, format = EXCLUDED.format, variant = EXCLUDED.variant,
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


  async studioSettings(userId: string): Promise<StoredStudioSettings | null> {
    if (!UUID.test(userId)) return null
    const row = await this.one(sql`SELECT * FROM mb_studio_settings WHERE user_id = ${userId}::uuid`)
    return row ? toStudioSettings(row) : null
  }

  async saveStudioSettings(input: Parameters<MafboardRepo['saveStudioSettings']>[0]) {
    const saved = await this.query(sql`
      INSERT INTO mb_studio_settings (user_id, revision, updated_at, document, secrets)
      VALUES (${input.userId}::uuid, ${input.baseRevision + 1}, ${iso(input.updatedAt)}::timestamptz,
              ${JSON.stringify(input.document)}::jsonb, ${input.secrets})
      ON CONFLICT (user_id) DO UPDATE
        SET revision = mb_studio_settings.revision + 1, updated_at = EXCLUDED.updated_at,
            document = EXCLUDED.document, secrets = EXCLUDED.secrets
        WHERE mb_studio_settings.revision = ${input.baseRevision}
      RETURNING revision
    `)
    if (saved.length > 0) return { saved: true as const, revision: Number(saved[0]!['revision']) }
    return { saved: false as const, current: await this.studioSettings(input.userId) }
  }

  async upsertProtocolSubmission(input: Parameters<MafboardRepo['upsertProtocolSubmission']>[0]): Promise<StoredProtocolSubmission> {
    const rows = await this.query(sql`
      INSERT INTO mb_tournament_protocols (id, tournament_id, tournament_title, game_number, table_number, referee_user_id,
        referee_name, reviewer_gomafia_id, protocol, status, created_at, updated_at)
      VALUES (${input.id}::uuid, ${input.tournamentId}, ${input.tournamentTitle}, ${input.gameNumber}, ${input.tableNumber},
        ${input.refereeUserId}::uuid, ${input.refereeName}, ${input.reviewerGomafiaId}, ${JSON.stringify(input.protocol)}::jsonb,
        'pending', ${iso(input.at)}::timestamptz, ${iso(input.at)}::timestamptz)
      ON CONFLICT (tournament_id, game_number, table_number, referee_user_id) DO UPDATE
        SET protocol = EXCLUDED.protocol, status = 'pending', reason = NULL, decided_by = NULL,
            tournament_title = EXCLUDED.tournament_title, referee_name = EXCLUDED.referee_name,
            reviewer_gomafia_id = EXCLUDED.reviewer_gomafia_id, updated_at = EXCLUDED.updated_at
      RETURNING *
    `)
    return toSubmission(rows[0]!)
  }

  async protocolSubmissions(tournamentId: number, filter: { status?: StoredProtocolSubmission['status']; refereeUserId?: string }) {
    if (filter.refereeUserId && !UUID.test(filter.refereeUserId)) return []
    const rows = await this.query(sql`
      SELECT * FROM mb_tournament_protocols
      WHERE tournament_id = ${tournamentId}
        AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
        AND (${filter.refereeUserId ?? null}::uuid IS NULL OR referee_user_id = ${filter.refereeUserId ?? null}::uuid)
      ORDER BY game_number, table_number, updated_at
    `)
    return rows.map(toSubmission)
  }

  async decideProtocolSubmission(id: string, decision: Parameters<MafboardRepo['decideProtocolSubmission']>[1]) {
    if (!UUID.test(id)) return null
    const rows = await this.query(sql`
      UPDATE mb_tournament_protocols
        SET status = ${decision.status}, reason = ${decision.reason}, protocol = ${JSON.stringify(decision.protocol)}::jsonb,
            decided_by = ${decision.decidedBy}::uuid, updated_at = ${iso(decision.at)}::timestamptz
      WHERE id = ${id}::uuid AND status = 'pending'
      RETURNING *
    `)
    return rows[0] ? toSubmission(rows[0]) : null
  }

  async protocolSubmissionById(id: string) {
    if (!UUID.test(id)) return null
    const row = await this.one(sql`SELECT * FROM mb_tournament_protocols WHERE id = ${id}::uuid`)
    return row ? toSubmission(row) : null
  }

  async saveShare(input: StoredShare): Promise<StoredShare> {
    const rows = await this.query(sql`
      INSERT INTO mb_shares (token, user_id, game_id, snapshot, created_at)
      VALUES (${input.token}, ${input.userId}::uuid, ${input.gameId}::uuid, ${JSON.stringify(input.snapshot)}::jsonb, ${iso(input.createdAt)}::timestamptz)
      ON CONFLICT (user_id, game_id) DO UPDATE SET snapshot = EXCLUDED.snapshot
      RETURNING *
    `)
    return toShare(rows[0]!)
  }

  async shareByToken(token: string) {
    const row = await this.one(sql`SELECT * FROM mb_shares WHERE token = ${token}`)
    return row ? toShare(row) : null
  }

  async gomafiaCredentials(userId: string): Promise<string | null> {
    if (!UUID.test(userId)) return null
    const row = await this.one(sql`SELECT sealed FROM mb_gomafia_credentials WHERE user_id = ${userId}::uuid`)
    return row ? String(row['sealed']) : null
  }

  async setGomafiaCredentials(userId: string, sealed: string | null, at: Date): Promise<void> {
    if (!UUID.test(userId)) return
    if (sealed === null) {
      await this.query(sql`DELETE FROM mb_gomafia_credentials WHERE user_id = ${userId}::uuid`)
      return
    }
    await this.query(sql`
      INSERT INTO mb_gomafia_credentials (user_id, sealed, updated_at)
      VALUES (${userId}::uuid, ${sealed}, ${iso(at)}::timestamptz)
      ON CONFLICT (user_id) DO UPDATE SET sealed = EXCLUDED.sealed, updated_at = EXCLUDED.updated_at
    `)
  }

  async aimCredentials(userId: string): Promise<string | null> {
    if (!UUID.test(userId)) return null
    const row = await this.one(sql`SELECT sealed FROM mb_aim_credentials WHERE user_id = ${userId}::uuid`)
    return row ? String(row['sealed']) : null
  }

  async setAimCredentials(userId: string, sealed: string | null, at: Date): Promise<void> {
    if (!UUID.test(userId)) return
    if (sealed === null) {
      await this.query(sql`DELETE FROM mb_aim_credentials WHERE user_id = ${userId}::uuid`)
      return
    }
    await this.query(sql`
      INSERT INTO mb_aim_credentials (user_id, sealed, updated_at)
      VALUES (${userId}::uuid, ${sealed}, ${iso(at)}::timestamptz)
      ON CONFLICT (user_id) DO UPDATE SET sealed = EXCLUDED.sealed, updated_at = EXCLUDED.updated_at
    `)
  }

}
