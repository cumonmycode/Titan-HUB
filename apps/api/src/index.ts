import { serve } from '@hono/node-server'
import { closeDb, closeClubDbs, getClubDb, type Database } from '@titan/database'
import { app } from './app.js'
import { checkBirthdays } from './cron/birthdays.js'
import { auditBalances } from './cron/balance-audit.js'
import { runPollsForDb } from './cron/polls.js'
import { fiscalizePendingForDb } from './cron/fiscalize.js'
import { purgeOldAnalyticsEvents } from './cron/analytics-retention.js'
import { getCronTargets } from './cron/targets.js'
import { runStaffAlerts } from './modules/notifications/staff-calls.js'
import { ensureTaiWebhook } from './modules/tg/club.js'
import { runOutreach } from './modules/tg/outreach.js'
import { pruneMessages } from './modules/tg/dialog/memory.js'
import { runMigrations, runMigrationsOn } from './migrations/runner.js'
import { listActiveClubDbNames, buildClubConnString } from './lib/clubResolver.js'
import { getSharedRedis } from './lib/redis.js'

const port = Number(process.env['API_PORT'] ?? 3001)
// CRON_DISABLED=1 — инстанс без фоновых задач: пробный запуск на копии БД при
// переезде сервера (иначе дубли звонков персоналу, опросов, уведомлений о ДР).
const CRON_DISABLED = process.env['CRON_DISABLED'] === '1'

// Fail-fast: проверяем обязательные переменные окружения до запуска сервера.
function assertEnv() {
  const errors: string[] = []
  const jwtSecret = process.env['JWT_SECRET']
  if (!jwtSecret || jwtSecret.length < 32) {
    errors.push('JWT_SECRET must be set and at least 32 characters long')
  }
  if (!process.env['DATABASE_URL']) {
    errors.push('DATABASE_URL must be set')
  }
  if (errors.length > 0) {
    console.error('[env] FATAL — server will not start:\n - ' + errors.join('\n - '))
    process.exit(1)
  }
}
assertEnv()

