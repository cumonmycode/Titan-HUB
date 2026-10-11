// Резервное копирование/восстановление БД из самого API (кнопки в «О системе»).
// Использует pg_dump/psql (postgresql16-client) поверх DATABASE_URL и rclone для
// выгрузки/скачивания в Google Drive. Все эти бинарники добавлены в образ api
// (apps/api/Dockerfile), а /backups и конфиг rclone примонтированы (docker-compose).
import { promisify } from 'node:util'
import { exec as _exec } from 'node:child_process'
import { mkdir, stat, readdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { createGunzip } from 'node:zlib'
import { createInterface } from 'node:readline'
import { getSharedRedis } from './redis.js'

const exec = promisify(_exec)
const BIG = 1024 * 1024 * 256 // maxBuffer для exec

const BACKUP_DIR = process.env['BACKUP_DIR'] ?? '/backups'
const REMOTE = process.env['BACKUP_RCLONE_REMOTE'] ?? 'gdrive'
const REMOTE_DIR = process.env['BACKUP_RCLONE_DIR'] ?? 'titan-backups'
const KEEP_DAYS = Number(process.env['BACKUP_KEEP_DAYS'] ?? 14)

// PG-переменные окружения из DATABASE_URL (пароль НЕ попадает в командную строку).
function pgEnv(): NodeJS.ProcessEnv {
  const u = new URL(process.env['DATABASE_URL'] ?? '')
  return {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: u.pathname.replace(/^\//, ''),
  }
}

// ─── Mutex backup/restore (Redis с in-process-фолбэком) ──────────────────────
// Защита от одновременного запуска backup/restore: два параллельных дампа/
// восстановления могут затоптать друг друга (порча данных). Lock общий на обе
// операции. Redis недоступен → деградируем до in-memory-флага (одна реплика).

const LOCK_KEY = 'backup:lock'
const LOCK_TTL_MS = 30 * 60 * 1000 // 30 мин — авто-снятие, если процесс упал в середине
let inProcessLock = false // фолбэк, когда Redis недоступен (single-instance)

export class BackupBusyError extends Error {
  constructor() {
    super('Резервное копирование/восстановление уже выполняется')
    this.name = 'BackupBusyError'
  }
}

// Выполнить fn под эксклюзивным локом backup/restore. Параллельный вызов → BackupBusyError.
export async function withBackupLock<T>(fn: () => Promise<T>): Promise<T> {
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`
  let viaRedis = false
  try {
    const redis = getSharedRedis()
    // SET key token NX PX ttl — атомарный захват с авто-истечением.
    const ok = await redis.set(LOCK_KEY, token, 'PX', LOCK_TTL_MS, 'NX')
    if (ok === 'OK') {
      viaRedis = true
    } else {
      throw new BackupBusyError()
    }
  } catch (e) {
    if (e instanceof BackupBusyError) throw e
    // Redis недоступен — фолбэк на in-process-флаг (защищает single-instance).
    if (inProcessLock) throw new BackupBusyError()
    inProcessLock = true
  }
  try {
    return await fn()
  } finally {
    if (viaRedis) {
      // Снимаем лок только если он всё ещё наш (не затёрли чужим после TTL).
      try {
        const redis = getSharedRedis()
        const cur = await redis.get(LOCK_KEY)
        if (cur === token) await redis.del(LOCK_KEY)
      } catch { /* истечёт по TTL */ }
    } else {
      inProcessLock = false
    }
  }
}

// ─── Maintenance-режим клуба (флаг в Redis) ──────────────────────────────────
// На время restore переводим клуб в обслуживание. Денежные/мутирующие эндпоинты
// могут читать этот флаг и отбивать запись 503, чтобы касса/оплата не писали в
// БД, пока она восстанавливается. Ключ пер-клубный (clubId|'default' на синглтоне).

const maintenanceKey = (clubId: string | null | undefined): string => `maintenance:${clubId ?? 'default'}`

export async function setMaintenance(clubId: string | null | undefined, on: boolean): Promise<void> {
  try {
    const redis = getSharedRedis()
    if (on) {
      // TTL как у лока — страховка, чтобы клуб не «завис» в обслуживании при падении процесса.
      await redis.set(maintenanceKey(clubId), '1', 'PX', LOCK_TTL_MS)
    } else {
      await redis.del(maintenanceKey(clubId))
    }
  } catch { /* Redis недоступен — энфорсмент пропускаем, рассчитываем на mutex */ }
}

// Проверка флага обслуживания (для middleware/денежных эндпоинтов).
export async function isMaintenance(clubId: string | null | undefined): Promise<boolean> {
  try {
    const redis = getSharedRedis()
    return (await redis.get(maintenanceKey(clubId))) === '1'
  } catch {
    return false
  }
}

export async function rcloneConfigured(): Promise<boolean> {
  try {
    const { stdout } = await exec('rclone listremotes')
    return stdout.split('\n').map((s) => s.trim()).includes(`${REMOTE}:`)
  } catch {
    return false
  }
}

function tsName(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `titan_${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}_${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}.sql.gz`
}

export interface BackupResult { name: string; size: number; at: string; uploaded: boolean }
export interface BackupEntry { name: string; size: number; at: string; location: 'drive' | 'local' }

export async function createBackup(): Promise<BackupResult> {
  await mkdir(BACKUP_DIR, { recursive: true })
  const name = tsName()
  const file = path.join(BACKUP_DIR, name)
  // --clean --if-exists → дамп восстановим поверх существующей БД.
  await exec(`pg_dump --clean --if-exists --no-owner --no-privileges | gzip > "${file}"`, { env: pgEnv(), shell: '/bin/sh', maxBuffer: BIG })
  const st = await stat(file)
  if (st.size < 1024) { await unlink(file).catch(() => {}); throw new Error('Бэкап подозрительно мал — БД недоступна?') }

  let uploaded = false
  if (await rcloneConfigured()) {
    try {
      await exec(`rclone copy "${file}" "${REMOTE}:${REMOTE_DIR}/" --no-traverse`, { maxBuffer: BIG })
      uploaded = true
      await exec(`rclone delete "${REMOTE}:${REMOTE_DIR}/" --min-age ${KEEP_DAYS}d`).catch(() => {})
    } catch {
      uploaded = false
    }
  }
  await rotateLocal()
  return { name, size: st.size, at: st.mtime.toISOString(), uploaded }
}

async function rotateLocal(): Promise<void> {
  try {
    const files = (await readdir(BACKUP_DIR)).filter((f) => /^titan_.*\.sql\.gz$/.test(f))
    const cutoff = Date.now() - KEEP_DAYS * 86_400_000
    for (const f of files) {
      const s = await stat(path.join(BACKUP_DIR, f)).catch(() => null)
      if (s && s.mtimeMs < cutoff) await unlink(path.join(BACKUP_DIR, f)).catch(() => {})
    }
  } catch { /* ignore */ }
}

export async function listBackups(): Promise<{ entries: BackupEntry[]; driveConfigured: boolean }> {
  const driveConfigured = await rcloneConfigured()
  if (driveConfigured) {
    try {
      const { stdout } = await exec(`rclone lsjson "${REMOTE}:${REMOTE_DIR}/"`, { maxBuffer: BIG })
      const arr = JSON.parse(stdout) as { Name: string; Size: number; ModTime: string; IsDir: boolean }[]
      const entries = arr
        .filter((x) => !x.IsDir && /\.sql\.gz$/.test(x.Name))
        .map((x) => ({ name: x.Name, size: x.Size, at: x.ModTime, location: 'drive' as const }))
        .sort((a, b) => b.at.localeCompare(a.at))
      return { entries, driveConfigured }
    } catch { /* падаем на локальный список */ }
  }
  const files = (await readdir(BACKUP_DIR).catch(() => [] as string[])).filter((f) => /^titan_.*\.sql\.gz$/.test(f))
  const entries: BackupEntry[] = []
  for (const f of files) {
    const s = await stat(path.join(BACKUP_DIR, f)).catch(() => null)
    if (s) entries.push({ name: f, size: s.size, at: s.mtime.toISOString(), location: 'local' })
  }
  entries.sort((a, b) => b.at.localeCompare(a.at))
  return { entries, driveConfigured }
}

export async function lastBackup(): Promise<BackupEntry | null> {
  const { entries } = await listBackups()
  return entries[0] ?? null
}

// Восстановление поверх текущей БД (DROP+CREATE из --clean дампа).
// БЕЗОПАСНОСТЬ: ON_ERROR_STOP=1 + --single-transaction — restore применяется
// АТОМАРНО: любая ошибка посреди дампа прерывает psql и откатывает всю транзакцию,
// а не оставляет БД частично восстановленной (тихая порча, в т.ч. финансов).
export async function restoreFromPath(file: string): Promise<void> {
  const env = pgEnv()
  // Освобождаем блокировки: гасим прочие подключения к БД (пул API переподключится
  // сам). Это вспомогательная команда — ошибки тут некритичны (ON_ERROR_STOP=0, .catch).
  await exec(`psql -v ON_ERROR_STOP=0 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()"`, { env, maxBuffer: BIG }).catch(() => {})
  // Сам restore — строго в одной транзакции, любая ошибка → полный откат (всё-или-ничего).
  await exec(`gunzip -c "${file}" | psql -v ON_ERROR_STOP=1 --single-transaction`, { env, shell: '/bin/sh', maxBuffer: BIG })
}

const SAFE_NAME = /^[A-Za-z0-9._-]+\.sql\.gz$/

// Восстановление по имени из Drive (скачиваем) или из локального каталога.
export async function restoreNamed(name: string, source: 'drive' | 'local'): Promise<void> {
  if (!SAFE_NAME.test(name)) throw new Error('Недопустимое имя файла')
  const file = path.join(BACKUP_DIR, name)
  if (source === 'drive') {
    await exec(`rclone copy "${REMOTE}:${REMOTE_DIR}/${name}" "${BACKUP_DIR}/" --no-traverse`, { maxBuffer: BIG })
  }
  await stat(file) // должен существовать
  await restoreFromPath(file)
}

// ─── Проверка загруженного дампа на мета-команды psql ────────────────────────
// Файл с устройства уходит в `gunzip | psql` с общими кредами: мета-команды psql
// (\! — шелл, \c — чужая БД, \i/\o/\copy — файлы) выполнились бы на сервере.
// pg_dump их не пишет, кроме \restrict/\unrestrict (16.10+, только сужают psql) и
// терминатора COPY «\.». В данных COPY pg_dump экранирует лишь \\ \b \f \n \r \t \v
// и пишет \N для NULL — любой другой «\» там тоже отбиваем (даже если «COPY» в файле
// подделан строковым литералом, из этих букв опасной мета-команды не собрать).

export class UnsafeDumpError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeDumpError'
  }
}

