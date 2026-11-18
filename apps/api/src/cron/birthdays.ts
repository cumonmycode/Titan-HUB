import { randomBytes } from 'node:crypto'
import { db, profiles, notifications, appSettings, bonusHistory, certificates, type Database } from '@titan/database'
import { eq, and, isNull, inArray, sql } from 'drizzle-orm'
import { expireBonuses } from '../lib/bonusLots.js'
import { creditBonus } from '../lib/bonusAccrual.js'
import { notifyClient } from '../modules/notifications/client.js'
import { parseBirthdayGift } from '../lib/birthdayGift.js'
import { isRegistrationPending } from '../lib/registration.js'
import { getWhatsAppConfig, sendWhatsAppTemplate } from '../lib/whatsapp.js'
import { notify } from '../modules/notifications/push.js'

// database — БД клуба (пер-клубный cron). Дефолт = синглтон (одно-клубный режим /
// основной клуб): поведение прежнее. Планировщик передаёт db каждого active-клуба.
// clubId — для SSE-канала уведомлений клуба (notify); null = основной домен.
export async function checkBirthdays(database: Database = db, clubId: string | null = null) {
  // Ежедневный проход сгорания бонусов: список дней рождения мог быть пустым,
  // но сгорание должно отрабатывать каждый запуск. Изолируем от остального крона.
  try {
    const expiredCount = await expireBonuses(database)
    if (expiredCount > 0) console.log(`[bonus-expiry] burned bonuses for ${expiredCount} client(s)`)
  } catch (e) {
    console.error('[bonus-expiry] pass failed', e)
  }

  // Дата по Москве (UTC+3) — независимо от TZ контейнера и времени запуска.
  const msk = new Date(Date.now() + 3 * 3600 * 1000)
  const mm = String(msk.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(msk.getUTCDate()).padStart(2, '0')
  const mmdd = `${mm}-${dd}`
  const year = msk.getUTCFullYear()

  const owners = await database
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.role, 'owner'), isNull(profiles.deletedAt)))

  // Настройки подарка ко дню рождения (раздел «Лояльность → Подарки»).
  const settingRows = await database.select().from(appSettings).where(inArray(appSettings.key, [...BIRTHDAY_KEYS]))
  const gift = parseBirthdayGift(Object.fromEntries(settingRows.map(r => [r.key, r.value])))

  // Подарок приходит заранее (за N дней) — именинники «через N дней».
  const giftDay = mskDate(gift.daysBefore)
  const credited = new Map<string, string>()
  if (gift.enabled) {
    const giftClients = await clientsWithBirthday(database, giftDay.mmdd)
    for (const client of giftClients) {
      // Регистрация ещё не подтверждена персоналом — подарка нет.
      if (isRegistrationPending(client)) continue
      const amount = gift.tierAmounts[client.clientTier] ?? gift.amount
      if (!(amount > 0)) continue
      try {
        const done = await database.transaction(async (tx) => {
          // Один подарок в год: отметка в истории бонусов за последние 300 дней.
          const already = await tx.select({ id: bonusHistory.id }).from(bonusHistory)
            .where(and(
              eq(bonusHistory.profileId, client.id),
              inArray(bonusHistory.reason, [BIRTHDAY_REASON, BIRTHDAY_CERT_REASON]),
              sql`${bonusHistory.createdAt} > now() - interval '300 days'`,
            )).limit(1)
          if (already.length > 0) return null
          if (gift.kind === 'certificate' && owners[0]) {
            const code = `BD-${giftDay.year}-${randomBytes(3).toString('hex').toUpperCase()}`
            await tx.insert(certificates).values({
              code, nominal: String(amount), balance: String(amount), createdBy: owners[0].id,
              title: 'Подарок ко дню рождения', recipient: client.nickname,
              validUntil: mskDate(gift.daysBefore + gift.certificateDays).date,
              note: `Автоматически к ${giftDay.date.slice(8, 10)}.${giftDay.date.slice(5, 7)}`,
            })
            // Отметка без движения баланса — чтобы не выдать второй раз.
            const [p] = await tx.select({ bonusPoints: profiles.bonusPoints }).from(profiles).where(eq(profiles.id, client.id))
            await tx.insert(bonusHistory).values({ profileId: client.id, amount: '0', balanceAfter: p?.bonusPoints ?? '0', reason: BIRTHDAY_CERT_REASON })
            return `сертификат ${code} на ${amount} ₽`
          }
          await creditBonus(tx, client.id, amount, BIRTHDAY_REASON)
          return `+${amount} бонусов`
        })
        if (done) {
          credited.set(client.id, done)
          void notifyClient(client.id, {
            kind: 'bonus',
            title: '🎂 Подарок ко дню рождения',
            body: gift.kind === 'certificate' ? `Для вас ${done}. Покажите номер на кассе.` : `Вам ${done} — с наступающим!`,
            meta: { screen: 'bonus' },
          }, database)
        }
      } catch (e) {
        console.error('[birthdays] gift failed for', client.id, e)
      }
    }
  }

  // Именинники сегодня — владельцам.
  const birthdayClients = await clientsWithBirthday(database, mmdd)
  if (birthdayClients.length === 0) {
    console.log(`[birthdays] No birthdays today (${mmdd})`)
    return
  }

  for (const client of birthdayClients) {
    const age = client.birthday
      ? year - parseInt(client.birthday.split('-')[0])
      : null

    const base = age
      ? `Сегодня ${age} ${pluralAge(age)}: ${client.nickname}`
      : `День рождения: ${client.nickname}`
    const body = credited.has(client.id) ? `${base} · ${credited.get(client.id)}` : base

    for (const owner of owners) {
      // Avoid duplicate notifications for the same client+owner today
      const existing = await database
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(
          eq(notifications.userId, owner.id),
          eq(notifications.type, 'birthday'),
          sql`DATE(${notifications.createdAt}) = CURRENT_DATE`,
          sql`${notifications.meta}->>'clientId' = ${client.id}`,
        ))
        .limit(1)

      if (existing.length > 0) continue

      // Через notify, а не прямой insert: иначе тип 'birthday' не доходил до push,
      // iPhone-приложения, Telegram и SSE (только запись в ленте). notify не бросает.
      await notify({
        type: 'birthday',
        title: '🎂 День рождения клиента',
        body,
        meta: { clientId: client.id, nickname: client.nickname, age },
        userId: owner.id,
      }, database, clubId)
    }
  }

  // ── Поздравление в WhatsApp (одобренным шаблоном) ──────────────────────────────
  // Гейт: настроены креды + включён тумблер + задан шаблон. Идемпотентно: маркер
  // wa_birthday на клиента раз в день (повторный запуск крона не дублирует).
  try {
    const waCfg = await getWhatsAppConfig(database)
    const waRows = await database.select().from(appSettings)
      .where(inArray(appSettings.key, ['whatsapp_birthday_enabled', 'whatsapp_birthday_template', 'whatsapp_lang']))
    const wa = Object.fromEntries(waRows.map((r) => [r.key, r.value]))
    const waTemplate = wa['whatsapp_birthday_template'] || ''
    if (waCfg && wa['whatsapp_birthday_enabled'] === 'true' && waTemplate) {
      const lang = wa['whatsapp_lang'] || 'ru'
      for (const client of birthdayClients) {
        if (!client.phone) continue
        const dup = await database.select({ id: notifications.id }).from(notifications)
          .where(and(
            eq(notifications.type, 'wa_birthday'),
            eq(notifications.userId, client.id),
            sql`DATE(${notifications.createdAt}) = CURRENT_DATE`,
          )).limit(1)
        if (dup.length > 0) continue
        const r = await sendWhatsAppTemplate(waCfg, client.phone, waTemplate, lang, [client.nickname])
        await database.insert(notifications).values({
          type: 'wa_birthday',
          title: 'WhatsApp-поздравление',
          body: r.ok ? `Отправлено ${client.nickname}` : `Ошибка: ${r.error ?? '—'}`,
          meta: { clientId: client.id, ok: r.ok, error: r.error ?? null },
          userId: client.id,
        })
        if (!r.ok) console.error(`[birthdays:wa] ${client.nickname}: ${r.error}`)
      }
    }
  } catch (e) {
    console.error('[birthdays:wa] pass failed', e)
  }

  console.log(`[birthdays] Processed ${birthdayClients.length} birthday(s) for ${mmdd}`)
}

