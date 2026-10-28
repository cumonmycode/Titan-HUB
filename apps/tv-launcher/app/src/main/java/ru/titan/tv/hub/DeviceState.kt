package ru.titan.tv.hub

import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioManager
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONObject
import ru.titan.tv.airplay.AirPlayState
import ru.titan.tv.ha.HaStatus
import ru.titan.tv.inputs.TvInputs
import ru.titan.tv.room.RoomUi

/** What the launcher itself has on screen; AWAY when another app or an HDMI input is in front. */
enum class Presence { HOME, SAVER, CINEMA, AWAY }

/**
 * What Titan HUB shows about this TV: what is on screen, what plays over AirPlay, the volume and
 * whether the room controls reach Home Assistant. Safe to call from any thread.
 */
class DeviceStateReader(
    context: Context,
    private val presence: StateFlow<Presence>,
    private val airplay: StateFlow<AirPlayState>,
    private val room: StateFlow<RoomUi>,
    private val inputs: TvInputs,
) {
    private val appContext = context.applicationContext
    private val audio = context.getSystemService(AudioManager::class.java)
    private val usage = context.getSystemService(UsageStatsManager::class.java)
    private val pm: PackageManager = context.packageManager

    fun read(): JSONObject {
        val json = JSONObject()
        when (presence.value) {
            Presence.HOME -> json.put("screen", "home")
            Presence.SAVER -> json.put("screen", "saver")
            Presence.CINEMA -> json.put("screen", "cinema")
            Presence.AWAY -> {
                val front = frontPackage()
                if (front == TV_PLAYER) {
                    json.put("screen", "input").put("app", inputs.lastOpened?.label ?: JSONObject.NULL)
                } else {
                    json.put("screen", "app").put("app", front?.let(::label) ?: JSONObject.NULL)
                }
            }
        }
        val playing = airplay.value.nowPlaying
        json.put(
            "airplay",
            playing?.let {
                JSONObject().put("title", it.title).put("artist", it.artist).put("client", it.client).put("playing", it.isPlaying)
            } ?: JSONObject.NULL,
        )
        json.put(
            "volume",
            JSONObject()
                .put("level", audio.getStreamVolume(AudioManager.STREAM_MUSIC))
                .put("max", audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1))
                .put("muted", audio.isStreamMute(AudioManager.STREAM_MUSIC)),
        )
        json.put("ha", haName(room.value.status))
        return json
    }

    /**
     * The app the guest has in front, from usage stats. Needs «usage access», granted over adb
     * (`appops set ru.titan.tv GET_USAGE_STATS allow`); without it HUB just says «другое приложение».
     */
    private fun frontPackage(): String? {
        val now = System.currentTimeMillis()
        val events = runCatching { usage.queryEvents(now - LOOKBACK_MS, now) }.getOrNull() ?: return null
        val event = UsageEvents.Event()
        var front: String? = null
        while (events.hasNextEvent()) {
            events.getNextEvent(event)
            @Suppress("DEPRECATION")
            if (event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND) front = event.packageName
        }
        return front?.takeIf { it != appContext.packageName }
    }

    private fun label(packageName: String): String? = runCatching {
        pm.getApplicationLabel(pm.getApplicationInfo(packageName, 0)).toString()
    }.getOrNull()

    private fun haName(status: HaStatus): String = when (status) {
        HaStatus.NotConfigured -> "idle"
        HaStatus.Connecting -> "connecting"
        HaStatus.Connected -> "connected"
        is HaStatus.Offline -> "offline"
        is HaStatus.AuthFailed -> "auth_failed"
    }

    private companion object {
        // Plays the HDMI inputs; in front means a guest is on a console or a laptop
        const val TV_PLAYER = "com.mediatek.wwtv.tvcenter"
        const val LOOKBACK_MS = 6 * 60 * 60 * 1000L
    }
}
