/**
 * Последняя Android-версия My Titan. APK лежит на сервере клуба рядом с
 * latest.json (его выкладывает scripts/publish-android.sh), имя файла меняется
 * с каждой версией — поэтому сайт читает манифест и отдаёт ссылку на текущий файл.
 */
const APK_BASE = process.env['MY_TITAN_APK_BASE'] ?? 'https://titanpos.ru/apps/my-titan'
const TIMEOUT_MS = 4000
const REVALIDATE_SECONDS = 300
/** Последняя известная версия — если манифест не ответил. */
const FALLBACK_FILE = 'my-titan-1.6.0-4.apk'

export interface AndroidApk {
  url: string
  version: string | null
}

export async function getAndroidApk(): Promise<AndroidApk> {
  try {
    const res = await fetch(`${APK_BASE}/latest.json`, { next: { revalidate: REVALIDATE_SECONDS }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) throw new Error(`latest.json: ${res.status}`)
    const data: unknown = await res.json()
    const apk = (data as { apk?: unknown }).apk
    const version = (data as { versionName?: unknown }).versionName
    if (typeof apk !== 'string' || !/^[\w.-]+\.apk$/.test(apk)) throw new Error('latest.json: нет имени APK')
    return { url: `${APK_BASE}/${apk}`, version: typeof version === 'string' ? version : null }
  } catch (e) {
    console.error('[site] Android-версия My Titan недоступна:', e instanceof Error ? e.message : e)
    return { url: `${APK_BASE}/${FALLBACK_FILE}`, version: null }
  }
}
