import type { ReplyMarkup } from '../../lib/tgBot.js'
import type { TgCallbackQuery, TgMessage, TgUser } from '../tg/types.js'
import type { BotMessenger } from './bot.js'
import type { PhotoStore } from './photos.js'
import type { MafboardRepo } from './repo.js'
import type { RateLimiter } from './router.js'
import { sha256 } from './tokens.js'
import type { StoredClubApplication } from './types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Клубы в боте MafBoard (docs/MAFBOARD.md, «Клуб без подключений»):
//   • заявка на клуб приходит владельцу платформы (MAFBOARD_ADMIN_TG_ID) с кнопками [Одобрить] [Отклонить];
//   • ссылка игрока t.me/<бот>?start=p_<токен> привязывает Telegram к игроку клуба (одноразовая, 7 дней);
//   • фото от привязанного игрока становится его фото во всех клубах, где он привязан: человек один.
// ─────────────────────────────────────────────────────────────────────────────

export const PLAYER_LINK_PREFIX = 'p_'
const CALLBACK_PREFIX = 'mbc:'
const PHOTOS_PER_HOUR = 10
const LINKS_PER_HOUR = 20
/** Telegram присылает несколько размеров фото; для аватара хватает стороны 1280. */
const PHOTO_MAX_SIDE = 1280

export interface ClubBotDeps {
  repo: MafboardRepo
  messenger: BotMessenger
  images: PhotoStore
  limiter: RateLimiter
  adminTgId: number | null
  now: () => Date
}

const TEXT = {
  notAdmin: 'Заявки на клубы решает владелец MafBoard',
  decided: 'Заявка уже решена',
  approvedAdmin: (name: string) => `✅ Клуб «${name}» создан.`,
  rejectedAdmin: (name: string) => `Заявка на клуб «${name}» отклонена.`,
  approved: (name: string) => `✅ Клуб «${name}» создан — вы его владелец.\n\nОткройте MafBoard: клуб появится в профиле. Там же можно завести игроков и пригласить судей.`,
  rejected: (name: string) => `Заявку на клуб «${name}» отклонили. Если это ошибка — напишите владельцу MafBoard.`,
  linkMissing: 'Ссылка не найдена. Попросите судью клуба прислать новую.',
  linkExpired: 'Ссылка уже использована или устарела. Попросите судью клуба прислать новую.',
  linked: (club: string, nickname: string | null) =>
    `Готово! Вы — ${nickname ? `игрок «${nickname}»` : 'игрок'} клуба «${club}».\n\n` +
    'Пришлите сюда своё фото — оно появится в MafBoard и в эфире клуба. Сменить фото можно в любой момент: просто пришлите новое.',
  noPlayer: 'Фото сюда присылают игроки клуба. Попросите судью клуба ссылку «для игрока» и откройте её.',
  photoHint: 'Пришлите фото одним сообщением — оно станет вашим фото в клубе.',
  tooMany: 'Слишком много попыток, попробуйте через час.',
  photoFailed: 'Не удалось получить фото. Попробуйте прислать его ещё раз.',
  photoSaved: (clubs: string[]) => `Фото обновлено ✅\n\nКлуб${clubs.length > 1 ? 'ы' : ''}: ${clubs.map((name) => `«${name}»`).join(', ')}.`,
} as const

export function isClubCallback(data: string | undefined): boolean {
  return data?.startsWith(CALLBACK_PREFIX) ?? false
}

/** Кнопки заявки в сообщении владельцу платформы. */
export function applicationMarkup(applicationId: string): ReplyMarkup {
  return {
    inline_keyboard: [[
      { text: 'Одобрить', callback_data: `${CALLBACK_PREFIX}app:${applicationId}:approve` },
      { text: 'Отклонить', callback_data: `${CALLBACK_PREFIX}app:${applicationId}:reject` },
    ]],
  }
}