const COPY_START = /^COPY .+ FROM stdin;$/
const PG_DUMP_RESTRICT_LINE = /^\\(un)?restrict [A-Za-z0-9]+$/
const COPY_DATA_BAD_ESCAPE = /\\(?![Nbfnrtv])/

async function assertNoPsqlMetaCommands(buf: Buffer): Promise<void> {
  const gunzip = Readable.from([buf]).pipe(createGunzip())
  const lines = createInterface({ input: gunzip, crlfDelay: Infinity })
  let inCopy = false
  let lineNo = 0
  try {
    for await (const line of lines) {
      lineNo++
      if (inCopy) {
        if (line === '\\.') { inCopy = false; continue }
        // Пары «\\» — экранированный обратный слеш; после них допустимы только \N \b \f \n \r \t \v.
        if (COPY_DATA_BAD_ESCAPE.test(line.replace(/\\\\/g, ''))) {
          throw new UnsafeDumpError(`Файл отклонён: недопустимая последовательность «\\» в строке ${lineNo}`)
        }
        continue
      }
      if (COPY_START.test(line)) { inCopy = true; continue }
      if (!line.includes('\\') || line === '\\.' || PG_DUMP_RESTRICT_LINE.test(line)) continue
      throw new UnsafeDumpError(`Файл отклонён: мета-команда psql в строке ${lineNo} — загрузите дамп, созданный кнопкой «Создать копию»`)
    }
  } catch (e) {
    if (e instanceof UnsafeDumpError) throw e
    throw new UnsafeDumpError('Файл не похож на копию .sql.gz')
  } finally {
    lines.close()
    gunzip.destroy()
  }
}

// Восстановление из загруженного с устройства файла (буфер .sql.gz).
export async function restoreFromUpload(buf: Buffer): Promise<void> {
  await assertNoPsqlMetaCommands(buf) // до записи и до psql — небезопасный файл не исполняем
  await mkdir(BACKUP_DIR, { recursive: true })
  const tmp = path.join(BACKUP_DIR, `upload_${Date.now()}.sql.gz`)
  await writeFile(tmp, buf)
  try {
    await restoreFromPath(tmp)
  } finally {
    await unlink(tmp).catch(() => {})
  }
}
