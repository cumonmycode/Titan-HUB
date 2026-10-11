/**
 * Ответы ИИ по базе клуба: вопрос → SQL (только чтение) → данные. Общий для старого
 * эндпоинта /ai/chat и инструмента ask_database нового Tai (только владельцу).
 */
import { sql } from '@titan/database'
import type { Database } from '@titan/database'
import { getClubIntegration } from '../../lib/secrets.js'

// Источник БД для модульных хелперов: пер-запросный c.var.db (на основном домене
// === синглтон) либо tx внутри read-only транзакции answerFromDb/runReadonly.
export type DbOrTx = Database | Parameters<Parameters<Database['transaction']>[0]>[0]

// Снимаем возможные кавычки/пробелы вокруг значений из .env (docker не всегда их убирает)
const clean = (v: string | undefined): string => (v ?? '').trim().replace(/^["']|["']$/g, '')
const POLZA_BASE = clean(process.env['POLZA_BASE_URL']) || 'https://polza.ai/api/v1'
// id модели на Polza: с префиксом провайдера и точкой в версии
const POLZA_MODEL = clean(process.env['POLZA_MODEL']) || 'google/gemini-3.1-flash-lite'

export async function callAI(db: Database, systemPrompt: string, userMessage: string): Promise<string> {
  // Ключ AI — пер-клубный (integrations БД клуба) с фолбэком на env. На основном
  // домене integrations пусты → env POLZA_API_KEY (одно-клубный прод не затронут).
  // BASE_URL/MODEL остаются из env.
  const apiKey = clean((await getClubIntegration(db, 'ai_api_key')) ?? process.env['POLZA_API_KEY'])
  const res = await fetch(`${POLZA_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: POLZA_MODEL,
      max_tokens: 2048,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Polza AI error: ${res.status} ${body.slice(0, 300)}`)
  }
  const data = await res.json() as { choices?: { message?: { content?: string } }[] }
  return data.choices?.[0]?.message?.content ?? ''
}

// ─── Произвольные вопросы по базе (text-to-SQL) ──────────────────────────────
// Схема базы из information_schema (кэш 5 мин). Исключаем служебные и
// чувствительные таблицы/колонки (пароли, пины, токены, ключи).
let schemaCache: { doc: string; ts: number } | null = null
const SENSITIVE_TABLES = new Set(['_migrations', 'push_subscriptions'])
const SENSITIVE_COL = /pass|pin|hash|secret|token|credential|webauthn|private_key|public_key/i

async function getSchemaDoc(db: DbOrTx): Promise<string> {
  if (schemaCache && Date.now() - schemaCache.ts < 300000) return schemaCache.doc
  const res: any = await db.execute(sql`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `)
  const rows: any[] = res.rows ?? res ?? []
  const byTable = new Map<string, string[]>()
  for (const r of rows) {
    const t = String(r.table_name)
    if (SENSITIVE_TABLES.has(t)) continue
    if (SENSITIVE_COL.test(String(r.column_name))) continue
    if (!byTable.has(t)) byTable.set(t, [])
    byTable.get(t)!.push(`${r.column_name} ${r.data_type}`)
  }
  const doc = [...byTable.entries()].map(([t, cols]) => `${t}(${cols.join(', ')})`).join('\n')
  schemaCache = { doc, ts: Date.now() }
  return doc
}

// Жёсткая проверка: только одиночный SELECT/WITH на чтение, без DDL/DML и секретов.
function sanitizeSql(raw: string): string {
  let s = (raw || '').trim().replace(/```sql/gi, '').replace(/```/g, '').trim()
  const semi = s.indexOf(';')
  if (semi >= 0) s = s.slice(0, semi).trim()
  const lower = s.toLowerCase()
  if (!/^(select|with)\b/.test(lower)) throw new Error('Не SELECT-запрос')
  if (/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|merge|call|vacuum|reindex|lock|begin|commit|rollback)\b/.test(lower)) throw new Error('Запрещённая операция')
  if (/\binto\b/.test(lower)) throw new Error('INTO запрещён')
  if (SENSITIVE_COL.test(lower) || /push_subscription/.test(lower)) throw new Error('Чувствительные данные')
  return s
}

// Вырезаем чувствительные поля из результата по имени ключа (в т.ч. во вложенных
// json-объектах): sanitizeSql проверяет только текст запроса, а `SELECT *` или
// row_to_json(...) всё равно вернут pin/password_hash — в ИИ они уйти не должны.
function stripSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSensitive)
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !SENSITIVE_COL.test(k))
        .map(([k, v]) => [k, stripSensitive(v)]),
    )
  }
  return value
}

// Выполнение в READ ONLY транзакции с таймаутом и лимитом строк.
async function runReadonly(db: Database, query: string): Promise<any[]> {
  const wrapped = `SELECT * FROM (${query}) AS _q LIMIT 200`
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`)
    await tx.execute(sql`SET LOCAL statement_timeout = '5000'`)
    const res: any = await tx.execute(sql.raw(wrapped))
    return ((res.rows ?? res ?? []) as any[]).map((r) => stripSensitive(r))
  })
}

const SQLGEN_PROMPT = [
  'Ты эксперт PostgreSQL. По схеме базы и вопросу составь ОДИН SQL-запрос ТОЛЬКО на чтение (SELECT).',
  'Правила: только SELECT или WITH...SELECT; без INSERT/UPDATE/DELETE/DDL; одна инструкция без «;».',
  'Используй ТОЛЬКО таблицы и колонки из схемы. Имена людей сравнивай через ILIKE \'%...%\' (без регистра).',
  'Долг клиента = отрицательный profiles.balance при role=\'client\'; депозит = положительный balance.',
  'Остаток товара = inventory.stock_quantity; учёт = inventory.track_stock=true; «нет в наличии» = stock_quantity=0; «заканчивается» = stock_quantity<=min_threshold.',
  'Денежные/числовые поля часто text/numeric — при сравнении и агрегации приводи через ::numeric.',
  'Закрытые чеки: checks.status=\'closed\'. Ставь разумный LIMIT. Ответь ТОЛЬКО SQL, без пояснений и markdown.',
].join(' ')

// Полный конвейер: вопрос → SQL → выполнение → блок данных для финального ответа ИИ.
export async function answerFromDb(db: Database, query: string): Promise<string | null> {
  try {
    const schema = await getSchemaDoc(db)
    const rawSql = await callAI(db, SQLGEN_PROMPT, `СХЕМА БАЗЫ:\n${schema}\n\nВОПРОС: ${query}`)
    const clean = sanitizeSql(rawSql)
    const rows = await runReadonly(db, clean)
    const json = JSON.stringify(rows).slice(0, 6000)
    return `Чтобы ответить, выполнен SQL-запрос к базе:\n${clean}\n\nРЕЗУЛЬТАТ (${rows.length} строк):\n${json}`
  } catch {
    // Не валим запрос — вернём null, выше подставится снимок-фоллбек.
    return null
  }
}
