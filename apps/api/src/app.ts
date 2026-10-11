import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { MiddlewareHandler } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { prettyJSON } from 'hono/pretty-json'
import { bodyLimit } from 'hono/body-limit'
import { db, sql } from '@titan/database'
import { rateLimit } from './middleware/rateLimit.js'
import { tenantContext } from './middleware/tenant.js'
import { requireActiveSubscription } from './middleware/subscription.js'
import { requireModule, requireAiPaid } from './middleware/module.js'
import { clubRouter } from './modules/club/club.router.js'
import { alertsRouter } from './modules/notifications/alerts.router.js'
import { internalRouter } from './modules/internal/internal.router.js'
import { tgRouter } from './modules/tg/tg.router.js'
import { payRouter } from './modules/pay/pay.router.js'
import { bookingsPublicRouter, bookingsRouter } from './modules/bookings/bookings.router.js'
import { geoRouter } from './modules/geo/geo.router.js'

import { authRouter } from './modules/auth/auth.router.js'
import { appLoginRouter } from './modules/auth/app-login.js'
import { posRouter } from './modules/pos/pos.router.js'
import { tabletRouter, tabletsRouter } from './modules/tablet/tablet.router.js'
import { smartHomeRouter } from './modules/smart-home/smart-home.router.js'
import { shiftsRouter } from './modules/shifts/shifts.router.js'
import { menuRouter } from './modules/menu/menu.router.js'
import { screensRouter } from './modules/screens/screens.router.js'
import { clientsRouter } from './modules/clients/clients.router.js'
import { collectionsRouter } from './modules/collections/collections.router.js'
import { eventsRouter } from './modules/events/events.router.js'
import { customersRouter } from './modules/customers/customers.router.js'
import { spacesRouter } from './modules/spaces/spaces.router.js'
import { analyticsRouter } from './modules/analytics/analytics.router.js'
import { suppliesRouter } from './modules/supplies/supplies.router.js'
import { expensesRouter } from './modules/expenses/expenses.router.js'
import { certificatesRouter } from './modules/certificates/certificates.router.js'
import { salaryRouter } from './modules/salary/salary.router.js'
import { refundsRouter } from './modules/refunds/refunds.router.js'
import { notificationsRouter } from './modules/notifications/notifications.router.js'
import { aiRouter } from './modules/ai/ai.router.js'
import { systemRouter } from './modules/system/system.router.js'
import { uploadRouter } from './modules/upload/upload.router.js'
import { staffRouter } from './modules/staff/staff.router.js'
import { cashopsRouter } from './modules/cashops/cashops.router.js'
import { discountsRouter } from './modules/discounts/discounts.router.js'
import { inventoryRouter } from './modules/inventory/inventory.router.js'
import { goodsRouter } from './modules/goods/goods.router.js'
import { plategaRouter } from './modules/platega/platega.router.js'
import { pricingRouter } from './modules/pricing/pricing.router.js'
import { gomafiaRouter } from './modules/gomafia/gomafia.router.js'
import { superadminRouter } from './modules/superadmin/index.js'
import { residentRouter } from './modules/resident/resident.router.js'
import { broadcastRouter } from './modules/resident/broadcast.router.js'

const app = new Hono()

