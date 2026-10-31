package ru.titan.menu

import android.content.Context
import android.net.ConnectivityManager
import android.net.wifi.WifiManager
import android.os.SystemClock
import android.util.Log

/**
 * Держит приставку в сети. К сохранённой Wi‑Fi сети Android подключается сам, но только пока
 * Wi‑Fi включён: в клубе он оказался выключенным, и экран неделю показывал меню из кэша.
 *  • сети нет и Wi‑Fi выключен — включаем;
 *  • Wi‑Fi включён, а сети нет дольше [STUCK_MS] — перезапускаем его (драйвер приставки
 *    бывает залипает), не чаще раза в [RESTART_EVERY_MS].
 * Есть любая сеть, в том числе кабель, — ничего не трогаем.
 *
 * Включать Wi‑Fi обычному приложению Android разрешает только при targetSdk 28 и ниже
 * (см. app/build.gradle.kts). Звать [check] периодически и не из UI-потока.
 */
class NetworkKeeper(context: Context) {
    private val wifi = context.applicationContext.getSystemService(WifiManager::class.java)
    private val connectivity = context.applicationContext.getSystemService(ConnectivityManager::class.java)
    /** С какого момента нет сети (по часам с загрузки — дата приставки может скакать); 0 — сеть есть. */
    private var offlineSince = 0L
    private var lastRestart = 0L

    @Suppress("DEPRECATION")
    fun check() {
        val wifi = wifi ?: return
        if (connectivity?.activeNetwork != null) {
            offlineSince = 0L
            return
        }
        val now = SystemClock.elapsedRealtime()
        if (offlineSince == 0L) offlineSince = now
        if (!wifi.isWifiEnabled) {
            Log.i(TAG, "Нет сети, Wi‑Fi выключен — включаем")
            if (!wifi.setWifiEnabled(true)) Log.w(TAG, "Система не дала включить Wi‑Fi")
            return
        }
        if (now - offlineSince < STUCK_MS || now - lastRestart < RESTART_EVERY_MS) return
        Log.i(TAG, "Wi‑Fi включён, но сети нет ${(now - offlineSince) / 60_000} мин — перезапускаем Wi‑Fi")
        lastRestart = now
        // Включит обратно следующая проверка: «Wi‑Fi выключен — включаем».
        wifi.setWifiEnabled(false)
    }

    private companion object {
        const val TAG = "TitanMenu"
        const val STUCK_MS = 3 * 60_000L
        const val RESTART_EVERY_MS = 10 * 60_000L
    }
}
