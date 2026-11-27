package ru.titan.menu

import android.app.Application
import android.util.Log

/** До любого запроса: точное время и проверка сертификатов, не зависящая от часов приставки. */
class TitanApp : Application() {
    override fun onCreate() {
        super.onCreate()
        TrueTime.init(this)
        runCatching { ClockTolerantTrust.install() }.onFailure { Log.w("TitanMenu", "Не удалось поставить проверку сертификатов", it) }
    }
}
