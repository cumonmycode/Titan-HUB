import { InlineKeyboard, Keyboard, type Bot, type Context } from 'grammy'
import {
  profiles, tgLinkRequests, walletLoginCodes, eq, and, or, gt, isNull, isNotNull, desc, sql,
  type Database, type Profile, type WalletLoginCode,
} from '@titan/database'

// ─────────────────────────────────────────────────────────────────────────────
// Вход и регистрация в приложении My Titan по номеру телефона.
//
// Приложение создаёт строку wallet_login_codes (mode 'login' | 'register') и
// открывает t.me/<бот>?start=app_<deepCode>. Бот привязывает строку к открывшему
// её Telegram (tg_id) и просит подтвердить:
//   • Telegram уже привязан к профилю с этим номером → кнопки «Да / Нет»;
//   • иначе «Да» = кнопка «поделиться номером»: Telegram сам присылает номер
//     аккаунта — так проверяем, что введённый номер принадлежит клиенту (без
//     проверки любой мог бы войти в чужой профиль, просто набрав чужой номер).
// После подтверждения строка → claimed + profile_id (при регистрации профиль
// создаётся здесь же), приложение получает токен через /api/auth/app/status, а
// бот показывает кнопку «Открыть приложение».
// ─────────────────────────────────────────────────────────────────────────────

export interface AppLoginDeps {
  db: Database
  label: string
  /** Страница «Открыть приложение» на сайте клуба (https://<клуб>/my-titan). */
  openAppUrl: string
  resolveProfileByTg: (tgId: string) => Promise<Profile | null>
  escapeMd: (s: string) => string
}

const DEEP_CODE_RE = /^[A-Za-z0-9_-]{16,64}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const YES_LOGIN = '✅ Да, это я'
const YES_REGISTER = '✅ Да, подтвердить'
const NO = '❌ Нет'
const REMOVE_KEYBOARD = { remove_keyboard: true } as const
const PHONE_KEY_LENGTH = 10
const STALE_TEXT = '⌛ Запрос устарел. Вернитесь в приложение и нажмите кнопку ещё раз.'

