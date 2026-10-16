import { randomInt } from 'node:crypto'
import type { ReplyMarkup } from '../../lib/tgBot.js'
import type { TgCallbackQuery, TgMessage, TgUpdate, TgUser } from '../tg/types.js'
import type { MafboardConfig } from './config.js'
import type { MafboardRepo } from './repo.js'
import { normalizePhone, returnLink } from './serialize.js'
import { decoyCodes } from './tokens.js'
import type { LoginTicket, MafboardUser, TicketGuard } from './types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Бот входа MafBoard. Сценарий по ссылке t.me/<бот>?start=login_<код> из приложения:
//   1. пользовательское соглашение  [Принимаю] [Отказаться]
//   2. номер телефона               (reply-кнопка request_contact, только свой контакт)
//   3. подтверждение входа          три кнопки с кодами + [Это не я]: нажать код,
//      который показан в приложении (сверка кода — защита от фишинга чужой ссылкой)
//   4. кнопка «Вернуться в MafBoard» — Universal Link <appLinkBase>/auth/return?ticket=<id>
// Уже принятое соглашение и известный номер пропускаются. Первый Telegram, открывший
// ссылку, закрепляется за билетом — с другого аккаунта ею не войти. Все изменения
// билета — условные (pending + этот Telegram), поэтому гонки двух аккаунтов безопасны.
// ─────────────────────────────────────────────────────────────────────────────

/** Отправка сообщений ботом. В проде — TgBot, в тестах — запись в массив. */
export interface BotMessenger {
  send(chatId: number, text: string, markup?: ReplyMarkup): Promise<void>
  answerCallback(callbackId: string, text?: string): Promise<void>
  username(): Promise<string | null>
}

export interface BotDeps {
  repo: MafboardRepo
  messenger: BotMessenger
  config: Pick<MafboardConfig, 'appLinkBase' | 'termsUrl' | 'termsVersion'>
  now: () => Date
}

const LOGIN_PREFIX = 'login_'
const CALLBACK_PREFIX = 'mb:'
const ACTIONS = ['terms', 'decline', 'code', 'reject'] as const
type CallbackAction = (typeof ACTIONS)[number]

const TEXT = {
  welcome: 'Это бот входа в MafBoard — приложение для ведущих мафии.\n\nОткройте приложение и нажмите «Войти через Telegram».',
  expired: 'Ссылка для входа устарела. Вернитесь в приложение MafBoard и начните вход заново.',
  foreign: 'Эта ссылка уже открыта в другом аккаунте Telegram. Начните вход в приложении заново.',
  terms: (url: string) =>
    'Добро пожаловать в MafBoard!\n\n' +
    `Перед входом примите пользовательское соглашение: ${url}\n\n` +
    'Нажимая «Принимаю», вы соглашаетесь с условиями и с обработкой ваших данных: номера телефона и профиля Telegram.',
  contact: 'Поделитесь номером телефона кнопкой ниже — так мы защитим ваш аккаунт.',
  foreignContact: 'Нужен ваш собственный номер — отправьте его кнопкой «Поделиться номером».',
  badPhone: 'Не удалось распознать номер. Попробуйте ещё раз кнопкой ниже.',
  phoneSaved: 'Номер получен ✅',
  confirm: (device: string, platform: string) =>
    `Подтвердите вход в MafBoard на устройстве «${device}» (${platform}).\n\n` +
    'Нажмите код, который сейчас показан в приложении. Если вы не начинали вход — нажмите «Это не я».',
  confirmed: 'Вход подтверждён ✅\n\nВернитесь в приложение — кнопка ниже.',
  wrongCode: 'Код не совпал — вход отменён. Если входили вы, начните вход в приложении заново.',
  rejected: 'Вход отменён. Если это были не вы — просто проигнорируйте это сообщение.',
  declined: 'Без согласия с соглашением войти нельзя. Передумаете — начните вход в приложении заново.',
  noLogin: 'Активного входа нет. Откройте приложение MafBoard и нажмите «Войти через Telegram».',
} as const

