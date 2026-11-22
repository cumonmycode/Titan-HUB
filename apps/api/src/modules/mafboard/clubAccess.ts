import type { MafboardRepo } from './repo.js'
import type { ClubAccess, ClubRole, StoredClub, TitanLinkState } from './types.js'

// Клубы пользователя и его роль в каждом (docs/MAFBOARD.md, раздел «Клубы»). Два источника: клуб GoMafia
// (президент → владелец, судья пула → судья; права считает GoMafia, clubHosts.ts) и записи членства
// `mb_club_members` — владелец клуба без GoMafia и судьи, вступившие по приглашению.

/** Клуб пользователя: запись клуба, роль и действующее подключение Titan. */
export interface ClubMembership {
  club: StoredClub
  role: ClubRole
  titan: TitanLinkState | null
}

/** Что уже известно о клубе GoMafia пользователя из `hostAccess`. */
export interface GoMafiaClubAccess {
  club: ClubAccess
  mafboardClub: StoredClub | null
  titan: TitanLinkState | null
}

/**
 * Все клубы пользователя, клуб GoMafia первым. Состоит и там, и по записи — один клуб с более сильной ролью.
 * Записи членства не прочитались (таблицы ещё нет) — только клуб GoMafia, как до членства.
 */
export async function memberClubs(repo: MafboardRepo, userId: string, gomafia: GoMafiaClubAccess): Promise<ClubMembership[]> {
  const clubs: ClubMembership[] = []
  if (gomafia.mafboardClub && gomafia.club !== 'none') {
    clubs.push({ club: gomafia.mafboardClub, role: gomafia.club === 'president' ? 'owner' : 'judge', titan: gomafia.titan })
  }
  let rows: Awaited<ReturnType<MafboardRepo['membershipsOf']>>
  try {
    rows = await repo.membershipsOf(userId)
  } catch (error) {
    console.warn('[mafboard] членство в клубах не прочитано:', error)
    return clubs
  }
  for (const row of rows) {
    const known = clubs.find((entry) => entry.club.id === row.clubId)
    if (known) {
      if (row.role === 'owner') known.role = 'owner'
      continue
    }
    const club = await repo.clubById(row.clubId).catch(() => null)
    if (club) clubs.push({ club, role: row.role, titan: club.titan })
  }
  return clubs
}