// ── Логгер запросов с маскированием секретов в URL ───────────────────────────
// SSE-эндпоинты (/notifications/stream, /api/pos/checks/:id/events) принимают JWT
// через query-параметр ?token=<...>, потому что браузерный EventSource не умеет
// слать заголовок Authorization. Штатный hono/logger печатает строку из c.req.url
// (полный путь С query) → токен утекал бы в логи как валидный токен доступа.
// Поэтому используем собственный логгер того же формата ("  <-- METHOD path" и
// "  --> METHOD path status Nms"), но с БЕЗОПАСНЫМ путём: token / authorization /
// любые *token*-ключи в query маскируются в REDACTED. Метод, путь (без секретов),
// статус и тайминг сохраняются.
function redactUrlPath(rawUrl: string): string {
  // Берём pathname + search из полного URL; на нестандартном вводе — строка как есть.
  let pathWithQuery: string
  try {
    const u = new URL(rawUrl)
    pathWithQuery = u.pathname + u.search
  } catch {
    pathWithQuery = rawUrl
  }
  const qIdx = pathWithQuery.indexOf('?')
  if (qIdx === -1) return pathWithQuery
  const path = pathWithQuery.slice(0, qIdx)
  const params = new URLSearchParams(pathWithQuery.slice(qIdx + 1))
  let changed = false
  for (const key of Array.from(params.keys())) {
    // Любой ключ, содержащий "token" (token, access_token…), и явный
    // authorization/auth маскируем целиком, не раскрывая длину/префикс секрета.
    const lk = key.toLowerCase()
    if (lk.includes('token') || lk === 'authorization' || lk === 'auth') {
      params.set(key, 'REDACTED')
      changed = true
    }
  }
  if (!changed) return pathWithQuery
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

const requestLogger: MiddlewareHandler = async (c, next) => {
  const method = c.req.method
  // c.req.raw.url — полный URL запроса, в нём и живёт query с токеном.
  const safePath = redactUrlPath(c.req.raw.url)
  console.log(`  <-- ${method} ${safePath}`)
  const start = Date.now()
  await next()
  console.log(`  --> ${method} ${safePath} ${c.res.status} ${Date.now() - start}ms`)
}

app.use('*', requestLogger)
app.use('*', secureHeaders())
app.use(
  '*',
  cors({
    origin: process.env['FRONTEND_URL'] ?? 'http://localhost:3000',
    credentials: true,
  })
)
app.use('*', prettyJSON())
// Общий предел тела 1 МБ. У загрузки картинок (/api/upload, фото анкеты /api/auth/app/photo)
// свой — в роутере: файл до 8 МБ;
// у восстановления из файла (/api/system/restore-upload) — тоже свой, в system.router.
const defaultBodyLimit = bodyLimit({ maxSize: 1 * 1024 * 1024 })
const hasOwnBodyLimit = (path: string): boolean =>
  path.startsWith('/api/upload/') || path === '/api/auth/app/photo' || path === '/api/system/restore-upload'
app.use('/api/*', (c, next) => (hasOwnBodyLimit(c.req.path) ? next() : defaultBodyLimit(c, next)))
app.use('/api/*', rateLimit)
// Инжект БД клуба в контекст (Фаза 1). Wave 0: дефолтная БД = синглтон.
app.use('/api/*', tenantContext)

// Liveness: процесс жив (используется healthcheck контейнера).
app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }))
app.get('/api/health', (c) => c.json({ ok: true, ts: Date.now() }))

// Readiness: готов обслуживать (БД доступна). Деплой/оркестратор может ждать его,
// чтобы не слать трафик до прогрева. 503 — пока не готов.
app.get('/api/health/ready', async (c) => {
  try {
    await db.execute(sql`select 1`)
    return c.json({ ready: true, ts: Date.now() })
  } catch {
    return c.json({ ready: false, ts: Date.now() }, 503)
  }
})

// Публичный контекст клуба (подписка/модули) — ДО энфорсмента подписки, чтобы
// заблокированный клуб мог прочитать свой статус и показать экран продления.
app.route('/api/club', clubRouter)

// Внутренний контур (бот-менеджер): конфиги ботов клубов. Защищён общим секретом,
// не гейтится подпиской (allowlist). Не для браузера.
app.route('/api/internal', internalRouter)

// Приёмник вебхука Telegram (бот опросов: сбор участников). Защита — secret_token
// Telegram; не гейтится подпиской (allowlist). Не для браузера.
app.route('/api/tg', tgRouter)

// Приёмник вебхуков эквайеров (СБП: Т-Банк/ЮKassa/Сбер/Альфа). Защита — подпись
// провайдера + серверная сверка статуса; не гейтится подпиской (внешний вебхук,
// не браузер). Монтируется ДО requireActiveSubscription, как /api/tg.
app.route('/api/pay', payRouter)

// Приёмник вебхука Platega (дефолтный СБП-провайдер). Это ВХОДЯЩИЙ вебхук провайдера
// (callback, не браузер): защита — пер-клубная подпись X-MerchantId/X-Secret +
// серверная сверка статуса у Platega. Монтируется ДО requireActiveSubscription и БЕЗ
// requireModule('platega') — иначе у клуба с истёкшей подпиской/выключенным модулем
// вебхук получал 402/403, гость платил, а чек не закрывался (и продление подписки
// тоже блокировалось — тупик). Целевой клуб резолвится из payload, не по Host.
app.route('/api/platega', plategaRouter)

// Публичный приём брони с виджета /book (гость без авторизации). Защита — гейт
// booking_enabled + глобальный rate-limit + валидация. ДО requireActiveSubscription.
app.route('/api/bookings/public', bookingsPublicRouter)

