/**
 * Отчёт аналитики: что вышло за период, как зашло (просмотры, лайки, рост
 * подписчиков), как это совпало с жизнью клуба (гости по дням) — и что делать
 * дальше. Выводы Tai запоминает и учитывает в следующих планах и постах.
 */
import { sql, type Database } from '@titan/database'
import { z } from 'zod'
import { chatJson } from './ai.js'
import { clubTitle, marketingContext, mskDate } from './context.js'
import { listAccounts, listPosts, mapReport, remember, rows } from './db.js'
import { systemPrompt, todayLine } from './prompts.js'
import type { SmmReport } from './types.js'

const ReportSchema = z.object({
  title: z.string().min(3).max(120),
  summary: z.string().min(20).max(3000),
  metrics: z.array(z.object({ label: z.string().max(60), value: z.string().max(40), delta: z.number().nullable().optional() })).max(8),
  recommendations: z.array(z.object({ title: z.string().max(120), detail: z.string().max(500) })).min(1).max(6),
  insights: z.array(z.string().min(5).max(300)).max(3).optional(),
})

const day = (offset: number) => mskDate(Date.now() + offset * 86_400_000)

/** Отчёт за период (по умолчанию — прошлые 7 дней). */
export async function generateReport(db: Database, period?: { from: string; to: string }): Promise<SmmReport> {
  const from = period?.from ?? day(-7)
  const to = period?.to ?? day(-1)
  const fromIso = new Date(`${from}T00:00:00+03:00`).toISOString()
  const toIso = new Date(Date.parse(`${to}T00:00:00+03:00`) + 86_400_000).toISOString()
  const [name, marketing, accounts, posts, history, visits] = await Promise.all([
    clubTitle(db),
    marketingContext(db),
    listAccounts(db),
    listPosts(db, { from: fromIso, to: toIso }),
    db.execute(sql`
      SELECT a.title, a.platform, s.day, s.followers, s.views FROM smm_account_stats s JOIN smm_accounts a ON a.id = s.account_id
      WHERE s.day BETWEEN ${from}::date - 7 AND ${to}::date ORDER BY s.day
    `).then((r) => rows<Record<string, unknown>>(r)),
    db.execute(sql`
      SELECT ((closed_at AT TIME ZONE 'Europe/Moscow') - interval '6 hours')::date AS d, count(*)::int AS n
      FROM checks WHERE status = 'closed' AND closed_at >= ${fromIso}::timestamptz - interval '7 days' AND closed_at < ${toIso}::timestamptz
      GROUP BY 1 ORDER BY 1
    `).then((r) => rows<Record<string, unknown>>(r)).catch(() => []),
  ])
  const postLines = posts.map((p) => {
    const s = p.stats
    const nums = (['views', 'likes', 'comments', 'shares', 'saves', 'reach'] as const).filter((k) => s[k] != null).map((k) => `${k} ${s[k]}`).join(', ')
    return `- ${p.publishAt?.slice(0, 10)} ${p.platform}/${p.format} [${p.status}] ${p.topic}${nums ? ` → ${nums}` : ' → цифр нет'}`
  })
  const fmtDay = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))
  const r = await chatJson(db, {
    system: systemPrompt(name),
    note: `отчёт ${from}..${to}`,
    maxTokens: 3500,
    temperature: 0.4,
    schema: ReportSchema,
    user: [
      todayLine(),
      `Маркетинг:\n${marketing.text}`,
      '',
      `Отчёт за ${from}..${to}.`,
      `Площадки сейчас: ${accounts.map((a) => `${a.platform} ${a.title}: подписчиков ${a.followers ?? '?'}${a.statsError ? ` (${a.statsError})` : ''}`).join('; ') || 'не подключены'}`,
      history.length ? `Динамика площадок по дням:\n${history.map((h) => `${fmtDay(h['day'])} ${h['title']}: подписчики ${h['followers'] ?? '?'}, охват/просмотры ${h['views'] ?? '?'}`).join('\n')}` : 'Истории цифр площадок пока нет.',
      postLines.length ? `Публикации периода:\n${postLines.join('\n')}` : 'Публикаций за период нет.',
      visits.length ? `Гостей (закрытых чеков) по дням, включая неделю до периода:\n${visits.map((v) => `${fmtDay(v['d'])}: ${v['n']}`).join(', ')}` : '',
      '',
      'Разбери честно и коротко: что сработало, что нет и почему, есть ли связь публикаций с гостями. Рекомендации — конкретные действия на следующую неделю.',
      'Ответ — JSON: {"title": "заголовок отчёта", "summary": "3–6 предложений выводов", "metrics": [{"label": "...", "value": "...", "delta": % или null}], "recommendations": [{"title": "что сделать", "detail": "как и зачем"}], "insights": ["устойчивый вывод на будущее, если есть"]}',
    ].filter((line) => line !== '').join('\n'),
  })
  const [row] = rows<Record<string, unknown>>(await db.execute(sql`
    INSERT INTO smm_reports (period_from, period_to, title, summary, metrics, recommendations)
    VALUES (${from}::date, ${to}::date, ${r.title}, ${r.summary}, ${JSON.stringify(r.metrics)}::jsonb, ${JSON.stringify(r.recommendations)}::jsonb)
    RETURNING *
  `))
  for (const text of r.insights ?? []) await remember(db, { kind: 'insight', text, source: 'analytics' })
  return mapReport(row!)
}
