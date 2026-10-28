package ru.titan.tv.home

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.launch

private const val TAG = "Titan/Wifi"
private const val HELPER_PACKAGE = "ru.titan.wifi"
private const val HELPER_RECEIVER = "ru.titan.wifi.ReconnectReceiver"
private const val ACTION_RECONNECT = "ru.titan.wifi.RECONNECT"

// Waking from standby the TV usually finds its network by itself within a few seconds
private const val GRACE_MS = 15_000L
private const val FIRST_RETRY_MS = 10_000L
private const val MAX_RETRY_MS = 60_000L
private const val MAX_DOUBLINGS = 3

/** 10 s, 20 s, 40 s, then once a minute for as long as the network stays away. */
internal fun retryDelayMs(attempt: Int): Long =
    (FIRST_RETRY_MS shl attempt.coerceIn(0, MAX_DOUBLINGS)).coerceAtMost(MAX_RETRY_MS)

/**
 * Keeps the TV on the home Wi-Fi. After power-on, waking from standby or a dropped link it gives the
 * system a moment, then asks the Wi-Fi helper app to turn Wi-Fi on and reconnect until a network is back.
 */
class WifiWatch(private val context: Context, private val scope: CoroutineScope) {
    private val connectivity = context.getSystemService(ConnectivityManager::class.java)
    private val _notices = MutableSharedFlow<String>(extraBufferCapacity = 4)
    private var job: Job? = null

    /** Short messages for the home screen while the network is being brought back. */
    val notices: SharedFlow<String> = _notices

    fun start() {
        // Screen-on is a protected system broadcast, so the receiver needs no export flag
        context.registerReceiver(
            object : BroadcastReceiver() {
                override fun onReceive(context: Context, intent: Intent) = check("screen on")
            },
            IntentFilter(Intent.ACTION_SCREEN_ON),
        )
        connectivity.registerDefaultNetworkCallback(
            object : ConnectivityManager.NetworkCallback() {
                override fun onLost(network: Network) = check("network lost")
            },
            Handler(Looper.getMainLooper()),
        )
        check("start")
    }

    private fun check(reason: String) {
        job?.cancel()
        job = scope.launch {
            delay(GRACE_MS)
            var attempt = 0
            while (!isOnline()) {
                if (attempt == 0) _notices.tryEmit(if (canReconnect()) "Нет Wi-Fi — переподключаю" else "Нет Wi-Fi")
                Log.i(TAG, "Offline after $reason, reconnect attempt ${attempt + 1}")
                askHelper()
                delay(retryDelayMs(attempt++))
            }
            if (attempt > 0) {
                Log.i(TAG, "Back online after $attempt attempt(s)")
                _notices.tryEmit("Wi-Fi снова подключён")
            }
        }
    }

    private fun isOnline(): Boolean {
        val caps = connectivity.getNetworkCapabilities(connectivity.activeNetwork) ?: return false
        return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
    }

    private fun hasHelper(): Boolean = runCatching { context.packageManager.getPackageInfo(HELPER_PACKAGE, 0) }.isSuccess

    // Android 9 and older still let any app turn Wi-Fi on and reconnect; newer ones need the old-target helper
    private fun canReconnect(): Boolean = hasHelper() || Build.VERSION.SDK_INT <= Build.VERSION_CODES.P

    @Suppress("DEPRECATION")
    private fun reconnectDirectly() {
        if (Build.VERSION.SDK_INT > Build.VERSION_CODES.P) return
        val wifi = context.applicationContext.getSystemService(WifiManager::class.java) ?: return
        if (!wifi.isWifiEnabled && !wifi.setWifiEnabled(true)) Log.w(TAG, "Wi-Fi could not be turned on")
        if (!wifi.reconnect()) Log.w(TAG, "Reconnect was refused")
    }

    private fun askHelper() {
        if (!hasHelper()) {
            reconnectDirectly()
            return
        }
        val intent = Intent(ACTION_RECONNECT)
            .setClassName(HELPER_PACKAGE, HELPER_RECEIVER)
            // A helper that was never opened is "stopped" and would not get the broadcast otherwise
            .addFlags(Intent.FLAG_INCLUDE_STOPPED_PACKAGES)
        context.sendBroadcast(intent)
    }
}
