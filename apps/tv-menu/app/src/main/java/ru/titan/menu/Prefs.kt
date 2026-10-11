package ru.titan.menu

import android.content.Context
import android.net.Uri
import java.security.SecureRandom
import java.util.UUID

/**
 * Что приставка помнит о себе. Всё содержимое экрана настраивается в Titan HUB
 * («Управление → Экраны»); здесь — только привязка и последний известный поворот.
 *
 *  • deviceId — постоянный номер приставки, pairCode — код на экране до привязки
 *    (тот же код телефон видит в списке найденных ТВ).
 *  • host/screenId/token — привязка к экрану клуба: адрес клуба, экран и токен
 *    приставки (сервер хранит только его хэш).
 *  • address — старый режим Titan Menu 1.0 (просто страница /menu): продолжает
 *    работать, пока экран не привяжут с телефона.
 */
class Prefs(context: Context) {
    private val store = context.getSharedPreferences("titan_menu", Context.MODE_PRIVATE)

    val deviceId: String
        get() = store.getString(KEY_DEVICE_ID, null) ?: UUID.randomUUID().toString().also { store.edit().putString(KEY_DEVICE_ID, it).apply() }

    val pairCode: String
        get() = store.getString(KEY_PAIR_CODE, null) ?: newPairCode()

    var rotation: Int
        get() = store.getInt(KEY_ROTATION, 0).takeIf { it in ROTATIONS } ?: 0
        set(value) = store.edit().putInt(KEY_ROTATION, if (value in ROTATIONS) value else 0).apply()

    val host: String? get() = store.getString(KEY_HOST, null)
    val screenId: String? get() = store.getString(KEY_SCREEN_ID, null)
    val token: String? get() = store.getString(KEY_TOKEN, null)
    val screenName: String? get() = store.getString(KEY_SCREEN_NAME, null)
    val isPaired: Boolean get() = !host.isNullOrBlank() && !screenId.isNullOrBlank() && !token.isNullOrBlank()

    /** Старый режим 1.0: адрес меню без привязки к экрану. */
    val legacyUrl: String? get() = menuUrl(store.getString(KEY_ADDRESS, null).orEmpty())

    val screenUrl: String? get() = if (isPaired) "$host/screen/$screenId" else null

    fun savePairing(host: String, screenId: String, token: String, name: String, rotation: Int) {
        store.edit()
            .putString(KEY_HOST, host.trimEnd('/'))
            .putString(KEY_SCREEN_ID, screenId)
            .putString(KEY_TOKEN, token)
            .putString(KEY_SCREEN_NAME, name)
            .putInt(KEY_ROTATION, if (rotation in ROTATIONS) rotation else 0)
            .remove(KEY_ADDRESS)
            .remove(KEY_PAIR_CODE)
            .apply()
    }

    fun saveScreen(name: String, rotation: Int) {
        store.edit().putString(KEY_SCREEN_NAME, name).putInt(KEY_ROTATION, if (rotation in ROTATIONS) rotation else 0).apply()
    }

    /** Отвязка (из HUB или с пульта): забываем экран, на экране — новый код. */
    fun clearPairing() {
        store.edit().remove(KEY_HOST).remove(KEY_SCREEN_ID).remove(KEY_TOKEN).remove(KEY_SCREEN_NAME).remove(KEY_PAIR_CODE).apply()
    }

    fun clearLegacy() = store.edit().remove(KEY_ADDRESS).apply()

    /** Ручной режим с пульта (без привязки к HUB): адрес меню клуба и поворот. */
    fun saveManual(address: String, rotation: Int) {
        store.edit().putString(KEY_ADDRESS, address.trim()).putInt(KEY_ROTATION, if (rotation in ROTATIONS) rotation else 0).apply()
    }

    val manualAddress: String? get() = store.getString(KEY_ADDRESS, null)

    private fun newPairCode(): String {
        val code = (1000 + SecureRandom().nextInt(9000)).toString()
        store.edit().putString(KEY_PAIR_CODE, code).apply()
        return code
    }

    companion object {
        val ROTATIONS = setOf(0, 90, 270)

        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_PAIR_CODE = "pair_code"
        private const val KEY_ROTATION = "rotation"
        private const val KEY_HOST = "host"
        private const val KEY_SCREEN_ID = "screen_id"
        private const val KEY_TOKEN = "token"
        private const val KEY_SCREEN_NAME = "screen_name"
        private const val KEY_ADDRESS = "address"
        private val SCHEME = Regex("^https?://", RegexOption.IGNORE_CASE)

        /** «kbr.titanpos.ru» → https://kbr.titanpos.ru/menu (адрес из Titan Menu 1.0). */
        fun menuUrl(address: String): String? {
            val raw = address.trim()
            if (raw.isEmpty() || raw.any { it.isWhitespace() }) return null
            val uri = Uri.parse(if (SCHEME.containsMatchIn(raw)) raw else "https://$raw")
            val host = uri.host
            if (host.isNullOrBlank() || (!host.contains('.') && host != "localhost")) return null
            val path = uri.path
            return if (path.isNullOrEmpty() || path == "/") uri.buildUpon().path("/menu").build().toString() else uri.toString()
        }
    }
}
