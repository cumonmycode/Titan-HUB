package ru.titan.tv.airplay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.core.content.ContextCompat
import kotlin.math.abs
import kotlin.math.roundToInt

// Not in the public SDK, but every Android TV build sends it when a stream's volume changes
private const val VOLUME_CHANGED = "android.media.VOLUME_CHANGED_ACTION"
private const val EXTRA_STREAM_TYPE = "android.media.EXTRA_VOLUME_STREAM_TYPE"
private const val EXTRA_STREAM_VALUE = "android.media.EXTRA_VOLUME_STREAM_VALUE"
// An iPhone's volume buttons move AirPlay volume in 16 steps; each one becomes one step of the TV
internal const val SENDER_VOLUME_STEPS = 16
// A big slider jump on the phone must not hammer a TV over HDMI-CEC
internal const val MAX_STEPS_PER_CHANGE = 8
// The TV reports volume changes late; for this long after the phone set the volume, a report is the phone's own
// change coming back, and after the TV told the phone its volume, the phone's answer is that value coming back
internal const val ECHO_QUIET_MS = 1_500L
// The remote's last press counts, not every step on the way
private const val REMOTE_SETTLE_MS = 300L

/** The TV volume index for an AirPlay [level] from 0 to 1. */
internal fun volumeIndex(level: Double, maxIndex: Int): Int = (level.coerceIn(0.0, 1.0) * maxIndex).roundToInt()

/** Whole sender volume steps between [from] and [to]; positive is louder. */
internal fun volumeSteps(from: Double, to: Double): Int =
    ((to - from) * SENDER_VOLUME_STEPS).roundToInt().coerceIn(-MAX_STEPS_PER_CHANGE, MAX_STEPS_PER_CHANGE)

/** Whether something that happened at [nowMs] is just the echo of a change made at [changedAtMs]. */
internal fun isEcho(nowMs: Long, changedAtMs: Long): Boolean = changedAtMs > 0 && nowMs - changedAtMs < ECHO_QUIET_MS

/**
 * Makes AirPlay volume and the TV's own volume one and the same. A TV with its own speakers takes the sender's
 * level as its volume and reports remote-control changes back to the sender. A streaming stick with fixed HDMI
 * volume cannot know the TV's level, so it passes the sender's volume steps on over HDMI-CEC.
 */
class TvVolume(private val context: Context, private val onTvChange: (Double) -> Unit) {
    private val audio = context.getSystemService(AudioManager::class.java)
    private val fixed = audio.isVolumeFixed
    private val maxIndex = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
    private val main = Handler(Looper.getMainLooper())

    /** The sender level the TV last caught up with, for stepping a fixed-volume device. */
    private var senderLevel: Double? = null

    @Volatile
    private var senderSetAtMs = 0L

    @Volatile
    private var toldSenderAtMs = 0L

    private var settledLevel = 0.0
    private val tellSender = Runnable {
        toldSenderAtMs = SystemClock.elapsedRealtime()
        onTvChange(settledLevel)
    }

    private val changes = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.getIntExtra(EXTRA_STREAM_TYPE, -1) != AudioManager.STREAM_MUSIC) return
            val index = intent.getIntExtra(EXTRA_STREAM_VALUE, -1)
            if (index < 0 || isEcho(SystemClock.elapsedRealtime(), senderSetAtMs)) return
            settledLevel = index.toDouble() / maxIndex
            main.removeCallbacks(tellSender)
            main.postDelayed(tellSender, REMOTE_SETTLE_MS)
        }
    }

    fun start() {
        if (fixed) return
        ContextCompat.registerReceiver(context, changes, IntentFilter(VOLUME_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED)
    }

    /**
     * A sender just arrived and named its own old volume: the TV keeps its volume instead. Returns the level to
     * tell the sender, or null on a fixed-volume device, whose level lives in the TV.
     */
    fun startSession(senderLevel: Double): Double? {
        this.senderLevel = senderLevel
        if (fixed) return null
        toldSenderAtMs = SystemClock.elapsedRealtime()
        return audio.getStreamVolume(AudioManager.STREAM_MUSIC).toDouble() / maxIndex
    }

    /** The sender moved its volume slider or pressed a volume button. */
    fun fromSender(level: Double) {
        if (isEcho(SystemClock.elapsedRealtime(), toldSenderAtMs)) return
        if (!fixed) {
            senderSetAtMs = SystemClock.elapsedRealtime()
            main.removeCallbacks(tellSender)
            audio.setStreamVolume(AudioManager.STREAM_MUSIC, volumeIndex(level, maxIndex), AudioManager.FLAG_SHOW_UI)
            return
        }
        val from = senderLevel ?: run {
            senderLevel = level
            return
        }
        val steps = volumeSteps(from, level)
        if (steps == 0) return
        // Only whole steps are used up, so a slow drag still adds up to a step
        senderLevel = from + steps.toDouble() / SENDER_VOLUME_STEPS
        val direction = if (steps > 0) AudioManager.ADJUST_RAISE else AudioManager.ADJUST_LOWER
        repeat(abs(steps)) { audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, AudioManager.FLAG_SHOW_UI) }
    }
}
