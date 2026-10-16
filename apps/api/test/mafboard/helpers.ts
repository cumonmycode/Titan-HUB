import { Hono } from 'hono'
import type { ReplyMarkup } from '../../src/lib/tgBot.js'
import type { GomafiaPlayer } from '../../src/lib/gomafia.js'
import type { BotMessenger } from '../../src/modules/mafboard/bot.js'
import type { MafboardConfig } from '../../src/modules/mafboard/config.js'
import { RosterCache, type GoMafiaGateway } from '../../src/modules/mafboard/gomafia.js'
import { GomafiaTakenError, type MafboardRepo } from '../../src/modules/mafboard/repo.js'
import { createMafboardRouter, type MafboardDeps } from '../../src/modules/mafboard/router.js'
import type { LoginTicket, MafboardUser, RefreshTokenRow, StoredGame, TicketGuard } from '../../src/modules/mafboard/types.js'

// Вебхук бота подписывается от JWT_SECRET Titan HUB (lib/tgWebhook.ts).
process.env['JWT_SECRET'] ??= 'test-titan-jwt-secret-0123456789abcdef'

export const NOW = new Date('2026-10-16T18:00:00.000Z')

export const config: MafboardConfig = {
  databaseUrl: 'postgres://test/mafboard',
  jwtSecret: new TextEncoder().encode('test-mafboard-secret-0123456789abcdef'),
  botToken: 'test-bot-token',
  botUsername: 'mafboard_test_bot',
  appLinkBase: 'https://mafboard.test',
  termsUrl: 'https://mafboard.test/terms',
  termsVersion: '1',
}

/** Хранилище в памяти с той же семантикой, что у Postgres-версии. */
export class MemoryRepo implements MafboardRepo {
  users = new Map<string, MafboardUser>()
  tickets = new Map<string, LoginTicket>()
  refresh = new Map<string, RefreshTokenRow>()
  games = new Map<string, StoredGame>()
  private seq = 0

  private uuid(): string {
    this.seq += 1
    return `00000000-0000-4000-8000-${String(this.seq).padStart(12, '0')}`
  }

  async userById(id: string) { return this.users.get(id) ?? null }
  async userByTgId(tgId: number) { return [...this.users.values()].find((u) => u.tgId === tgId) ?? null }
  async userByGomafiaId(id: number) { return [...this.users.values()].find((u) => u.gomafia?.player.id === id) ?? null }

  async upsertUserFromTelegram(p: Parameters<MafboardRepo['upsertUserFromTelegram']>[0]) {
    const existing = await this.userByTgId(p.tgId)
    const user: MafboardUser = {
      id: existing?.id ?? this.uuid(),
      tgId: p.tgId,
      tgUsername: p.tgUsername,
      tgFirstName: p.tgFirstName,
      tgLastName: p.tgLastName,
      phone: p.phone,
      termsVersion: p.termsVersion,
      gomafia: existing?.gomafia ?? null,
    }
    this.users.set(user.id, user)
    return user
  }

  async setGomafiaLink(userId: string, link: Parameters<MafboardRepo['setGomafiaLink']>[1], at: Date) {
    const user = this.users.get(userId)
    if (!user) return null
    if (link) {
      const owner = await this.userByGomafiaId(link.player.id)
      if (owner && owner.id !== userId) throw new GomafiaTakenError()
    }
    const sameAccount = user.gomafia && link && user.gomafia.player.id === link.player.id
    const updated: MafboardUser = {
      ...user,
      gomafia: link ? { ...link, linkedAt: sameAccount ? user.gomafia!.linkedAt : at, syncedAt: at } : null,
    }
    this.users.set(userId, updated)
    return updated
  }

  async createTicket(input: Parameters<MafboardRepo['createTicket']>[0]) {
    const ticket: LoginTicket = {
      id: this.uuid(), ...input, status: 'pending', step: 'created',
      tgId: null, tgUsername: null, tgFirstName: null, tgLastName: null, phone: null, termsVersion: null,
      userId: null, openedAt: null, note: null, createdAt: NOW,
    }
    this.tickets.set(ticket.id, ticket)
    return ticket
  }

  async ticketById(id: string) { return this.tickets.get(id) ?? null }
  async ticketByDeepCode(code: string) { return [...this.tickets.values()].find((t) => t.deepCode === code) ?? null }

  async openTicketForTg(tgId: number, step: LoginTicket['step'], now: Date) {
    return [...this.tickets.values()].reverse()
      .find((t) => t.tgId === tgId && t.status === 'pending' && t.step === step && t.expiresAt > now) ?? null
  }

  async updateTicket(id: string, patch: Parameters<MafboardRepo['updateTicket']>[1], guard?: TicketGuard) {
    const ticket = this.tickets.get(id)
    if (!ticket) return null
    if (guard) {
      const owned = ticket.tgId === guard.tgId || (guard.allowUnbound && ticket.tgId == null)
      if (ticket.status !== 'pending' || !owned) return null
    }
    const definedPatch = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
    const updated = { ...ticket, ...definedPatch } as LoginTicket
    this.tickets.set(id, updated)
    return updated
  }

