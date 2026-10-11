import { db, profiles, notifications, appSettings, bonusHistory, type Database } from '@titan/database'
import { eq, and, isNull, inArray, sql } from 'drizzle-orm'
import { accrueBonusLot, expireBonuses, getBonusExpiryDays } from '../lib/bonusLots.js'
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

  // Clients with birthday today. birthday — свободный text, поэтому НЕ кастуем в
  // ::date (битая строка уронила бы весь запрос). Сравниваем MM-DD через substring
  // только для строк формата YYYY-MM-DD.
  const birthdayClients = await database
    .select({ id: profiles.id, nickname: profiles.nickname, birthday: profiles.birthday, phone: profiles.phone })
    .from(profiles)
    .where(and(
      eq(profiles.role, 'client'),
      isNull(profiles.deletedAt),
      sql`${profiles.birthday} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'`,
      sql`substring(${profiles.birthday} from 6 for 5) = ${mmdd}`,
    ))

  if (birthdayClients.length === 0) {
    console.log(`[birthdays] No birthdays today (${mmdd})`)
    return
  }

  // Настройки бонуса ко дню рождения (раздел «Бонусы»).
  const settingRows = await database.select().from(appSettings)
    .where(inArray(appSettings.key, ['bonus_enabled', 'birthday_bonus_enabled', 'birthday_bonus_amount']))
  const settings = Object.fromEntries(settingRows.map(r => [r.key, r.value]))
  // Требуется и общий тумблер программы, и тумблер бонуса ко дню рождения.
  const bonusEnabled = settings['bonus_enabled'] !== 'false' && settings['birthday_bonus_enabled'] === 'true'
  const bonusAmount = Math.max(0, Math.floor(parseFloat(settings['birthday_bonus_amount'] ?? '0')))

  // Начисляем бонус каждому имениннику — идемпотентно (один раз в день).
  const credited = new Set<string>()
  if (bonusEnabled && bonusAmount > 0) {
    // Срок сгорания на момент начисления (null = бессрочно).
    const expiryDays = await getBonusExpiryDays(database)
    for (const client of birthdayClients) {
      try {
        const done = await database.transaction(async (tx) => {
          const already = await tx.select({ id: bonusHistory.id }).from(bonusHistory)
            .where(and(
              eq(bonusHistory.profileId, client.id),
              eq(bonusHistory.reason, 'Бонус ко дню рождения'),
              sql`DATE(${bonusHistory.createdAt}) = CURRENT_DATE`,
            )).limit(1)
          if (already.length > 0) return false
          const [p] = await tx.select({ bonusPoints: profiles.bonusPoints })
            .from(profiles).where(eq(profiles.id, client.id)).for('update')
          if (!p) return false
          const newBonus = (parseFloat(p.bonusPoints) || 0) + bonusAmount
          await tx.update(profiles).set({ bonusPoints: String(newBonus) }).where(eq(profiles.id, client.id))
          await tx.insert(bonusHistory).values({
            profileId: client.id,
            amount: String(bonusAmount),
            balanceAfter: String(newBonus),
            reason: 'Бонус ко дню рождения',
          })
          // Параллельный лот, чтобы бонус ко дню рождения умел сгорать по сроку.
          await accrueBonusLot(tx, client.id, bonusAmount, expiryDays)
          return true
        })
        if (done) credited.add(client.id)
      } catch (e) {
        console.error('[birthdays] bonus credit failed for', client.id, e)
      }
    }
  }

  // All owners to notify
  const owners = await database
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.role, 'owner'), isNull(profiles.deletedAt)))

  for (const client of birthdayClients) {
    const age = client.birthday
      ? year - parseInt(client.birthday.split('-')[0])
      : null

    const base = age
      ? `Сегодня ${age} ${pluralAge(age)}: ${client.nickname}`
      : `День рождения: ${client.nickname}`
    const body = credited.has(client.id) ? `${base} · +${bonusAmount} бонусов` : base

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