// Геосаджест (Яндекс) — публичный прокси подсказок адресов (нужен и на /book).
// ДО requireActiveSubscription; ключ — в integrations, защита пер-IP лимитом.
app.route('/api/geo', geoRouter)

// «Звонок» персоналу принят на iPhone (CallKit) — подтверждение по одноразовому ключу
// из VoIP-push, без авторизации. ДО requireActiveSubscription: звонок уже идёт.
app.route('/api/alerts', alertsRouter)

// Энфорсмент подписки на клуб-поддомене (грейс→блок). На основном домене (club=null)
// и для allowlist (/api/club, /api/health, /api/superadmin) — пропуск.
app.use('/api/*', requireActiveSubscription)

// Фиче-гейты модулей: 403, если модуль явно выключен у клуба. На основном домене
// и при отсутствии флага — пропуск (fail-open). Гейтим опциональные модули.
// Tai (ИИ) — ПЛАТНЫЙ: fail-closed для арендаторов (нужна подписка/модуль 'ai').
app.use('/api/ai/*', requireAiPaid())
// Примечание: /api/platega — это ВХОДЯЩИЙ вебхук провайдера, он смонтирован ВЫШЕ
// (до гейтов подписки/модуля). Браузерных ручек Platega нет (генерация QR/статус
// живут в /api/pos под своими гейтами), поэтому requireModule('platega') тут не нужен.
app.use('/api/events/*', requireModule('events'))
app.use('/api/certificates/*', requireModule('certificates'))
app.use('/api/discounts/*', requireModule('discounts'))
// Аналитика — фиче-модуль: арендатор с выключенным 'analytics' не получает витрины.
// fail-open на основном домене (оператор всегда видит).
app.use('/api/analytics/*', requireModule('analytics'))

// Вход в My Titan по номеру телефона + регистрация (подтверждение — в боте клуба).
app.route('/api/auth/app', appLoginRouter)
app.route('/api/auth', authRouter)
// Клиентское приложение My Titan: сводка, лента, сборы, уведомления, push.
app.route('/api/resident', residentRouter)
// Рассылки клиентам из панели (лента приложения + push + бот My Titan).
app.route('/api/client-broadcasts', broadcastRouter)
app.route('/api/pos', posRouter)
// Titan Home 2.0: состояние кабинки одним запросом, поток событий зоны, меню с версией.
app.route('/api/tablet', tabletRouter)
// HUB: статус планшетов Titan Home (Управление → Экраны).
app.route('/api/tablets', tabletsRouter)
// HUB: свет и кондиционеры помещений клуба (Home Assistant) — шторка на главной кассы.
app.route('/api/smart-home', smartHomeRouter)
app.route('/api/shifts', shiftsRouter)
app.route('/api/menu', menuRouter)
// «Экраны»: ТВ с приложением Titan Menu — настройки из HUB, привязка, показ.
app.route('/api/screens', screensRouter)
app.route('/api/clients', clientsRouter)
app.route('/api/collections', collectionsRouter)
app.route('/api/bookings', bookingsRouter)
app.route('/api/events', eventsRouter)
app.route('/api/customers', customersRouter)
app.route('/api/spaces', spacesRouter)
app.route('/api/analytics', analyticsRouter)
app.route('/api/supplies', suppliesRouter)
app.route('/api/expenses', expensesRouter)
app.route('/api/certificates', certificatesRouter)
app.route('/api/salary', salaryRouter)
app.route('/api/refunds', refundsRouter)
app.route('/api/notifications', notificationsRouter)
app.route('/api/ai', aiRouter)
app.route('/api/system', systemRouter)
app.route('/api/upload', uploadRouter)
app.route('/api/staff', staffRouter)
app.route('/api/cashops', cashopsRouter)
app.route('/api/discounts', discountsRouter)
app.route('/api/inventory', inventoryRouter)
// «Товары»: меню, остатки и операции склада одним разделом; сырьё и техкарты (070).
app.route('/api/goods', goodsRouter)
app.route('/api/pricing', pricingRouter)
app.route('/api/gomafia', gomafiaRouter)
// Суперадмин-контур платформы (control-plane): bootstrap/login + управление клубами.
app.route('/api/superadmin', superadminRouter)

app.onError((err, c) => {
  // Полную ошибку логируем только на сервере; наружу — обобщённое сообщение,
  // чтобы не утекали тексты драйвера БД, имена колонок и stack-трейсы.
  console.error(err)
  return c.json({ error: 'Internal error' }, 500)
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

export { app }
