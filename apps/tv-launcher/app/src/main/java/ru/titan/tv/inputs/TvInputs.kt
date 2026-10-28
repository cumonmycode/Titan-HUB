package ru.titan.tv.inputs

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.media.tv.TvContract
import android.media.tv.TvInputInfo
import android.media.tv.TvInputManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** One HDMI socket of the TV. [hasSignal] is true only when the TV reports a powered device on it. */
data class TvSource(val id: String, val label: String, val hasSignal: Boolean)

private const val TAG = "TvInputs"
private const val GENERIC_LABEL = "HDMI"

/**
 * The TV's HDMI inputs and the way to switch to one. Live TV and AV are left out: the booth has no aerial,
 * and a guest only ever plugs a console or a laptop into HDMI.
 */
class TvInputs(private val context: Context) {
    // Absent on anything that is not a TV; then there are simply no sources
    private val manager: TvInputManager? = context.getSystemService(TvInputManager::class.java)

    private val _sources = MutableStateFlow<List<TvSource>>(emptyList())
    val sources: StateFlow<List<TvSource>> = _sources.asStateFlow()

    fun start() {
        val tv = manager ?: return
        tv.registerCallback(
            object : TvInputManager.TvInputCallback() {
                override fun onInputStateChanged(inputId: String, state: Int) = refresh()
                override fun onInputAdded(inputId: String) = refresh()
                override fun onInputRemoved(inputId: String) = refresh()
                override fun onInputUpdated(inputId: String) = refresh()
            },
            Handler(Looper.getMainLooper()),
        )
        refresh()
    }

    fun refresh() {
        val tv = manager ?: return
        val hdmi = runCatching { tv.tvInputList }.getOrDefault(emptyList())
            .filter { it.type == TvInputInfo.TYPE_HDMI && it.isPassthroughInput && !it.isHidden(context) }
            .sortedBy { it.id }
        _sources.value = hdmi.mapIndexed { index, info ->
            TvSource(
                id = info.id,
                label = labelOf(info, index),
                hasSignal = runCatching { tv.getInputState(info.id) }.getOrNull() == TvInputManager.INPUT_STATE_CONNECTED,
            )
        }
    }

    /** Hands the screen to the TV's own player on [source]; it stays there until Home is pressed. */
    fun open(source: TvSource) {
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(TvContract.buildChannelUriForPassthroughInput(source.id), TvContract.Channels.CONTENT_ITEM_TYPE)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            Log.w(TAG, "No player for ${source.id}", e)
        }
    }

    /** A name staff gave the input in TV settings wins; otherwise «HDMI 1», «HDMI 2»… in socket order. */
    private fun labelOf(info: TvInputInfo, index: Int): String {
        val custom = info.loadCustomLabel(context)?.toString()?.trim().orEmpty()
        if (custom.isNotEmpty()) return custom
        val label = info.loadLabel(context)?.toString()?.trim().orEmpty()
        val numbered = label.any { it.isDigit() }
        return if (numbered) label else "$GENERIC_LABEL ${index + 1}"
    }
}
