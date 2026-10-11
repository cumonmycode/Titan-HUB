import { db as singletonDb, getClubDb } from '@titan/database'
import { createAdminBot, type AdminBotCtx } from './bot.js'

// ─────────────────────────────────────────────────────────────────────────────
// Бот-менеджер (мульти-тенант). На старте читает активные клубы из внутреннего
// эндпоинта API (/api/internal/bot-clubs — он расшифровывает токены ботов из
// integrations каждого клуба) и поднимает по инстансу админ-бота на клуб:
//   • ДЕФОЛТНЫЙ клуб (db_name = основная БД) → env-токен + синглтон-БД + основной
//     API_URL → поведение БАЙТ-В-БАЙТ прежнее (одно-клубный прод не затронут);
//   • прочие клубы → их токен из integrations + getClubDb + публичный API клуба
//     (https://<subdomain>/api), чтобы tenantContext резолвил нужный клуб по Host.
//
// Дедуп по токену: два клуба с одинаковым токеном не поднимаем (иначе Telegram
// 409 Conflict на параллельный getUpdates). Добавление клуба/смена токена требует
// перезапуска контейнера (docker restart titan-bot-admin) — реконсиляция на лету
// в v1 не делается (проще и безопаснее).
// ─────────────────────────────────────────────────────────────────────────────

const API_URL = process.env['API_URL'] ?? 'http://api:3001'
const INTERNAL_SECRET = process.env['JWT_SECRET'] ?? ''
const ENV_TOKEN = process.env['ADMIN_BOT_TOKEN']
const ENV_ALLOWED = (process.env['ADMIN_TG_IDS'] ?? '').split(',').filter(Boolean)

interface ClubCfg {
  /** id клуба в control-БД (нет у старого API — тогда токен без привязки к клубу). */
  id?: string
  slug: string
  subdomain: string | null
  dbName: string
  isDefault: boolean
  adminToken: string | null
  walletToken: string | null
}

// Строка подключения к app-БД клуба: DATABASE_URL с заменой имени БД (как в API
// buildClubConnString). Для дефолтной БД используем синглтон (без второго пула).
function clubConn(dbName: string): string {
  const base = process.env['DATABASE_URL']
  if (!base) throw new Error('DATABASE_URL не задан')
  const u = new URL(base)
  u.pathname = `/${dbName}`
  return u.toString()
}

async function fetchClubs(): Promise<ClubCfg[]> {
  const res = await fetch(`${API_URL}/internal/bot-clubs`, {
    headers: { 'x-internal-secret': INTERNAL_SECRET },
  })
  if (!res.ok) throw new Error(`bot-clubs ${res.status}`)
  const json = (await res.json()) as { clubs: ClubCfg[] }
  return json.clubs ?? []
}

async function main() {
  let clubs: ClubCfg[] = []
  try {
    clubs = await fetchClubs()
    console.log(`[bot-admin] получено клубов: ${clubs.length}`)
  } catch (e) {
    console.error('[bot-admin] не удалось получить список клубов — поднимаю только дефолт по env', e)
  }

  const startedTokens = new Set<string>()
  const toStart: { ctx: AdminBotCtx }[] = []

  for (const c of clubs) {
    // Для дефолтного клуба токен из integrations, иначе env-фолбэк (заведение всегда с ботом).
    const token = c.isDefault ? c.adminToken || ENV_TOKEN : c.adminToken
    if (!token) {
      console.log(`[bot-admin] клуб «${c.slug}»: нет admin-токена — пропуск`)
      continue
    }
    if (startedTokens.has(token)) {
      console.log(`[bot-admin] клуб «${c.slug}»: токен уже занят другим клубом — пропуск (анти-409)`)
      continue
    }
    startedTokens.add(token)
    toStart.push({
      ctx: {
        token,
        db: c.isDefault ? singletonDb : getClubDb(clubConn(c.dbName)),
        apiBase: c.isDefault ? API_URL : `https://${c.subdomain}/api`,
        // Дефолтный бот ходит на основной домен API (клуб null), остальные — на поддомен клуба.
        clubId: c.isDefault ? null : c.id,
        allowedTgIds: c.isDefault ? ENV_ALLOWED : [],
        label: c.slug,
      },
    })
  }

  // Фолбэк: если дефолтный клуб не пришёл из эндпоинта (эндпоинт упал/пуст), но
  // env-токен есть — поднимаем дефолт по env (одно-клубный прод не должен остаться без бота).
  const hasDefault = clubs.some((c) => c.isDefault)
  if (!hasDefault && ENV_TOKEN && !startedTokens.has(ENV_TOKEN)) {
    startedTokens.add(ENV_TOKEN)
    toStart.push({
      ctx: { token: ENV_TOKEN, db: singletonDb, apiBase: API_URL, clubId: null, allowedTgIds: ENV_ALLOWED, label: 'default(env)' },
    })
  }

  if (toStart.length === 0) {
    console.error('[bot-admin] нет ни одного бота для запуска (нет токенов). Выхожу.')
    return
  }

  for (const { ctx } of toStart) {
    const bot = createAdminBot(ctx)
    // bot.start() запускает long-polling и резолвится при остановке — НЕ await'им,
    // чтобы боты работали параллельно. Ошибку старта (битый токен, 409) логируем.
    bot
      .start({ onStart: () => console.log(`🤖 Admin bot started for «${ctx.label}»`) })
      .catch((e) => console.error(`[bot-admin] старт бота «${ctx.label}» не удался:`, e))
  }
  console.log(`🤖 Admin bot-manager: запущено ботов — ${toStart.length}`)
}

main().catch((e) => {
  console.error('[bot-admin] фатальная ошибка менеджера:', e)
  process.exit(1)
})
