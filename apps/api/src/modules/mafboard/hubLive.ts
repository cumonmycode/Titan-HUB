import { db as defaultDb, getClubDb, profiles, ilike, and, ne, type Database } from '@titan/database'
import { getClubIntegration } from '../../lib/secrets.js'
import type { ClubHub } from './hub.js'

const DIRECTORY_TTL_MS = 10 * 60_000
const MATCH_LIMIT = 40
const K_CLUB = 'gomafia_club_id'

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/**
 * Все базы HUB: основная и базы активных клубов. Control-БД недоступна — только основная.
 * Реестр клубов грузится лениво: модуль MafBoard и его тесты без него не нуждаются в control-плоскости.
 */
async function liveDatabases(): Promise<Database[]> {
  const { buildClubConnString, listActiveClubDbNames } = await import('../../lib/clubResolver.js')
  const names = await listActiveClubDbNames().catch(() => [] as string[])
  return [defaultDb, ...names.map((name) => getClubDb(buildClubConnString(name)))]
}

/** Справочник «клуб GoMafia → база HUB» с кэшем на 10 минут: интеграции меняются редко. */
export class TitanHubDirectory implements ClubHub {
  private directory: { at: number; byClub: Map<number, Database> } | null = null

  constructor(
    private readonly databases: () => Promise<Database[]> = liveDatabases,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async nicknames(goMafiaClubId: number, query: string): Promise<Set<string>> {
    const hub = (await this.byClub()).get(goMafiaClubId)
    const needle = query.trim()
    if (!hub || !needle) return new Set()
    const rows = await hub
      .select({ nickname: profiles.nickname })
      .from(profiles)
      .where(and(ilike(profiles.nickname, `%${escapeLike(needle)}%`), ne(profiles.role, 'tablet')))
      .limit(MATCH_LIMIT)
    return new Set(rows.map((row) => row.nickname.toLowerCase()))
  }

  private async byClub(): Promise<Map<number, Database>> {
    if (this.directory && this.now() - this.directory.at < DIRECTORY_TTL_MS) return this.directory.byClub
    const byClub = new Map<number, Database>()
    for (const database of await this.databases()) {
      const raw = await getClubIntegration(database, K_CLUB).catch(() => null)
      const id = raw != null && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : null
      if (id != null && !byClub.has(id)) byClub.set(id, database)
    }
    this.directory = { at: this.now(), byClub }
    return byClub
  }
}