/** Решение по заявке: только владелец платформы; повторное нажатие ничего не меняет. */
export async function onClubCallback(query: TgCallbackQuery, deps: ClubBotDeps): Promise<void> {
  const [kind, id, decision] = (query.data ?? '').slice(CALLBACK_PREFIX.length).split(':')
  if (kind !== 'app' || !id || (decision !== 'approve' && decision !== 'reject')) return deps.messenger.answerCallback(query.id)
  if (deps.adminTgId == null || query.from.id !== deps.adminTgId) return deps.messenger.answerCallback(query.id, TEXT.notAdmin)

  if (decision === 'approve') {
    const result = await deps.repo.approveClubApplication(id, deps.now())
    if (!result) return deps.messenger.answerCallback(query.id, TEXT.decided)
    await deps.messenger.answerCallback(query.id, 'Клуб создан')
    await deps.messenger.send(query.from.id, TEXT.approvedAdmin(result.club.name))
    return notifyApplicant(deps, result.application, TEXT.approved(result.club.name))
  }
  const rejected = await deps.repo.rejectClubApplication(id, deps.now())
  if (!rejected) return deps.messenger.answerCallback(query.id, TEXT.decided)
  await deps.messenger.answerCallback(query.id, 'Отклонено')
  await deps.messenger.send(query.from.id, TEXT.rejectedAdmin(rejected.name))
  return notifyApplicant(deps, rejected, TEXT.rejected(rejected.name))
}

async function notifyApplicant(deps: ClubBotDeps, application: StoredClubApplication, text: string): Promise<void> {
  const user = await deps.repo.userById(application.userId)
  if (user && user.tgId > 0) await deps.messenger.send(user.tgId, text)
}

/** `/start p_<токен>`: привязать этот Telegram к игроку клуба. */
export async function onPlayerLinkStart(from: TgUser, token: string, deps: ClubBotDeps): Promise<void> {
  if (!(await deps.limiter.hit(`mb:player:link:${from.id}`, LINKS_PER_HOUR, 3600, { failClosed: true }))) {
    return deps.messenger.send(from.id, TEXT.tooMany)
  }
  const link = await deps.repo.usePlayerLinkToken(sha256(token), from.id, deps.now())
  if (link === null) return deps.messenger.send(from.id, TEXT.linkMissing)
  if (link === 'expired') return deps.messenger.send(from.id, TEXT.linkExpired)
  const [club, own] = await Promise.all([deps.repo.clubById(link.clubId), deps.repo.clubPlayers(link.clubId, true)])
  const nickname = own.find((player) => player.playerId === link.playerId)?.nickname ?? null
  await deps.messenger.send(from.id, TEXT.linked(club?.name ?? 'клуба', nickname))
}

/** `/photo` — подсказка привязанному игроку, остальным — как получить ссылку. */
export async function onPhotoCommand(from: TgUser, deps: ClubBotDeps): Promise<void> {
  const links = await deps.repo.playerLinksByTg(from.id)
  await deps.messenger.send(from.id, links.length > 0 ? TEXT.photoHint : TEXT.noPlayer)
}

/** Самый большой размер не шире `PHOTO_MAX_SIDE`; если все больше — самый маленький из них. */
export function pickPhotoSize<T extends { file_id: string; width?: number; height?: number }>(sizes: T[]): T | null {
  if (sizes.length === 0) return null
  const side = (size: T) => Math.max(size.width ?? 0, size.height ?? 0)
  const fitting = sizes.filter((size) => side(size) <= PHOTO_MAX_SIDE)
  if (fitting.length > 0) return fitting.reduce((best, size) => (side(size) > side(best) ? size : best))
  return sizes.reduce((best, size) => (side(size) < side(best) ? size : best))
}

/** Фото от игрока: ставится ему во всех клубах, где этот Telegram привязан. */
export async function onPlayerPhoto(message: TgMessage, from: TgUser, deps: ClubBotDeps): Promise<void> {
  const links = await deps.repo.playerLinksByTg(from.id)
  if (links.length === 0) return deps.messenger.send(from.id, TEXT.noPlayer)
  if (!(await deps.limiter.hit(`mb:player:photo:${from.id}`, PHOTOS_PER_HOUR, 3600))) {
    return deps.messenger.send(from.id, TEXT.tooMany)
  }
  const size = pickPhotoSize(message.photo ?? [])
  const data = size ? await deps.messenger.download(size.file_id) : null
  if (!data) return deps.messenger.send(from.id, TEXT.photoFailed)
  const stored = await deps.images.store(data)
  if (!stored.ok) return deps.messenger.send(from.id, stored.status === 400 ? stored.error : TEXT.photoFailed)

  const at = deps.now()
  await Promise.all(links.map((link) => deps.repo.setPlayerPhoto({
    clubId: link.clubId, playerId: link.playerId, url: stored.url, setByUser: null, setByTg: from.id, setAt: at,
  })))
  const clubs = await Promise.all(links.map((link) => deps.repo.clubById(link.clubId)))
  await deps.messenger.send(from.id, TEXT.photoSaved(clubs.flatMap((club) => (club ? [club.name] : []))))
}
