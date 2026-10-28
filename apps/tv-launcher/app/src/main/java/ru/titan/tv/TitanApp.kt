package ru.titan.tv

import android.app.Application
import android.content.Context
import android.util.Log
import ru.titan.tv.airplay.AirPlayLink
import ru.titan.tv.apps.AppRepository
import ru.titan.tv.config.ConfigRepository
import ru.titan.tv.config.EMPTY_CONFIG
import ru.titan.tv.home.SmartHome
import ru.titan.tv.home.TvControls
import ru.titan.tv.home.WifiWatch
import ru.titan.tv.hub.AdImages
import ru.titan.tv.hub.DeviceStateReader
import ru.titan.tv.hub.HubLink
import ru.titan.tv.hub.MessageOverlay
import ru.titan.tv.hub.Presence
import ru.titan.tv.hub.RemoteControl
import ru.titan.tv.inputs.TvInputs
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient

private const val DEFAULT_AIRPLAY_NAME = "TITAN"

class TitanApp : Application() {
    val graph: AppGraph by lazy { AppGraph(this) }
}

/** App-wide singletons shared by the launcher and the room overlay. */
class AppGraph(app: Application) {
    // A launcher must never crash-loop: a failed background job is logged, not fatal
    private val scope = CoroutineScope(
        SupervisorJob() + Dispatchers.Main.immediate +
            CoroutineExceptionHandler { _, error -> Log.e("Titan", "Background job failed", error) },
    )
    val apps = AppRepository(app)
    val inputs = TvInputs(app).also { inputs ->
        runCatching { inputs.start() }.onFailure { Log.e("Titan", "TV inputs are not available", it) }
    }
    val tv = TvControls(app)
    val smartHome = SmartHome(ConfigRepository(app), scope)
    val airplay = AirPlayLink(app, scope).also { link ->
        // The speaker is named after the room; the add-on announces it only while this TV is linked
        scope.launch {
            smartHome.config
                .map { it.config }
                .filter { it !== EMPTY_CONFIG }
                .map { it.room?.name ?: DEFAULT_AIRPLAY_NAME }
                .distinctUntilChanged()
                .collect(link::start)
        }
    }
    val wifi = WifiWatch(app, scope).also { watch ->
        // A Wi-Fi watchdog that cannot register must not take the launcher down with it
        runCatching { watch.start() }.onFailure { Log.e("Titan", "Wi-Fi watch did not start", it) }
    }

    /** What the launcher has on screen, set by the home screen; Titan HUB shows it in «Экраны». */
    val presence = MutableStateFlow(Presence.AWAY)
    private val http = OkHttpClient()
    val adImages = AdImages(http, app.cacheDir)
    private val deviceState = DeviceStateReader(app, presence, airplay.state, smartHome.room, inputs)
    val hub = HubLink(app, scope, http, deviceState::read).also { link ->
        runCatching { link.start() }.onFailure { Log.e("Titan", "Titan HUB link did not start", it) }
        val remote = RemoteControl(app, scope, MessageOverlay(app))
        scope.launch { link.commands.collect(remote::run) }
    }
}

val Context.graph: AppGraph
    get() = (applicationContext as TitanApp).graph