const contactKeyboard: ReplyMarkup = {
  keyboard: [[{ text: '📱 Поделиться номером', request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
}

function inline(rows: { text: string; data?: string; url?: string }[][]): ReplyMarkup {
  return {
    inline_keyboard: rows.map((row) =>
      row.map((b) => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data ?? '' })),
    ),
  }
}

function platformName(platform: string): string {
  return platform === 'ios' ? 'iOS' : platform === 'android' ? 'Android' : platform
}

function shuffled<T>(items: T[]): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1)
    ;[result[i], result[j]] = [result[j]!, result[i]!]
  }
  return result
}

const ownedBy = (tgId: number): TicketGuard => ({ tgId, allowUnbound: false })

/** Точка входа: один апдейт Telegram. */
export async function handleBotUpdate(update: TgUpdate, deps: BotDeps): Promise<void> {
  const message = update.message
  if (message?.chat.type === 'private' && message.from) {
    await onMessage(message, message.from, deps)
  }
  if (update.callback_query) await onCallback(update.callback_query, deps)
}

async function onMessage(message: TgMessage, from: TgUser, deps: BotDeps): Promise<void> {
  if (message.contact) return onContact(message, from, deps)
  const text = message.text?.trim() ?? ''
  if (!text.startsWith('/start')) return
  const payload = text.split(/\s+/)[1] ?? ''
  if (payload.startsWith(LOGIN_PREFIX)) return onLoginStart(from, payload.slice(LOGIN_PREFIX.length), deps)
  await deps.messenger.send(from.id, TEXT.welcome)
}

function isOpen(ticket: LoginTicket | null, now: Date): ticket is LoginTicket {
  return ticket != null && ticket.status === 'pending' && ticket.expiresAt > now
}

async function onLoginStart(from: TgUser, deepCode: string, deps: BotDeps): Promise<void> {
  const ticket = await deps.repo.ticketByDeepCode(deepCode)
  if (!isOpen(ticket, deps.now())) return deps.messenger.send(from.id, TEXT.expired)

  // Привязка атомарна: билет достаётся первому открывшему, второй получит null.
  const opened = await deps.repo.updateTicket(
    ticket.id,
    {
      tgId: from.id,
      tgUsername: from.username ?? null,
      tgFirstName: from.first_name ?? '',
      tgLastName: from.last_name ?? null,
      openedAt: ticket.openedAt ?? deps.now(),
    },
    { tgId: from.id, allowUnbound: true },
  )
  if (!opened) return deps.messenger.send(from.id, TEXT.foreign)
  await advance(opened, await deps.repo.userByTgId(from.id), deps)
}

/** Следующий шаг: соглашение → номер → подтверждение кодом. Известное пропускаем. */
async function advance(ticket: LoginTicket, user: MafboardUser | null, deps: BotDeps): Promise<void> {
  const chatId = ticket.tgId
  if (chatId == null) return
  const { termsVersion, termsUrl } = deps.config
  const guard = ownedBy(chatId)

  if (ticket.termsVersion !== termsVersion && user?.termsVersion !== termsVersion) {
    if (!(await deps.repo.updateTicket(ticket.id, { step: 'terms' }, guard))) return
    return deps.messenger.send(
      chatId,
      TEXT.terms(termsUrl),
      inline([
        [{ text: 'Открыть соглашение', url: termsUrl }],
        [{ text: 'Принимаю', data: `${CALLBACK_PREFIX}terms:${ticket.id}` }, { text: 'Отказаться', data: `${CALLBACK_PREFIX}decline:${ticket.id}` }],
      ]),
    )
  }

  const phone = ticket.phone ?? user?.phone ?? null
  if (!phone) {
    if (!(await deps.repo.updateTicket(ticket.id, { step: 'contact', termsVersion }, guard))) return
    return deps.messenger.send(chatId, TEXT.contact, contactKeyboard)
  }

  if (!(await deps.repo.updateTicket(ticket.id, { step: 'confirm', termsVersion, phone }, guard))) return
  const codes = shuffled([ticket.confirmCode, ...decoyCodes(ticket.confirmCode)])
  await deps.messenger.send(
    chatId,
    TEXT.confirm(ticket.deviceName, platformName(ticket.platform)),
    inline([
      codes.map((code) => ({ text: code, data: `${CALLBACK_PREFIX}code:${ticket.id}:${code}` })),
      [{ text: 'Это не я', data: `${CALLBACK_PREFIX}reject:${ticket.id}` }],
    ]),
  )
}

