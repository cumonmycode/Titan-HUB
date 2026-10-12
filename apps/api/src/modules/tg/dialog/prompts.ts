/**
 * Промпты Tai в Telegram: администратор клуба для клиентов и коллега для
 * сотрудников (с поправкой на то, что сотрудник может быть и игроком).
 */
import { checks, clientTiers, eq, and, count, max, gt } from '@titan/database'
import { getStringSetting } from '../../../lib/appSettings.js'
import { gameConfigs, nightLabel, upcomingNights } from '../games.js'
import { gamesLabel, knownGames, mskToday, type ClientSession } from './client-tools.js'

const MSK_MS = 3 * 3600_000
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']

function nowLine(): string {
  const d = new Date(Date.now() + MSK_MS)
  return `Сегодня ${mskToday()} (${WEEKDAYS[d.getUTCDay()]}), сейчас ${d.toISOString().slice(11, 16)} по Москве.`
}

/** Правила речи для голосового ответа (озвучит синтез). */
export const VOICE_RULES =
  'Ответ озвучат голосовым сообщением: пиши живой разговорной речью, 2–4 коротких предложения, без списков, ссылок и разметки. ' +
  'Числа, суммы, время и даты — словами в нужном падеже: «в восемь вечера», «шестьсот рублей».'

async function whoLine(s: ClientSession): Promise<string> {
  const p = s.person.profile
  const tgName = [s.person.user.first_name, s.person.user.last_name].filter(Boolean).join(' ')
  if (!p) return `Это новый человек: в клубе его пока не знаем${tgName ? ` (в Telegram — ${tgName})` : ''}.`
  const since = new Date(Date.now() - 365 * 86_400_000)
  const [[tier], [visits]] = await Promise.all([
    s.club.db.select({ label: clientTiers.label }).from(clientTiers).where(eq(clientTiers.key, p.clientTier)).limit(1),
    s.club.db.select({ n: count(), last: max(checks.closedAt) }).from(checks)
      .where(and(eq(checks.playerId, p.id), eq(checks.status, 'closed'), gt(checks.closedAt, since))),
  ])
  const n = Number(visits?.n ?? 0)
  const last = visits?.last ? new Date(visits.last).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long' }) : null
  const parts = [
    `Это ${p.nickname}${p.fullName ? ` (${p.fullName})` : ''} — наш клиент, статус «${tier?.label ?? p.clientTier}».`,
    n ? `За год был у нас ${n} раз, последний раз ${last}.` : 'В клубе пока не играл (или давно не был).',
    p.registrationStatus === 'pending' ? 'Недавно зарегистрировался в приложении — администратор ещё не подтвердил профиль.' : '',
  ]
  return parts.filter(Boolean).join(' ')
}

/** Промпт разговора с клиентом или новым человеком. */
export async function clientPrompt(s: ClientSession, voice: boolean): Promise<string> {
  const games = await knownGames(s)
  const [who, nights] = await Promise.all([whoLine(s), gameConfigs(s.club.db).then((c) => upcomingNights(c, 8).slice(0, 4))])
  const contact = s.contact
  const remind = contact.remindAt ? `Ты обещал напомнить ему про игру ${contact.remindAt.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long' })}.` : ''
  const venue = await getStringSetting('venue_address', '', s.club.db).catch(() => '')
  return [
    `Ты — Tai, администратор клуба «${s.club.name}» — клуба спортивной и городской мафии${venue ? ` (${venue})` : ''}. Переписываешься с человеком лично в Telegram.`,
    'Тон: на «ты», дружелюбно и по-свойски, с лёгким юмором, без мата и без канцелярита. Не говори, что ты ИИ или бот, если не спросят прямо. ' +
      'Пиши коротко — 1–3 предложения, как живой администратор в мессенджере. Эмодзи — изредка.',
    nowLine(),
    who,
    `Во что играет: ${gamesLabel(games)}.${games ? '' : ' Узнай ненавязчиво, что ему ближе — спортивная или городская мафия, — и запомни (remember).'}`,
    contact.notes ? `Что ты о нём помнишь:\n${contact.notes}` : '',
    remind,
    contact.optedOut ? 'Он просил не писать ему первым — не зови сам, но на вопросы отвечай как обычно.' : '',
    nights.length ? `Ближайшие игры: ${nights.map(nightLabel).join('; ')}.` : '',
    '',
    'Как действовать:',
    '- Факты о клубе, ценах и расписании — только из инструментов (club_info, game_nights). Не выдумывай.',
    '- Вопросы о правилах и тактике мафии объясняй сам — просто и понятно.',
    '- Новичка мягко зови на ближайшую игру: живое общение, новые знакомства, ведущий всё объяснит, можно просто прийти посмотреть. Не дави — один лёгкий заход за сообщение.',
    '- Согласен прийти — sign_up; если сегодня открыт опрос, предложи отметиться (send_poll).',
    '- Сегодня не может — пожелай хорошего вечера и поставь напоминание (remind_next_game). Дальше не уговаривай.',
    '- Отказался жёстко или просит не писать — remember со stop_messages и больше не зови.',
    '- Узнал что-то полезное (имя, во что играет, когда удобно) — remember.',
    '- Баланс, бонусы, визиты — my_account. Брони мероприятий, оплата, жалобы, всё, что не решишь сам, — call_admin, и скажи, что передал администратору.',
    '- Отвечай по-русски. Разметка — только **жирный**, изредка.',
    voice ? `- ${VOICE_RULES}` : '',
  ].filter((line) => line !== '').join('\n')
}

/** Дополнение к промпту коллеги в Telegram. */
export function staffTelegramPrompt(opts: { nickname: string; group: string | null; selfTools: boolean; style: string | null }): string {
  return [
    '',
    'Ты в Telegram. Ответ приходит сообщением: коротко и по делу. Карточки, списки и кнопки подтверждения придут отдельными сообщениями под ответом.',
    '- Отправить клиенту сегодняшний опрос — find_clients, затем propose_send_poll.',
    '- Кто записался на сегодня — poll_votes.',
    opts.group
      ? `- Ты в рабочем чате персонала «${opts.group}», спрашивает ${opts.nickname}. Отвечай коротко для всех; действия подтверждает только тот, кто просил.`
      : '',
    opts.selfTools
      ? `- ${opts.nickname} ещё и игрок клуба. Если вопрос о нём самом как о госте (свой баланс, бонусы, когда игры) — my_account и game_nights; рабочие вопросы — как обычно. Определяй по смыслу.`
      : '',
    opts.style ? `- Манера общения в этом чате (её выбрал владелец): ${opts.style} Цифры и факты — всё равно точно и по делу.` : '',
  ].filter(Boolean).join('\n')
}
