package ru.titan.tv.hub

import android.content.Context
import android.os.Build
import android.os.SystemClock
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.Call
import okhttp3.OkHttpClient
import org.json.JSONObject
import java.io.IOException

/** Where this TV stands with Titan HUB, for the footer of «Все приложения». */
sealed interface HubStatus {
    /** Not paired: a phone with Titan HUB on this network pairs it, the TV shows [code] to tell it apart. */
    data class Waiting(val code: String) : HubStatus

    data class Paired(val screenName: String, val online: Boolean) : HubStatus
}

/**
 * Keeps this TV a screen of Titan HUB. Until paired it waits for a phone on the local network; once
 * paired it reports in every 20 s with what is on screen, keeps the ads for the home screen and the
 * screensaver, and listens to the remote control in «Экраны» over a stream that stays open.
 */
class HubLink(
    private val context: Context,
    private val scope: CoroutineScope,
    http: OkHttpClient,
    /** What the TV is showing now, sent with every heartbeat. */
    private val readState: () -> JSONObject,
) : LocalServer.Listener {
    private val store = HubStore(context)
    private val client = HubClient(http)
    private val server = LocalServer(this)
    private val appVersion = runCatching {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName
    }.getOrNull() ?: "?"

    private val _status = MutableStateFlow<HubStatus>(HubStatus.Waiting(store.pairCode))
    val status: StateFlow<HubStatus> = _status.asStateFlow()

    private val cached = store.cachedAds()?.let(::parseAds)
    private val _ads = MutableStateFlow(cached?.ads.orEmpty())
    val ads: StateFlow<List<Ad>> = _ads.asStateFlow()

    private val _commands = MutableSharedFlow<HubCommand>(extraBufferCapacity = COMMAND_BUFFER)
    val commands: SharedFlow<HubCommand> = _commands.asSharedFlow()

    @Volatile
    private var pairing: HubPairing? = null

    @Volatile
    private var adsVersion: String? = cached?.version

    private var session: Job? = null

    @Volatile
    private var stream: Call? = null

    // After a command the next heartbeat goes early, so HUB shows the new state within seconds
    private val beatSoon = Channel<Unit>(Channel.CONFLATED)

    fun start() {
        server.start()
        scope.launch(Dispatchers.IO) {
            val saved = store.load() ?: return@launch
            launch(Dispatchers.Main) { begin(saved) }
        }
    }

    // ── LocalServer.Listener: a phone pairs this TV ─────────────────────────

    override fun info(): JSONObject = JSONObject()
        .put("deviceId", store.deviceId)
        .put("code", store.pairCode)
        .put("name", "Titan TV ${store.pairCode}")
        .put("model", model())
        .put("appVersion", appVersion)
        .put("paired", pairing != null)
        .put("screenName", pairing?.screenName ?: JSONObject.NULL)

    override fun pair(host: String, secret: String, code: String): Pair<Int, JSONObject> {
        if (code != store.pairCode) return HTTP_FORBIDDEN to LocalServer.error("Код не совпадает с кодом этого ТВ")
        return try {
            val paired = client.claim(host, secret, store.deviceId, model(), appVersion)
            store.save(paired)
            scope.launch(Dispatchers.Main) { begin(paired) }
            HTTP_OK to JSONObject().put("ok", true).put("screenId", paired.screenId).put("name", paired.screenName)
        } catch (e: HubClient.ClaimFailed) {
            HTTP_BAD_GATEWAY to LocalServer.error(e.message ?: "Не получилось подключиться")
        }
    }

    // ── Paired ──────────────────────────────────────────────────────────────

    private fun begin(paired: HubPairing) {
        pairing = paired
        _status.value = HubStatus.Paired(paired.screenName, online = false)
        stopSession()
        session = scope.launch(Dispatchers.IO) {
            launch { heartbeats(paired) }
            launch { remote(paired) }
        }
    }

    private suspend fun heartbeats(paired: HubPairing) {
        var current = paired
        while (currentCoroutineContext().isActive) {
            when (val beat = client.heartbeat(current, appVersion, readState())) {
                is HubClient.Beat.Ok -> {
                    if (beat.screenName != current.screenName) {
                        current = current.copy(screenName = beat.screenName)
                        pairing = current
                        store.save(current)
                    }
                    _status.value = HubStatus.Paired(current.screenName, online = true)
                    if (beat.adsVersion != adsVersion) refreshAds(current)
                }
                HubClient.Beat.Unpaired -> return unpaired()
                HubClient.Beat.Offline -> _status.value = HubStatus.Paired(current.screenName, online = false)
            }
            withTimeoutOrNull(HEARTBEAT_MS) { beatSoon.receive() }
        }
    }

    // The stream drops with Wi-Fi or a server restart; it comes back with growing pauses
    private suspend fun remote(paired: HubPairing) {
        var pause = MIN_RETRY_MS
        while (currentCoroutineContext().isActive) {
            val openedAt = SystemClock.elapsedRealtime()
            try {
                // Ads may have changed while the stream was down
                refreshAds(paired)
                if (pairing == null) return
                client.listen(paired, { stream = it }, ::onSignal)
            } catch (e: HubClient.UnpairedException) {
                return unpaired()
            } catch (e: IOException) {
                Log.i(TAG, "Remote stream closed: ${e.message}")
            }
            if (SystemClock.elapsedRealtime() - openedAt > STEADY_MS) pause = MIN_RETRY_MS
            delay(pause)
            pause = (pause * 2).coerceAtMost(MAX_RETRY_MS)
        }
    }

    private fun onSignal(signal: HubSignal) {
        when (signal) {
            is HubSignal.Command -> {
                _commands.tryEmit(signal.command)
                scope.launch {
                    delay(SETTLE_MS)
                    beatSoon.trySend(Unit)
                }
            }
            HubSignal.ContentChanged -> pairing?.let { paired -> scope.launch(Dispatchers.IO) { refreshAds(paired) } }
        }
    }

    private fun refreshAds(paired: HubPairing) {
        val raw = try {
            client.content(paired)
        } catch (e: HubClient.UnpairedException) {
            return unpaired()
        } catch (e: IOException) {
            null
        } ?: return
        val content = parseAds(raw) ?: return
        _ads.value = content.ads
        adsVersion = content.version
        store.cacheAds(raw)
    }

    private fun unpaired() {
        Log.i(TAG, "Unpaired in HUB, waiting for a phone again")
        store.clear()
        pairing = null
        adsVersion = null
        _ads.value = emptyList()
        _status.value = HubStatus.Waiting(store.pairCode)
        stopSession()
    }

    // A blocking stream read does not notice coroutine cancellation; hanging up the call ends it
    private fun stopSession() {
        session?.cancel()
        stream?.cancel()
        stream = null
    }

    private fun model(): String = "${Build.MANUFACTURER} ${Build.MODEL}".trim()

    private companion object {
        const val TAG = "TitanHub"
        const val HEARTBEAT_MS = 20_000L
        // Long enough for the home screen or the volume to change after a command
        const val SETTLE_MS = 1_500L
        const val MIN_RETRY_MS = 2_000L
        const val MAX_RETRY_MS = 30_000L
        const val STEADY_MS = 30_000L
        const val COMMAND_BUFFER = 8
        const val HTTP_OK = 200
        const val HTTP_FORBIDDEN = 403
        const val HTTP_BAD_GATEWAY = 502
    }
}
