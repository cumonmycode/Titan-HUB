import { db, type Database } from '@titan/database'
import { getClubIntegration } from '../lib/secrets.js'
import { readPollConfigs, writePollConfigs, isPollDue, postPollConfig } from '../lib/polls.js'
import { recordPollPosted } from '../lib/pollState.js'

// ─────────────────────────────────────────────────────────────────────────────
// Постинг регулярных опросов в Telegram. Вызывается планировщиком (index.ts)
// КАЖДУЮ МИНУТУ по всем активным клубам + основной БД. Для каждого клуба читает
// его конфиги (app_settings.poll_configs) и токен (integrations.poll_bot_token);
// постит «созревшие» (isPollDue) и сохраняет lastPostedAt. НЕ бросает наружу.
// database — БД клуба; дефолт = синглтон (одно-клубный режим).
// ─────────────────────────────────────────────────────────────────────────────

// БД клубов, по которым проход ещё идёт (как в cron/fiscalize.ts): тик раз в минуту,
// а запрос в Telegram может висеть дольше — без защиты следующий тик видел тот же
// «созревший» опрос (lastPostedAt ещё не записан) и постил его второй раз.
const running = new WeakSet<Database>()

export async function runPollsForDb(database: Database = db): Promise<void> {
  if (running.has(database)) return
  running.add(database)
  try {
    await runPolls(database)
  } finally {
    running.delete(database)
  }
}

async function runPolls(database: Database): Promise<void> {
  let configs
  try {
    configs = await readPollConfigs(database)
  } catch {
    return
  }
  if (!configs.length) return

  const now = Date.now()
  const due = configs.filter((c) => isPollDue(c, now))
  if (!due.length) return

  const token = await getClubIntegration(database, 'poll_bot_token').catch(() => null)
  if (!token) {
    console.error('[polls] есть опросы к постингу, но poll_bot_token не задан — пропуск')
    return
  }

  // id опроса → момент успешной отправки.
  const posted = new Map<string, string>()
  for (const cfg of due) {
    const r = await postPollConfig(token, cfg)
    if (r.ok) {
      posted.set(cfg.id, new Date().toISOString())
      // Запоминаем как «последний опрос» чата (для @tvari).
      if (r.pollId) {
        await recordPollPosted(database, cfg.chatId, r.pollId, r.messageId ?? 0, cfg.threadId, cfg.options).catch((e) =>
          console.error('[polls] recordPollPosted', e),
        )
      }
      console.log(`[polls] опрос «${cfg.title}» отправлен в ${cfg.chatId}${cfg.threadId ? `/${cfg.threadId}` : ''}`)
    } else {
      console.error(`[polls] не удалось отправить «${cfg.title}» (${cfg.chatId}): ${r.error}`)
    }
  }
  if (posted.size) {
    try {
      // Перечитываем конфиги перед записью: пока шла отправка, владелец мог их поменять
      // (выключить/удалить опрос) — пишем поверх свежих, проставляя только lastPostedAt
      // отправленным, а не затираем его правки снимком начала тика. Пусто — не пишем
      // (всё удалено, либо чтение не удалось: не затираем конфиги пустым списком).
      const fresh = await readPollConfigs(database)
      if (fresh.length) {
        await writePollConfigs(database, fresh.map((c) => {
          const at = posted.get(c.id)
          return at ? { ...c, lastPostedAt: at } : c
        }))
      }
    } catch (e) {
      console.error('[polls] не удалось сохранить lastPostedAt', e)
    }
  }
}
