package ru.titan.wifi

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.wifi.WifiConfiguration
import android.net.wifi.WifiManager
import android.util.Log

private const val TAG = "Titan/WifiGuard"
private const val PREFS = "wifi_guard"
private const val KEY_NETWORK_ID = "network_id"
private const val EXTRA_SSID = "ssid"
private const val EXTRA_PASSPHRASE = "passphrase"
private const val MAX_SSID_BYTES = 32
private val PASSPHRASE_LENGTH = 8..63
private val PRINTABLE_ASCII = ' '..'~'

/** Why these credentials cannot be a WPA2 network, or null when they can. */
fun credentialsProblem(ssid: String, passphrase: String): String? = when {
    ssid.isEmpty() -> "Network name is empty"
    ssid.toByteArray(Charsets.UTF_8).size > MAX_SSID_BYTES -> "Network name is longer than $MAX_SSID_BYTES bytes"
    passphrase.length !in PASSPHRASE_LENGTH -> "Passphrase must be 8 to 63 characters"
    passphrase.any { it !in PRINTABLE_ASCII } -> "Passphrase must be plain ASCII"
    else -> null
}

private fun Context.wifi(): WifiManager? = applicationContext.getSystemService(WifiManager::class.java)

private fun Context.savedNetworkId(): Int? =
    getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(KEY_NETWORK_ID, -1).takeIf { it >= 0 }

/**
 * Sent by the launcher when the TV has no network: turns Wi-Fi on and reconnects. These calls only
 * work because this app targets API 28; for newer targets Android quietly ignores them.
 */
class ReconnectReceiver : BroadcastReceiver() {
    @Suppress("DEPRECATION")
    override fun onReceive(context: Context, intent: Intent) {
        val wifi = context.wifi() ?: return
        if (!wifi.isWifiEnabled && !wifi.setWifiEnabled(true)) Log.w(TAG, "Wi-Fi could not be turned on")
        // Our own copy of the home network stays eligible even if the system's entry is ever removed
        context.savedNetworkId()?.let { wifi.enableNetwork(it, false) }
        // Turning Wi-Fi on starts a scan by itself; asking for one here would need location access
        if (!wifi.reconnect()) Log.w(TAG, "Reconnect was refused")
        Log.i(TAG, "Reconnect requested")
    }
}

/** Stores the home network as this app's own WPA2 entry. Only adb can send it; see the manifest. */
class SetupReceiver : BroadcastReceiver() {
    @Suppress("DEPRECATION")
    override fun onReceive(context: Context, intent: Intent) {
        val ssid = intent.getStringExtra(EXTRA_SSID).orEmpty()
        val passphrase = intent.getStringExtra(EXTRA_PASSPHRASE).orEmpty()
        val problem = credentialsProblem(ssid, passphrase)
        val wifi = context.wifi()
        if (problem != null || wifi == null) {
            resultData = problem ?: "No Wi-Fi on this device"
            return
        }
        val config = WifiConfiguration().apply {
            SSID = "\"$ssid\""
            preSharedKey = "\"$passphrase\""
            allowedKeyManagement.set(WifiConfiguration.KeyMgmt.WPA_PSK)
        }
        // Adding the same network again updates our existing entry and returns its id
        val id = wifi.addNetwork(config)
        if (id < 0) {
            resultData = "Android refused to save the network"
            return
        }
        wifi.enableNetwork(id, false)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt(KEY_NETWORK_ID, id).apply()
        resultData = "Saved \"$ssid\" as network $id"
        Log.i(TAG, "Saved home network as id $id")
    }
}