  async claimTicket(id: string, hash: string, now: Date) {
    const ticket = this.tickets.get(id)
    if (!ticket || ticket.status !== 'confirmed' || ticket.expiresAt <= now || ticket.deviceSecretHash !== hash) return null
    const claimed: LoginTicket = { ...ticket, status: 'claimed' }
    this.tickets.set(id, claimed)
    return claimed
  }

  async purgeExpired(before: Date) {
    const expired = [...this.tickets.values()].filter((t) => t.expiresAt < before)
    expired.forEach((t) => this.tickets.delete(t.id))
    const tokens = [...this.refresh.values()].filter((r) => r.expiresAt < before)
    tokens.forEach((r) => this.refresh.delete(r.tokenHash))
    return { tickets: expired.length, refreshTokens: tokens.length }
  }

  async insertRefreshToken(row: Parameters<MafboardRepo['insertRefreshToken']>[0]) {
    this.refresh.set(row.tokenHash, { tokenHash: row.tokenHash, userId: row.userId, expiresAt: row.expiresAt, revokedAt: null })
  }

  async refreshToken(hash: string) { return this.refresh.get(hash) ?? null }

  async revokeRefreshToken(hash: string, at: Date) {
    const row = this.refresh.get(hash)
    if (!row || row.revokedAt) return false
    this.refresh.set(hash, { ...row, revokedAt: at })
    return true
  }

  async revokeAllRefreshTokens(userId: string, at: Date) {
    for (const [hash, row] of this.refresh) {
      if (row.userId === userId && !row.revokedAt) this.refresh.set(hash, { ...row, revokedAt: at })
    }
  }

  async insertGame(game: StoredGame) {
    const existing = this.games.get(game.id)
    if (existing) return existing.hostUserId === game.hostUserId ? 'exists' : 'conflict'
    this.games.set(game.id, game)
    return 'inserted'
  }

  async gamesByHost(userId: string, since: Date | null, limit: number) {
    return [...this.games.values()].filter((g) => g.hostUserId === userId && (!since || g.finishedAt > since)).slice(0, limit)
  }

  async gamesByClub(clubId: number, since: Date | null, limit: number) {
    return [...this.games.values()].filter((g) => g.clubId === clubId && (!since || g.finishedAt > since)).slice(0, limit)
  }
}

export interface SentMessage {
  chatId: number
  text: string
  markup?: ReplyMarkup
}

export class FakeMessenger implements BotMessenger {
  sent: SentMessage[] = []
  answers: { id: string; text?: string }[] = []

  async send(chatId: number, text: string, markup?: ReplyMarkup) {
    this.sent.push(markup ? { chatId, text, markup } : { chatId, text })
  }

  async answerCallback(id: string, text?: string) {
    this.answers.push(text === undefined ? { id } : { id, text })
  }

  async username() { return 'mafboard_test_bot' }

  get last(): SentMessage | undefined { return this.sent.at(-1) }

  /** callback_data кнопки с этим текстом в последнем сообщении с inline-клавиатурой. */
  callbackFor(label: string): string {
    for (const message of [...this.sent].reverse()) {
      if (message.markup && 'inline_keyboard' in message.markup) {
        const button = message.markup.inline_keyboard.flat().find((b) => b.text === label)
        if (button?.callback_data) return button.callback_data
      }
    }
    throw new Error(`кнопка «${label}» не найдена`)
  }

  urlFor(label: string): string {
    for (const message of [...this.sent].reverse()) {
      if (message.markup && 'inline_keyboard' in message.markup) {
        const button = message.markup.inline_keyboard.flat().find((b) => b.text === label)
        if (button?.url) return button.url
      }
    }
    throw new Error(`кнопка-ссылка «${label}» не найдена`)
  }
}

export function gmPlayer(id: number, login: string, clubId: number | null = 77): GomafiaPlayer {
  return {
    gomafiaId: String(id), login, fullName: null, firstName: null, lastName: null, elo: 1500,
    avatar: `/avatars/${id}.jpg`, clubId: clubId == null ? null : String(clubId), clubTitle: clubId ? 'TITAN' : null,
    city: 'Москва', tournaments: 12,
  }
}

/** GoMafia-заглушка: логин «host»/«secret» → игрок 4242 из клуба 77. */
export class FakeGoMafia implements GoMafiaGateway {
  players = new Map<string, GomafiaPlayer>([
    ['4242', gmPlayer(4242, 'host')],
    ['5001', gmPlayer(5001, 'Шерлок')],
    ['5002', gmPlayer(5002, 'Шериф Ноттингема', 12)],
  ])
  roster: GomafiaPlayer[] = [gmPlayer(4242, 'host'), gmPlayer(5001, 'Шерлок')]
  clubCalls = 0

  async login(login: string, password: string) {
    return login === 'host' && password === 'secret'
      ? { ok: true, userId: '4242', clubId: '77' }
      : { ok: false, error: 'wrong' }
  }

