package ru.titan.menu

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.SystemClock
import android.provider.Settings
import android.util.Log

/**
 * Часы приставки. У дешёвых приставок нет батарейки часов: после отключения питания дата
 * встаёт на дату прошивки (у клубной — 12.02.2025). Android берёт время из сети трижды с
 * интервалом в минуту после загрузки, а не вышло (роутер ещё грузился) — ждёт сутки.
 *
 * Экрану это больше не мешает: точное время приложение узнаёт само (TrueTime) и по нему
 * проверяет сертификаты. А системные часы подталкиваем: переключение «Использовать время
 * сети» выкл → вкл заставляет Android сразу заново спросить время. Для этого нужно
 * разрешение WRITE_SECURE_SETTINGS — его один раз выдают по adb:
 *   adb shell pm grant ru.titan.menu android.permission.WRITE_SECURE_SETTINGS
 */
object DeviceClock {
    private const val TAG = "TitanMenu"
    private const val NUDGE_EVERY_MS = 2 * 60_000L
    private var lastNudge = 0L

    /** Дата сбита, а точного времени узнать не удалось — связи с сервером не будет. */
    fun isWrong(): Boolean = TrueTime.isDeviceClockOff() && !TrueTime.isKnown

    /** Дата сбита (даже если экран работает по точному времени). */
    fun isOff(): Boolean = TrueTime.isDeviceClockOff()

    /** Включено ли «Использовать время сети»: без него дата собьётся при следующем отключении питания. */
    fun isNetworkTime(context: Context): Boolean =
        Settings.Global.getInt(context.contentResolver, Settings.Global.AUTO_TIME, 0) == 1

    fun canFixSystemClock(context: Context): Boolean =
        context.checkSelfPermission(Manifest.permission.WRITE_SECURE_SETTINGS) == PackageManager.PERMISSION_GRANTED

    /**
     * Часы сбиты — просим систему заново взять время из сети (не чаще раза в 2 минуты).
     * Заодно включаем «Использовать время сети», если его выключили.
     */
    fun nudgeSystem(context: Context) {
        if (!isOff() || !canFixSystemClock(context)) return
        val now = SystemClock.elapsedRealtime()
        if (lastNudge != 0L && now - lastNudge < NUDGE_EVERY_MS) return
        lastNudge = now
        val resolver = context.contentResolver
        runCatching {
            Settings.Global.putInt(resolver, Settings.Global.AUTO_TIME, 0)
            Settings.Global.putInt(resolver, Settings.Global.AUTO_TIME, 1)
            Log.i(TAG, "Часы приставки сбиты — попросили систему взять время из сети")
        }.onFailure { Log.w(TAG, "Не удалось переключить время сети", it) }
    }
}
