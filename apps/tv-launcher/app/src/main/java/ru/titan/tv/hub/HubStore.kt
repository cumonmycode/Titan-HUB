package ru.titan.tv.hub

import android.content.Context
import ru.titan.tv.config.SecureFile
import java.io.File
import java.util.UUID
import kotlin.random.Random

/**
 * What this TV keeps about Titan HUB: its id and pairing code on the local network, the pairing itself
 * (the token is encrypted with the Keystore key that guards config.json) and the last ads, so the home
 * screen has them right after a restart without the internet.
 */
class HubStore(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val vault = SecureFile(File(context.filesDir, PAIRING_FILE))
    private val adsFile = File(context.filesDir, ADS_FILE)

    val deviceId: String = remembered(KEY_DEVICE_ID) { UUID.randomUUID().toString() }

    /** Four digits the phone shows next to this TV, to pick the right one when there are several. */
    val pairCode: String = remembered(KEY_CODE) { Random.nextInt(CODE_FROM, CODE_UNTIL).toString() }

    fun load(): HubPairing? = vault.read().getOrNull()?.let(::parsePairing)

    fun save(pairing: HubPairing) = vault.write(pairingJson(pairing))

    fun clear() {
        vault.delete()
        adsFile.delete()
    }

    fun cachedAds(): String? = runCatching { adsFile.takeIf { it.exists() }?.readText() }.getOrNull()

    fun cacheAds(raw: String) {
        runCatching { adsFile.writeText(raw) }
    }

    private fun remembered(key: String, create: () -> String): String =
        prefs.getString(key, null) ?: create().also { prefs.edit().putString(key, it).apply() }

    private companion object {
        const val PREFS = "hub"
        const val PAIRING_FILE = "hub.bin"
        const val ADS_FILE = "hub-ads.json"
        const val KEY_DEVICE_ID = "deviceId"
        const val KEY_CODE = "pairCode"
        const val CODE_FROM = 1000
        const val CODE_UNTIL = 10000
    }
}