// Номер телефона — та же логика, что в apps/api/src/lib/phone.ts (менять синхронно).
function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`
  if (digits.length === 10) digits = `7${digits}`
  if (digits.length < 11 || digits.length > 15) return null
  return `+${digits}`
}
const phoneKey = (phone: string) => phone.replace(/\D/g, '').slice(-PHONE_KEY_LENGTH)

function formatPhone(phone: string | null): string {
  const d = (phone ?? '').replace(/\D/g, '')
  if (d.length !== 11 || !d.startsWith('7')) return phone ?? '—'
  return `+7 ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9)}`
}

/** «1990-01-31» → «31.01.1990». */
function formatBirthday(value: string): string {
  const [y, m, d] = value.split('-')
  return y && m && d ? `${d}.${m}.${y}` : value
}

function isUniqueViolation(e: unknown): boolean {
  // Новые версии drizzle заворачивают ошибку Postgres в cause.
  const err = e as { code?: string; cause?: { code?: string } } | null
  return (err?.code ?? err?.cause?.code) === '23505'
}

export function registerAppLogin(bot: Bot, deps: AppLoginDeps) {
  const { db, escapeMd } = deps
  const openAppKeyboard = new InlineKeyboard().url('📱 Открыть приложение', deps.openAppUrl)

  /** Активный (не архивный) профиль, к которому привязан этот Telegram. */
  async function ownProfile(tgId: string): Promise<Profile | null> {
    const p = await deps.resolveProfileByTg(tgId)
    return p && !p.deletedAt ? p : null
  }

  async function findProfilesByPhone(phone: string | null): Promise<Profile[]> {
    const key = phoneKey(phone ?? '')
    if (key.length < PHONE_KEY_LENGTH) return []
    return db.select().from(profiles)
      .where(and(
        isNull(profiles.deletedAt),
        sql`right(regexp_replace(coalesce(${profiles.phone}, ''), '[^0-9]', '', 'g'), ${PHONE_KEY_LENGTH}) = ${key}`,
      ))
      .orderBy(profiles.createdAt)
  }

  /** Ждущая подтверждения строка этого Telegram (последняя открытая ссылка). */
  async function pendingRow(tgId: string, id?: string): Promise<WalletLoginCode | null> {
    const [row] = await db.select().from(walletLoginCodes)
      .where(and(
        id ? eq(walletLoginCodes.id, id) : undefined,
        eq(walletLoginCodes.tgId, tgId),
        isNotNull(walletLoginCodes.mode),
        eq(walletLoginCodes.status, 'pending'),
        gt(walletLoginCodes.expiresAt, new Date()),
      ))
      .orderBy(desc(walletLoginCodes.createdAt))
      .limit(1)
    return row ?? null
  }

  /** Атомарно: только пока строка ждёт (повторное подтверждение — no-op). */
  async function claim(rowId: string, profileId: string): Promise<boolean> {
    const done = await db.update(walletLoginCodes)
      .set({ status: 'claimed', profileId })
      .where(and(eq(walletLoginCodes.id, rowId), eq(walletLoginCodes.status, 'pending'), gt(walletLoginCodes.expiresAt, new Date())))
      .returning({ id: walletLoginCodes.id })
    return done.length > 0
  }

  async function reject(rowId: string, note: string): Promise<void> {
    await db.update(walletLoginCodes).set({ status: 'rejected', note })
      .where(and(eq(walletLoginCodes.id, rowId), eq(walletLoginCodes.status, 'pending')))
  }

  /** Привязать Telegram к профилю без Telegram (для уведомлений бота). Занят — не страшно. */
  async function linkTelegram(profileId: string, tgId: string, tgUsername: string | null): Promise<void> {
    try {
      await db.transaction(async (tx) => {
        const linked = await tx.update(profiles).set({ tgId, tgUsername })
          .where(and(eq(profiles.id, profileId), isNull(profiles.tgId)))
          .returning({ id: profiles.id })
        if (linked.length) await tx.insert(tgLinkRequests).values({ profileId, tgId, tgUsername, status: 'approved' })
      })
    } catch (e) {
      // tg_id уникален: этот Telegram уже у другого (например, архивного) профиля.
      if (!isUniqueViolation(e)) console.error(`[bot-wallet:${deps.label}] привязка Telegram не удалась:`, e)
    }
  }

  const deviceText = (row: WalletLoginCode) => (row.deviceName ? `«${escapeMd(row.deviceName)}»` : 'новом устройстве')

  async function askYesNo(ctx: Context, row: WalletLoginCode, profile: Profile, alreadyLinked: boolean) {
    const kb = new InlineKeyboard().text('✅ Да, войти', `ac:${row.id}`).text(NO, `ar:${row.id}`)
    const text = alreadyLinked
      ? `👋 Этот Telegram уже привязан к профилю *${escapeMd(profile.nickname)}*.\n\nВойти в него на устройстве ${deviceText(row)}?`
      : `🔐 *Вход в My Titan*\n\n${escapeMd(profile.nickname)}, подтвердите вход на устройстве ${deviceText(row)}.\n\nЕсли вы не входили — нажмите «Нет».`
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb })
  }

  async function askContact(ctx: Context, row: WalletLoginCode) {
    const register = row.mode === 'register'
    const kb = new Keyboard().requestContact(register ? YES_REGISTER : YES_LOGIN).row().text(NO).resized().oneTime()
    const reg = row.regData
    const text = register && reg
      ? `📝 *Регистрация в My Titan*\n\nНикнейм: *${escapeMd(reg.nickname)}*\nИмя: ${escapeMd(reg.fullName)}\nДень рождения: ${formatBirthday(reg.birthday)}\nТелефон: ${formatPhone(row.phone)}${reg.photoUrl ? '\nФото: добавлено' : ''}\n\n`
        + `Подтвердите регистрацию: нажмите «${YES_REGISTER}» внизу. Telegram пришлёт номер этого аккаунта — так мы проверим, что номер ваш.`
      : `🔐 *Вход в My Titan*\n\nВход по номеру ${formatPhone(row.phone)} на устройстве ${deviceText(row)}.\n\n`
        + `Это вы? Нажмите «${YES_LOGIN}» внизу. Telegram пришлёт номер этого аккаунта — так мы проверим, что номер ваш.`
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb })
  }

  async function sendDone(ctx: Context, profile: Profile, registered: boolean) {
    const what = registered ? 'Регистрация подтверждена' : 'Вход подтверждён'
    await ctx.reply(
      `🎉 Готово, *${escapeMd(profile.nickname)}*! ${what} — нажмите кнопку, чтобы открыть приложение.`,
      { parse_mode: 'Markdown', reply_markup: openAppKeyboard },
    )
  }

  /** /start app_<deepCode> — из bot.command('start'). */
  async function handleStart(ctx: Context, deepCode: string): Promise<void> {
    const tgId = String(ctx.from?.id)
    if (!DEEP_CODE_RE.test(deepCode)) {
      await ctx.reply('❌ Ссылка недействительна. Вернитесь в приложение и нажмите кнопку ещё раз.')
      return
    }
    const [row] = await db.select().from(walletLoginCodes)
      .where(and(
        eq(walletLoginCodes.deepCode, deepCode),
        isNotNull(walletLoginCodes.mode),
        eq(walletLoginCodes.status, 'pending'),
        gt(walletLoginCodes.expiresAt, new Date()),
      )).limit(1)
    if (!row) {
      await ctx.reply(STALE_TEXT)
      return
    }
    // С этого момента подтверждение принимаем только от этого Telegram.
    const bound = await db.update(walletLoginCodes).set({ tgId })
      .where(and(eq(walletLoginCodes.id, row.id), or(isNull(walletLoginCodes.tgId), eq(walletLoginCodes.tgId, tgId))))
      .returning({ id: walletLoginCodes.id })
    if (!bound.length) {
      await ctx.reply('❌ Эту ссылку уже открыли в другом Telegram. Начните вход в приложении заново.')
      return
    }

    const mine = await ownProfile(tgId)
    if (row.mode === 'register') {
      if (mine) await askYesNo(ctx, row, mine, true)
      else await askContact(ctx, row)
      return
    }
    const candidates = await findProfilesByPhone(row.phone)
    if (!candidates.length) {
      await reject(row.id, 'Профиль с этим номером не найден')
      await ctx.reply('❌ Профиль с этим номером не найден. Вернитесь в приложение и введите номер ещё раз.')
      return
    }
    const own = mine && candidates.find((p) => p.id === mine.id)
    if (own) await askYesNo(ctx, row, own, false)
    else await askContact(ctx, row)
  }

  // «Да, войти» — этот Telegram уже привязан к профилю.
  bot.callbackQuery(/^ac:(.+)$/, async (ctx) => {
    const id = ctx.match[1] ?? ''
    const tgId = String(ctx.from.id)
    const row = UUID_RE.test(id) ? await pendingRow(tgId, id) : null
    const mine = row ? await ownProfile(tgId) : null
    // При входе профиль Telegram обязан совпасть с найденным по номеру.
    const target = row?.mode === 'login'
      ? (mine && (await findProfilesByPhone(row.phone)).find((p) => p.id === mine.id)) || null
      : mine
    if (!row || !target || !(await claim(row.id, target.id))) {
      await ctx.answerCallbackQuery({ text: 'Запрос устарел' })
      await ctx.editMessageText(STALE_TEXT).catch(() => {})
      return
    }
    await ctx.answerCallbackQuery({ text: 'Вход подтверждён' })
    await ctx.editMessageText(
      `✅ Готово, *${escapeMd(target.nickname)}*! Вход подтверждён — нажмите кнопку, чтобы открыть приложение.`,
      { parse_mode: 'Markdown', reply_markup: openAppKeyboard },
    ).catch(() => {})
  })

  bot.callbackQuery(/^ar:(.+)$/, async (ctx) => {
    const id = ctx.match[1] ?? ''
    if (UUID_RE.test(id)) {
      await db.update(walletLoginCodes).set({ status: 'rejected', note: 'Вход отклонён в Telegram' })
        .where(and(eq(walletLoginCodes.id, id), eq(walletLoginCodes.tgId, String(ctx.from.id)), eq(walletLoginCodes.status, 'pending')))
    }
    await ctx.answerCallbackQuery({ text: 'Вход отклонён' })
    await ctx.editMessageText('🛡 Вход отклонён — доступ никому не выдан. Если это были не вы, ничего делать не нужно.').catch(() => {})
  })

  // «Нет» с клавиатуры под полем ввода (вариант с проверкой номера).
  bot.hears(NO, async (ctx) => {
    const row = await pendingRow(String(ctx.from?.id))
    if (row) await reject(row.id, row.mode === 'register' ? 'Регистрация отклонена в Telegram' : 'Вход отклонён в Telegram')
    await ctx.reply(row ? '🛡 Хорошо, запрос отклонён — доступ никому не выдан.' : 'Нет активного запроса.', { reply_markup: REMOVE_KEYBOARD })
  })

  /** Вход по проверенному номеру: профиль этого Telegram, иначе первый без Telegram. */
  async function profileForVerifiedPhone(row: WalletLoginCode, tgId: string, tgUsername: string | null): Promise<Profile | null> {
    const candidates = await findProfilesByPhone(row.phone)
    if (!candidates.length) return null
    const mine = await ownProfile(tgId)
    const own = mine && candidates.find((p) => p.id === mine.id)
    if (own) return own
    const target = candidates.find((p) => !p.tgId) ?? candidates[0]!
    if (!target.tgId && !mine) await linkTelegram(target.id, tgId, tgUsername)
    return target
  }

  type Registration = { ok: true; profile: Profile } | { ok: false; note: string; message: string }

  async function registerClient(row: WalletLoginCode, tgId: string, tgUsername: string | null): Promise<Registration> {
    const reg = row.regData
    if (!reg) return { ok: false, note: 'Анкета не найдена', message: '❌ Анкета не найдена. Заполните её в приложении ещё раз.' }
    const mine = await ownProfile(tgId)
    if (mine) return { ok: true, profile: mine }
    const taken = { ok: false as const, note: `Никнейм «${reg.nickname}» уже занят`, message: `❌ Никнейм «${reg.nickname}» уже занят. Вернитесь в приложение и придумайте другой.` }
    const [nickHit] = await db.select({ id: profiles.id }).from(profiles)
      .where(sql`lower(${profiles.nickname}) = lower(${reg.nickname})`).limit(1)
    if (nickHit) return taken
    // Telegram может держать архивный профиль (tg_id уникален) — тогда без привязки.
    const [tgHolder] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.tgId, tgId)).limit(1)
    try {
      const [created] = await db.insert(profiles).values({
        nickname: reg.nickname,
        fullName: reg.fullName,
        birthday: reg.birthday,
        phone: row.phone,
        photoUrl: reg.photoUrl ?? null,
        role: 'client',
        tgId: tgHolder ? null : tgId,
        tgUsername: tgHolder ? null : tgUsername,
      }).returning()
      return created ? { ok: true, profile: created } : taken
    } catch (e) {
      if (isUniqueViolation(e)) return taken
      throw e
    }
  }

  bot.on('message:contact', async (ctx) => {
    const tgId = String(ctx.from.id)
    const contact = ctx.message.contact
    const row = await pendingRow(tgId)
    if (!row) {
      await ctx.reply('Нет активного запроса. Начните вход в приложении My Titan.', { reply_markup: REMOVE_KEYBOARD })
      return
    }
    if (String(contact.user_id ?? '') !== tgId) {
      await ctx.reply(`Нажмите кнопку «${row.mode === 'register' ? YES_REGISTER : YES_LOGIN}» внизу — нужен номер вашего аккаунта, а не чужой контакт.`)
      return
    }
    const verified = normalizePhone(contact.phone_number)
    if (!verified || phoneKey(verified) !== phoneKey(row.phone ?? '')) {
      await reject(row.id, `Номер этого Telegram (${formatPhone(verified)}) не совпадает с введённым`)
      await ctx.reply(
        `❌ Номер этого Telegram — ${formatPhone(verified)}, а в приложении введён ${formatPhone(row.phone)}.\n\nВернитесь в приложение и введите номер этого Telegram-аккаунта.`,
        { reply_markup: REMOVE_KEYBOARD },
      )
      return
    }

    const tgUsername = ctx.from.username ?? null
    // Номер могли добавить в клуб, пока клиент заполнял анкету, — тогда это вход.
    const existing = await profileForVerifiedPhone(row, tgId, tgUsername)
    let profile = existing
    if (!profile && row.mode === 'register') {
      const result = await registerClient(row, tgId, tgUsername)
      if (!result.ok) {
        await reject(row.id, result.note)
        await ctx.reply(result.message, { reply_markup: REMOVE_KEYBOARD })
        return
      }
      profile = result.profile
    }
    if (!profile || !(await claim(row.id, profile.id))) {
      await ctx.reply(STALE_TEXT, { reply_markup: REMOVE_KEYBOARD })
      return
    }
    await ctx.reply('✅ Номер подтверждён', { reply_markup: REMOVE_KEYBOARD })
    await sendDone(ctx, profile, !existing)
  })

  return { handleStart }
}
