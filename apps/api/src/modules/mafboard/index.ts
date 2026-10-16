import { getClubDb } from '@titan/database'
import { getSharedRedis } from '../../lib/redis.js'
import { setTelegramWebhook } from '../../lib/telegram.js'
import { TgBot } from '../../lib/tgBot.js'
import type { BotMessenger } from './bot.js'
import { readMafboardConfig, type MafboardConfig } from './config.js'
import { liveGoMafia, RosterCache } from './gomafia.js'
import { ensureMafboardDatabase, runMafboardMigrations } from './migrations.js'
import { PgMafboardRepo } from './pgRepo.js'
import { createMafboardRouter, type MafboardDeps, type RateLimiter } from './router.js'
import { webhookSecret } from './tokens.js'

// ─────────────────────────────────────────────────────────────────────────────
// Сборка модуля MafBoard для прода: Postgres (своя БД), Redis (лимиты, дедуп
// апдейтов), бот MafBoard через общий шлюз Telegram, GoMafia через lib/gomafia.
// Подключение: app.ts → app.route('/api/mafboard', mafboardRouter);
//              index.ts → startMafboard() и scheduleMafboardCron().
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_UPDATES = ['message', 'callback_query']
const WEBHOOK_TIMEOUT_MS = 15_000
const WEBHOOK_EVERY_MS = 60 * 60_000
const PURGE_EVERY_MS = 24 * 60 * 60_000
/** Истёкшие билеты, сессии и токены храним ещё 30 дней — для разбора инцидентов. */
const PURGE_GRACE_MS = 30 * 24 * 60 * 60_000

const redisLimiter: RateLimiter = {
  async hit(key, limit, windowSec, options) {
    try {
      // Атомарно: окно создаётся вместе со счётчиком (SET NX EX), ключ без срока не появится.
      const results = await getSharedRedis().multi().set(key, '0', 'EX', windowSec, 'NX').incr(key).exec()
      const count = Number(results?.[1]?.[1])
      if (!Number.isFinite(count)) throw new Error('пустой ответ Redis')
      return count <= limit
    } catch {
      // Как глобальный rateLimit: без Redis не блокируем — кроме защиты от подбора паролей.
      return !options?.failClosed
    }
  },
}

async function firstDelivery(key: string, ttlSec: number): Promise<boolean> {
  const ok = await getSharedRedis().set(key, '1', 'EX', ttlSec, 'NX').catch(() => 'OK')
  return ok === 'OK'
}

/** Фоновые задачи одного ключа (чата) выполняются строго по очереди. */
const chains = new Map<string, Promise<void>>()
function background(key: string, job: () => Promise<void>): void {
  const next = (chains.get(key) ?? Promise.resolve())
    .then(job)
    .catch((error) => console.error('[mafboard] фоновая задача упала', error))
    .finally(() => {
      if (chains.get(key) === next) chains.delete(key)
    })
  chains.set(key, next)
}

function messengerFor(token: string | null): BotMessenger | null {
  if (!token) return null
  const bot = new TgBot(token)
  return {
    async send(chatId, text, markup) {
      const result = await bot.send(chatId, text, markup ? { markup } : {})
      if (!result.ok) console.warn(`[mafboard] сообщение в ${chatId} не доставлено: ${result.error}`)
    },
    answerCallback: (id, text) => bot.answerCallback(id, text),
    username: () => bot.username(),
  }
}

let deps: MafboardDeps | null = null

function resolveDeps(): MafboardDeps | { error: string } {
  if (deps) return deps
  const result = readMafboardConfig()
  if (!result.ok) return { error: result.error }
  const config = result.config
  try {
    deps = {
      repo: new PgMafboardRepo(getClubDb(config.databaseUrl)),
      config,
      gomafia: liveGoMafia,
      roster: new RosterCache(liveGoMafia),
      messenger: messengerFor(config.botToken),
      limiter: redisLimiter,
      firstDelivery,
      now: () => new Date(),
      background,
    }
    return deps
  } catch (error) {
    // Например, битая MAFBOARD_DATABASE_URL: postgres() бросает синхронно.
    return { error: `не удалось подключить БД MafBoard: ${error instanceof Error ? error.message : String(error)}` }
  }
}

export const mafboardRouter = createMafboardRouter(resolveDeps)

function webhookUrl(): string {
  const root = (process.env['TELEGRAM_WEBHOOK_HOST'] || process.env['ROOT_DOMAIN'] || 'titanpos.ru').toLowerCase()
  return `https://${root}/api/mafboard/tg-webhook`
}

async function ensureWebhook(config: MafboardConfig): Promise<void> {
  if (!config.botToken) return
  // Шлюз Telegram может зависнуть — не ждём дольше 15 с.
  const result = await Promise.race([
    setTelegramWebhook(config.botToken, webhookUrl(), webhookSecret(config), ALLOWED_UPDATES),
    new Promise<{ ok: false; error: string }>((resolve) =>
      setTimeout(() => resolve({ ok: false, error: `нет ответа за ${WEBHOOK_TIMEOUT_MS / 1000} с` }), WEBHOOK_TIMEOUT_MS),
    ),
  ])
  if (!result.ok) console.error('[mafboard] вебхук бота не установлен:', result.error)
}

/**
 * Старт модуля: создать БД при первом запуске, применить миграции, поставить вебхук.
 * Никогда не бросает — сбой MafBoard не должен мешать старту Titan HUB.
 */
export async function startMafboard(): Promise<void> {
  const result = readMafboardConfig()
  if (!result.ok) {
    console.log(`[mafboard] модуль выключен: ${result.error}`)
    return
  }
  const { config } = result
  try {
    const database = getClubDb(config.databaseUrl)
    await ensureMafboardDatabase(config.databaseUrl, database)
    await runMafboardMigrations(database)
    await ensureWebhook(config)
    console.log('🎭 MafBoard: БД и бот готовы')
  } catch (error) {
    console.error('[mafboard] старт не удался — ручки MafBoard могут отвечать ошибкой', error)
  }
}

/** Раз в час — вебхук бота, раз в сутки — чистка истёкших билетов, сессий и токенов. */
export function scheduleMafboardCron(): void {
  const result = readMafboardConfig()
  if (!result.ok) return
  const { config } = result
  setInterval(() => ensureWebhook(config).catch(console.error), WEBHOOK_EVERY_MS)
  setInterval(() => {
    // Таймер без обработчика исключений уронил бы весь процесс API.
    try {
      const current = resolveDeps()
      if ('error' in current) return
      current.repo
        .purgeExpired(new Date(Date.now() - PURGE_GRACE_MS))
        .then((removed) =>
          console.log(`[mafboard] чистка: билетов ${removed.tickets}, сессий ${removed.sessions}, токенов ${removed.refreshTokens}`),
        )
        .catch((error) => console.error('[mafboard] чистка не удалась', error))
    } catch (error) {
      console.error('[mafboard] чистка не запущена', error)
    }
  }, PURGE_EVERY_MS)
  console.log('🎭 MafBoard cron scheduled (вебхук бота, чистка билетов)')
}
