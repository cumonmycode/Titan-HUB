package ru.titan.menu

import android.content.Context
import android.provider.Settings

/**
 * Часы приставки. У дешёвых приставок нет батарейки часов: после отключения питания дата
 * встаёт на дату прошивки (у клубной — 12.02.2025). С такой датой сертификат сервера
 * «ещё не действует», связи с Titan HUB нет, а экран крутит меню из кэша. Лечится
 * «Использовать время сети» — тогда Android сам берёт время из интернета после загрузки.
 */
object DeviceClock {
    /** 01.10.2026 — эта версия вышла позже, значит, более ранняя дата точно неверна. */
    private const val EARLIEST_REAL_TIME = 1_790_812_800_000L

    fun isWrong(): Boolean = System.currentTimeMillis() < EARLIEST_REAL_TIME

    /** Включено ли «Использовать время сети»: без него дата собьётся при следующем отключении питания. */
    fun isNetworkTime(context: Context): Boolean =
        Settings.Global.getInt(context.contentResolver, Settings.Global.AUTO_TIME, 0) == 1
}