  async player(id: string) { return this.players.get(id) ?? null }

  async club(clubId: string, page: number) {
    this.clubCalls += 1
    const residents = clubId === '77' && page === 1 ? this.roster : []
    return {
      club: { id: clubId, title: 'TITAN', city: 'Москва', description: null, rank: null },
      residents,
      total: this.roster.length,
    }
  }

  async search(query: string) {
    return [...this.players.values()].filter((p) => p.login.toLowerCase().includes(query.toLowerCase()))
  }
}

export interface TestContext {
  app: Hono
  deps: MafboardDeps
  repo: MemoryRepo
  messenger: FakeMessenger
  gomafia: FakeGoMafia
  /** Дождаться фоновых задач (обработка апдейтов бота). */
  flush(): Promise<void>
  clock: { now: Date }
}

export function createTestContext(overrides: Partial<MafboardDeps> = {}): TestContext {
  const repo = new MemoryRepo()
  const messenger = new FakeMessenger()
  const gomafia = new FakeGoMafia()
  const clock = { now: NOW }
  const pending: Promise<void>[] = []
  const seen = new Set<string>()
  const counters = new Map<string, { count: number; until: number }>()

  const deps: MafboardDeps = {
    repo,
    config,
    gomafia,
    roster: new RosterCache(gomafia, () => clock.now.getTime()),
    messenger,
    limiter: {
      async hit(key, limit, windowSec) {
        const now = clock.now.getTime()
        const entry = counters.get(key)
        const current = entry && entry.until > now ? entry : { count: 0, until: now + windowSec * 1000 }
        current.count += 1
        counters.set(key, current)
        return current.count <= limit
      },
    },
    async firstDelivery(key) {
      if (seen.has(key)) return false
      seen.add(key)
      return true
    },
    now: () => clock.now,
    background: (_key, job) => {
      pending.push(job())
    },
    ...overrides,
  }

  const app = new Hono().route('/api/mafboard', createMafboardRouter(() => deps))
  return {
    app, deps, repo, messenger, gomafia, clock,
    async flush() {
      while (pending.length > 0) await pending.shift()
    },
  }
}

export async function call(
  ctx: TestContext,
  method: string,
  path: string,
  options: { body?: unknown; token?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { 'x-real-ip': '10.0.0.1', ...options.headers }
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.token) headers['authorization'] = `Bearer ${options.token}`
  const response = await ctx.app.request(`/api/mafboard${path}`, {
    method,
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  })
  const text = await response.text()
  return { status: response.status, json: text ? JSON.parse(text) : null }
}

export const DEVICE_SECRET = 'device-secret-0123456789abcdefghijklmnopqrstuv'
export const TG_USER = { id: 1001, is_bot: false, first_name: 'Кай', username: 'kai' }

let updateId = 1

export function message(from: typeof TG_USER, extra: Record<string, unknown>) {
  updateId += 1
  return {
    update_id: updateId,
    message: { message_id: updateId, from, chat: { id: from.id, type: 'private' }, date: 0, ...extra },
  }
}

export function callback(from: typeof TG_USER, data: string) {
  updateId += 1
  return { update_id: updateId, callback_query: { id: `cb-${updateId}`, from, data } }
}

/** Прогнать полный вход через бота и вернуть сессию приложения. */
export async function signIn(ctx: TestContext, user = TG_USER): Promise<{ accessToken: string; refreshToken: string; account: any }> {
  const { handleBotUpdate } = await import('../../src/modules/mafboard/bot.js')
  const bot = { repo: ctx.repo, messenger: ctx.messenger, config, now: () => ctx.clock.now }

  const start = await call(ctx, 'POST', '/v1/auth/telegram/start', {
    body: { deviceName: 'iPhone', platform: 'ios', deviceSecret: DEVICE_SECRET },
  })
  const code = new URL(start.json.deepLink).searchParams.get('start') ?? ''
  await handleBotUpdate(message(user, { text: `/start ${code}` }) as any, bot)
  if (ctx.messenger.last?.text.includes('соглашение')) {
    await handleBotUpdate(callback(user, ctx.messenger.callbackFor('Принимаю')) as any, bot)
  }
  if (ctx.messenger.last?.text.includes('номером')) {
    await handleBotUpdate(message(user, { contact: { phone_number: '79161234567', user_id: user.id } }) as any, bot)
  }
  // Сверка кода: нажимаем тот, что «показан в приложении» (пришёл в ответе start).
  await handleBotUpdate(callback(user, ctx.messenger.callbackFor(start.json.confirmationCode)) as any, bot)

  const complete = await call(ctx, 'POST', '/v1/auth/telegram/complete', {
    body: { ticket: start.json.id, deviceSecret: DEVICE_SECRET },
  })
  if (complete.status !== 200) throw new Error(`вход не завершён: ${complete.status} ${JSON.stringify(complete.json)}`)
  return { ...complete.json.tokens, account: complete.json.account }
}
