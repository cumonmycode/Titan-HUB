// Обновление Android-версии My Titan без магазина: сервер (titanpos.ru/apps/my-titan/latest.json,
// выкладывает scripts/publish-android.sh) знает последнюю версию. Если она новее
// установленной, приложение не пускает дальше экрана «Обновите приложение»: скачивает
// APK и открывает системную установку. Сервер недоступен — работаем как есть (без сети
// приложение не должно запираться).
import Constants from 'expo-constants';
import { DownloadTask, File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';

const UPDATE_BASE = 'https://titanpos.ru/apps/my-titan/';
const CHECK_TIMEOUT_MS = 10_000;
const FLAG_GRANT_READ_URI_PERMISSION = 1;
const APK_MIME = 'application/vnd.android.package-archive';

export interface UpdateInfo {
  versionCode: number;
  versionName: string;
  /** Путь к APK относительно папки приложения или полный https-адрес. */
  apk: string;
  notes?: string;
  /** Ниже этой версии пользоваться нельзя; не задана — нельзя ничем старше последней. */
  minVersionCode?: number;
}

/** versionCode этой сборки — из app.json, вшитого в приложение при сборке. */
export const installedVersionCode: number = Constants.expoConfig?.android?.versionCode ?? 0;

function parse(raw: unknown): UpdateInfo | null {
  const r = raw as Partial<UpdateInfo> | null;
  if (!r || typeof r.versionCode !== 'number' || typeof r.apk !== 'string' || !r.apk) return null;
  return {
    versionCode: r.versionCode,
    versionName: typeof r.versionName === 'string' ? r.versionName : String(r.versionCode),
    apk: r.apk,
    notes: typeof r.notes === 'string' ? r.notes : undefined,
    minVersionCode: typeof r.minVersionCode === 'number' ? r.minVersionCode : undefined,
  };
}

/** Обязательное обновление или null (версия свежая, сервер не ответил, файл битый). */
export async function requiredUpdate(): Promise<UpdateInfo | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(`${UPDATE_BASE}latest.json?t=${Date.now()}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const info = parse(await res.json());
    if (!info) return null;
    return installedVersionCode < (info.minVersionCode ?? info.versionCode) ? info : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function apkUrl(info: UpdateInfo): string {
  const url = new URL(info.apk, UPDATE_BASE);
  if (url.protocol !== 'https:') throw new Error('Ссылка на обновление должна быть https');
  return url.toString();
}

/**
 * Скачать APK (с прогрессом 0…1, если сервер сообщил размер) и открыть установку.
 * Android сам спросит разрешение «Установка неизвестных приложений», если его ещё нет.
 */
export async function downloadAndInstall(info: UpdateInfo, onProgress: (share: number | null) => void): Promise<void> {
  const target = new File(Paths.cache, `my-titan-${info.versionCode}.apk`);
  if (target.exists) target.delete();
  const task = new DownloadTask(apkUrl(info), target, {
    onProgress: (p) => onProgress(p.totalBytes > 0 ? p.bytesWritten / p.totalBytes : null),
  });
  const file = await task.downloadAsync();
  if (!file) throw new Error('Загрузка прервана');
  const contentUri = await getContentUriAsync(file.uri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    type: APK_MIME,
    flags: FLAG_GRANT_READ_URI_PERMISSION,
  });
}
