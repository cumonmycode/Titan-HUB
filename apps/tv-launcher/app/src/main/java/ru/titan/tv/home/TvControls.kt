package ru.titan.tv.home

import android.content.Context
import android.media.AudioManager

enum class TvKey { VOLUME_DOWN, VOLUME_UP, MUTE, POWER }

/** Volume goes through the system, which forwards it to the TV over HDMI-CEC or IR. */
class TvControls(context: Context) {
    private val audio: AudioManager? = context.getSystemService(AudioManager::class.java)

    /** Power is not a system key; [SmartHome.tvPower] sends it through Home Assistant. */
    fun press(key: TvKey) {
        val direction = when (key) {
            TvKey.VOLUME_DOWN -> AudioManager.ADJUST_LOWER
            TvKey.VOLUME_UP -> AudioManager.ADJUST_RAISE
            TvKey.MUTE -> AudioManager.ADJUST_TOGGLE_MUTE
            TvKey.POWER -> return
        }
        audio?.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, AudioManager.FLAG_SHOW_UI)
    }
}