async function onContact(message: TgMessage, from: TgUser, deps: BotDeps): Promise<void> {
  const contact = message.contact
  if (!contact) return
  // Принимаем только свой контакт: чужой можно переслать, но войти им нельзя.
  if (contact.user_id !== from.id) return deps.messenger.send(from.id, TEXT.foreignContact, contactKeyboard)

  const ticket = await deps.repo.openTicketForTg(from.id, 'contact', deps.now())
  if (!ticket) return deps.messenger.send(from.id, TEXT.noLogin, { remove_keyboard: true })

  const phone = normalizePhone(contact.phone_number)
  if (!phone) return deps.messenger.send(from.id, TEXT.badPhone, contactKeyboard)

  const updated = await deps.repo.updateTicket(ticket.id, { phone }, ownedBy(from.id))
  await deps.messenger.send(from.id, TEXT.phoneSaved, { remove_keyboard: true })
  if (updated) await advance(updated, await deps.repo.userByTgId(from.id), deps)
}

function parseCallback(data: string | undefined): { action: CallbackAction; ticketId: string; arg: string | null } | null {
  if (!data?.startsWith(CALLBACK_PREFIX)) return null
  const [action, ticketId, arg] = data.slice(CALLBACK_PREFIX.length).split(':')
  const known = ACTIONS.find((a) => a === action)
  if (!known || !ticketId) return null
  return { action: known, ticketId, arg: arg ?? null }
}

async function onCallback(query: TgCallbackQuery, deps: BotDeps): Promise<void> {
  const parsed = parseCallback(query.data)
  if (!parsed) return
  const from = query.from
  const ticket = await deps.repo.ticketById(parsed.ticketId)
  if (!isOpen(ticket, deps.now()) || ticket.tgId !== from.id) {
    return deps.messenger.answerCallback(query.id, 'Этот вход уже недействителен')
  }
  const guard = ownedBy(from.id)

  switch (parsed.action) {
    case 'terms': {
      const updated = await deps.repo.updateTicket(ticket.id, { termsVersion: deps.config.termsVersion }, guard)
      await deps.messenger.answerCallback(query.id, 'Спасибо!')
      if (updated) await advance(updated, await deps.repo.userByTgId(from.id), deps)
      return
    }
    case 'decline':
      await deps.repo.updateTicket(ticket.id, { status: 'rejected', step: 'done', note: 'Соглашение не принято' }, guard)
      await deps.messenger.answerCallback(query.id)
      return deps.messenger.send(from.id, TEXT.declined)
    case 'reject':
      await deps.repo.updateTicket(ticket.id, { status: 'rejected', step: 'done', note: 'Вход отклонён в Telegram' }, guard)
      await deps.messenger.answerCallback(query.id)
      return deps.messenger.send(from.id, TEXT.rejected)
    case 'code':
      if (parsed.arg !== ticket.confirmCode) {
        await deps.repo.updateTicket(ticket.id, { status: 'rejected', step: 'done', note: 'Код подтверждения не совпал' }, guard)
        await deps.messenger.answerCallback(query.id, 'Код не совпал')
        return deps.messenger.send(from.id, TEXT.wrongCode)
      }
      return confirm(ticket, from, query.id, deps)
  }
}

async function confirm(ticket: LoginTicket, from: TgUser, callbackId: string, deps: BotDeps): Promise<void> {
  if (ticket.step !== 'confirm' || !ticket.phone || ticket.termsVersion !== deps.config.termsVersion) {
    return deps.messenger.answerCallback(callbackId, 'Сначала завершите предыдущие шаги')
  }
  const user = await deps.repo.upsertUserFromTelegram({
    tgId: from.id,
    tgUsername: from.username ?? null,
    tgFirstName: from.first_name ?? '',
    tgLastName: from.last_name ?? null,
    phone: ticket.phone,
    termsVersion: ticket.termsVersion,
  })
  const confirmed = await deps.repo.updateTicket(ticket.id, { status: 'confirmed', step: 'done', userId: user.id }, ownedBy(from.id))
  if (!confirmed) return deps.messenger.answerCallback(callbackId, 'Этот вход уже недействителен')
  await deps.messenger.answerCallback(callbackId, 'Вход подтверждён')
  await deps.messenger.send(
    from.id,
    TEXT.confirmed,
    inline([[{ text: 'Вернуться в MafBoard', url: returnLink(deps.config.appLinkBase, ticket.id) }]]),
  )
}