// Миграции ВСЕХ активных клуб-БД (модель database-per-club). Без этого новые
// миграции применялись только к синглтону (DATABASE_URL), а существующие клубы
// уходили в дрейф схемы после первого же релиза с миграцией → 500 у арендаторов.
//
// Контракт безопасности:
//  • дефолтную БД (db_name == DATABASE_URL) пропускаем — её уже мигрировал
//    runMigrations() (синглтон). Дедуп исключает двойной проход на основном клубе;
//  • падение ОДНОГО клуба логируем и продолжаем (битый клуб не валит старт всей
//    платформы); собираем список упавших и выводим итог;
//  • control-plane недоступен/не сконфигурирован (нет CONTROL_DATABASE_URL и т.п.)
//    → listActiveClubDbNames бросает → ловим и просто пропускаем (как дефолтный
//    одно-клубный режим: мигрирован только синглтон).
async function migrateAllClubs(): Promise<void> {
  let defaultName = ''
  try {
    defaultName = new URL(process.env['DATABASE_URL'] ?? '').pathname.replace(/^\//, '')
  } catch {
    /* битый/пустой DATABASE_URL — defaultName останется пустым */
  }

  let clubNames: string[]
  try {
    clubNames = await listActiveClubDbNames()
  } catch (e) {
    console.warn('[migrations] control-plane недоступен — мигрируем только основную БД', e)
    return
  }

  const targets = Array.from(new Set(clubNames)).filter((n) => n && n !== defaultName)
  if (targets.length === 0) {
    console.log('[migrations] клуб-БД для миграции нет (кроме основной)')
    return
  }

  const failed: string[] = []
  for (const name of targets) {
    try {
      await runMigrationsOn(getClubDb(buildClubConnString(name)), name)
    } catch (e) {
      failed.push(name)
      console.error(`[migrations] клуб «${name}» — миграции НЕ применены`, e)
    }
  }
  if (failed.length > 0) {
    console.error(
      `[migrations] ИТОГ: ${failed.length} клуб(ов) с ошибкой миграции: ${failed.join(', ')} ` +
        '(их поддомены могут падать на новой схеме — требуется ручной разбор)',
    )
  } else {
    console.log(`[migrations] все клуб-БД (${targets.length}) мигрированы`)
  }
}

// Запускаем миграции перед стартом сервера: сначала синглтон (основная БД), затем
// все активные клуб-БД. Ошибка синглтона — фатальна (схема основной БД обязана быть
// консистентной); ошибки отдельных клубов НЕ валят старт (см. migrateAllClubs).
runMigrations()
  .then(() => migrateAllClubs())
  .then(() => {
    const server = serve({ fetch: app.fetch, port }, (info) => {
      console.log(`🚀 Titan HUB API running on http://localhost:${info.port}`)
    })
    setupGracefulShutdown(server)
  })
  .catch((err) => {
    console.error('[migrations] FATAL — server will not start:', err)
    process.exit(1)
  })

// Graceful shutdown: при деплое Docker шлёт SIGTERM. Перестаём принимать новые
// соединения, даём активным запросам/транзакциям завершиться, закрываем пул БД и
// Redis. Это и закрывает «деплой рвёт in-flight транзакции/SSE» из аудита.
function setupGracefulShutdown(server: { close: (cb?: () => void) => void }) {
  let shuttingDown = false
  const shutdown = (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[shutdown] ${signal} — завершаю работу, дренаж соединений…`)
    // Форс-выход, если дренаж завис (SSE/долгие соединения) — раньше, чем
    // Docker пришлёт SIGKILL (по умолчанию через 10с после SIGTERM).
    const force = setTimeout(() => {
      console.error('[shutdown] таймаут дренажа — выходим принудительно')
      closeDb().finally(() => process.exit(1))
    }, 8000)
    force.unref()
    server.close(() => {
      Promise.all([closeDb(), closeClubDbs()])
        .finally(() => {
          try { getSharedRedis().disconnect() } catch { /* noop */ }
        })
        .finally(() => {
          clearTimeout(force)
          console.log('[shutdown] готово')
          process.exit(0)
        })
    })
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

// Пер-клубный прогон фоновой задачи: по ВСЕМ активным клубам + основной БД (см.
// getCronTargets — дедуп по db_name, фолбэк на основную). Падение по одному клубу
// не прерывает остальных. Для одно-клубного прода = один проход на синглтоне.
async function runForAllClubs(label: string, fn: (database: Database, clubId: string | null) => Promise<unknown>) {
  const targets = await getCronTargets()
  for (const t of targets) {
    try {
      // clubId — для SSE-канала уведомлений клуба (notify).
      await fn(t.db, t.clubId)
    } catch (e) {
      console.error(`[cron:${label}] клуб «${t.name}» упал`, e)
    }
  }
}

// Ежедневная проверка дней рождения в 09:00 по Москве (по всем клубам).
// MSK = UTC+3 (без перехода на летнее время) → 06:00 UTC. Считаем в UTC,
// чтобы не зависеть от таймзоны контейнера (обычно UTC).
function scheduleBirthdayCron() {
  const now = new Date()
  const next = new Date()
  next.setUTCHours(6, 0, 0, 0)
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
  const msUntil = next.getTime() - now.getTime()

  setTimeout(async () => {
    await runForAllClubs('birthdays', checkBirthdays).catch(console.error)
    setInterval(() => runForAllClubs('birthdays', checkBirthdays).catch(console.error), 24 * 60 * 60 * 1000)
  }, msUntil)

  console.log(`🎂 Birthday cron scheduled (09:00 MSK), next run in ${Math.round(msUntil / 60000)} min`)
}

if (CRON_DISABLED) console.log('⏸  CRON_DISABLED=1 — фоновые задачи не запускаются')
if (!CRON_DISABLED) scheduleBirthdayCron()

// Ежедневная сверка целостности балансов клиентов в 05:00 по Москве (по всем клубам).
// MSK = UTC+3 → 02:00 UTC. Раннее утро: тихий час, сверяем итог за прошлые сутки.
// auditBalances() сама обёрнута в try/catch и НИКОГДА не бросает — .catch здесь
// лишь страхует от отказа самого вызова, чтобы не уронить интервал/процесс.
function scheduleBalanceAuditCron() {
  const now = new Date()
  const next = new Date()
  next.setUTCHours(2, 0, 0, 0)
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
  const msUntil = next.getTime() - now.getTime()

  setTimeout(async () => {
    await runForAllClubs('balance-audit', auditBalances).catch(console.error)
    setInterval(() => runForAllClubs('balance-audit', auditBalances).catch(console.error), 24 * 60 * 60 * 1000)
  }, msUntil)

  console.log(`🧾 Balance-audit cron scheduled (05:00 MSK), next run in ${Math.round(msUntil / 60000)} min`)
}

if (!CRON_DISABLED) scheduleBalanceAuditCron()

// Ежедневная ретенция analytics_events в 03:00 по Москве (по всем клубам).
// MSK = UTC+3 → 00:00 UTC. Тихий час. purgeOldAnalyticsEvents сама обёрнута в
// try/catch и НИКОГДА не бросает — .catch лишь страхует сам вызов.
function scheduleAnalyticsRetentionCron() {
  const now = new Date()
  const next = new Date()
  next.setUTCHours(0, 0, 0, 0)
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
  const msUntil = next.getTime() - now.getTime()

  setTimeout(async () => {
    await runForAllClubs('analytics-retention', purgeOldAnalyticsEvents).catch(console.error)
    setInterval(() => runForAllClubs('analytics-retention', purgeOldAnalyticsEvents).catch(console.error), 24 * 60 * 60 * 1000)
  }, msUntil)

  console.log(`🧹 Analytics-retention cron scheduled (03:00 MSK), next run in ${Math.round(msUntil / 60000)} min`)
}

if (!CRON_DISABLED) scheduleAnalyticsRetentionCron()

// Регулярные опросы Telegram: тик КАЖДУЮ МИНУТУ по всем клубам. Постинг
// идемпотентен (isPollDue: один раз в слот по lastPostedAt), поэтому частый тик
// безопасен и устойчив к рестартам/дрейфу. Лёгкий: читает JSON-конфиг из app_settings.
function schedulePollsCron() {
  setInterval(() => {
    runForAllClubs('polls', runPollsForDb).catch(console.error)
  }, 60_000)
  console.log('🗳️  Polls cron scheduled (тик раз в минуту, МСК)')
}

if (!CRON_DISABLED) schedulePollsCron()

// Tai — единый бот клуба: вебхук должен принимать личку и кнопки (проверяем при
// старте и раз в час), Tai сам пишет клиентам по поводу (раз в 10 минут, днём),
// старая переписка чистится раз в сутки.
const TAI_OUTREACH_EVERY_MS = 10 * 60_000
const TAI_WEBHOOK_EVERY_MS = 60 * 60_000
const TAI_PRUNE_EVERY_MS = 24 * 60 * 60_000
function scheduleTaiCron() {
  const ensure = () => runForAllClubs('tai-webhook', ensureTaiWebhook).catch(console.error)
  setTimeout(ensure, 15_000)
  setInterval(ensure, TAI_WEBHOOK_EVERY_MS)
  setInterval(() => runForAllClubs('tai-outreach', runOutreach).catch(console.error), TAI_OUTREACH_EVERY_MS)
  setInterval(() => runForAllClubs('tai-prune', (database) => pruneMessages(database)).catch(console.error), TAI_PRUNE_EVERY_MS)
  console.log('🤖 Tai cron scheduled (вебхук, сообщения первым, чистка истории)')
}

if (!CRON_DISABLED) scheduleTaiCron()

// Фискализация 54-ФЗ: тик КАЖДУЮ МИНУТУ по всем клубам. Идемпотентно (один ряд
// fiscal_receipts на чек), клубы без фискального провайдера пропускаются. НЕ трогает
// денежные пути закрытия чека → нулевой риск для продаж.
function scheduleFiscalizeCron() {
  setInterval(() => {
    runForAllClubs('fiscalize', fiscalizePendingForDb).catch(console.error)
  }, 60_000)
  console.log('🧾 Fiscalize cron scheduled (тик раз в минуту)')
}

if (!CRON_DISABLED) scheduleFiscalizeCron()

// Эскалация вызовов из Titan Home: тик КАЖДЫЕ 5 СЕКУНД по всем клубам — гость написал
// в чат или нажал «Позвать», через 30 с без прочтения звоним персоналу (VoIP), гасим
// звонок, когда прочитали. Лёгкий: один запрос открытых эскалаций на клуб. Список
// клубов кэшируем на минуту, чтобы не дёргать control-БД каждые 5 секунд.
function scheduleStaffAlertsCron() {
  let targets: Awaited<ReturnType<typeof getCronTargets>> = []
  let targetsAt = 0
  let running = false
  setInterval(async () => {
    if (running) return
    running = true
    try {
      if (Date.now() - targetsAt > 60_000) {
        targets = await getCronTargets()
        targetsAt = Date.now()
      }
      for (const t of targets) {
        await runStaffAlerts(t.db).catch((e) => console.error(`[cron:staff-alerts] клуб «${t.name}» упал`, e))
      }
    } catch (e) {
      console.error('[cron:staff-alerts]', e)
    } finally {
      running = false
    }
  }, 5_000)
  console.log('📞 Staff-alerts cron scheduled (тик раз в 5 с)')
}

if (!CRON_DISABLED) scheduleStaffAlertsCron()
