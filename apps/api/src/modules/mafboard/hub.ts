// Titan HUB как источник игроков для подбора. MafBoard — платформа для разных клубов, и HUB есть
// не у всех: клуб попадает сюда, только если в его HUB указан его клуб GoMafia (интеграция
// `gomafia_club_id`). Тогда клиенты этого HUB идут в подборе ведущего первыми.

export interface ClubHub {
  /** Ники клиентов HUB клуба GoMafia `goMafiaClubId`, подходящие под запрос, в нижнем регистре. Нет HUB — пусто. */
  nicknames(goMafiaClubId: number, query: string): Promise<Set<string>>
}

export const noHub: ClubHub = {
  async nicknames() {
    return new Set()
  },
}

// Рабочая реализация — `hubLive.ts`: она грузит базы HUB и подключается только при запуске сервера.
