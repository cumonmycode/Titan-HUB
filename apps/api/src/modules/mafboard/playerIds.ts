import { randomBytes } from 'node:crypto'
import { TITAN_PLAYER_ID } from './titan.js'

// Номера игроков приложения (PlayerID): UUIDv8 с префиксом «mafb» и видом игрока, как в MafBoardCore.
//   «mafbgm» — игрок GoMafia (номер GoMafia в конце), постоянный на всех устройствах;
//   «mafbtc» — клиент клуба Titan HUB (titan.ts);
//   «mafbcp» — свой игрок клуба MafBoard: случайные 48 бит, выдаёт сервер при создании.

/** PlayerID игрока GoMafia в приложении: UUID с префиксом «mafbgm» (PlayerID.goMafia). */
export const GOMAFIA_PLAYER_ID = /^6d616662-676d-8000-8000-[0-9a-f]{12}$/i

/** PlayerID своего игрока клуба: UUID с префиксом «mafbcp» (PlayerID.clubPlayer). */
export const CLUB_PLAYER_ID = /^6d616662-6370-8000-8000-[0-9a-f]{12}$/i

export { TITAN_PLAYER_ID }

export function newClubPlayerID(): string {
  return `6d616662-6370-8000-8000-${randomBytes(6).toString('hex')}`
}

/** Номер вида, которому вообще может принадлежать фото в клубе: GoMafia, Titan или свой игрок. */
export function isKnownPlayerID(id: string): boolean {
  return GOMAFIA_PLAYER_ID.test(id) || TITAN_PLAYER_ID.test(id) || CLUB_PLAYER_ID.test(id)
}