function pluralAge(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return 'лет'
  if (mod10 === 1) return 'год'
  if (mod10 >= 2 && mod10 <= 4) return 'года'
  return 'лет'
}

const BIRTHDAY_REASON = 'Бонус ко дню рождения'
const BIRTHDAY_CERT_REASON = 'Сертификат ко дню рождения'
const BIRTHDAY_KEYS = ['bonus_enabled', 'birthday_bonus_enabled', 'birthday_bonus_amount', 'birthday_tier_amounts', 'birthday_bonus_days_before', 'birthday_gift_kind', 'birthday_certificate_days'] as const

/** Дата по Москве со сдвигом в днях. */
function mskDate(offsetDays: number): { date: string; mmdd: string; year: number } {
  const d = new Date(Date.now() + 3 * 3600_000 + offsetDays * 86_400_000)
  const date = d.toISOString().slice(0, 10)
  return { date, mmdd: date.slice(5), year: d.getUTCFullYear() }
}

/** Клиенты с днём рождения в этот день (MM-DD). birthday — свободный text: без ::date. */
async function clientsWithBirthday(database: Database, mmdd: string) {
  return database
    .select({ id: profiles.id, nickname: profiles.nickname, birthday: profiles.birthday, phone: profiles.phone, registrationStatus: profiles.registrationStatus, clientTier: profiles.clientTier })
    .from(profiles)
    .where(and(
      eq(profiles.role, 'client'),
      isNull(profiles.deletedAt),
      sql`${profiles.birthday} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'`,
      sql`substring(${profiles.birthday} from 6 for 5) = ${mmdd}`,
    ))
}
