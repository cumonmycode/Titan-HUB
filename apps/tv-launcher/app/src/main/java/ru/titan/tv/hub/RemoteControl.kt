package ru.titan.tv.hub

import android.app.ActivityManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ru.titan.tv.MainActivity
import kotlin.math.roundToInt

/** Carries out what staff press in «Экраны» on this TV, whatever app is in front. */
class RemoteControl(
    private val context: Context,
    private val scope: CoroutineScope,
    private val overlay: MessageOverlay,
) {
    private val audio = context.getSystemService(AudioManager::class.java)
    private val activities = context.getSystemService(ActivityManager::class.java)

    fun run(command: HubCommand) {
        Log.i(TAG, "Remote: $command")
        when (command) {
            HubCommand.Home -> goHome(screensaver = false)
            HubCommand.Screensaver -> goHome(screensaver = true)
            HubCommand.Reset -> reset()
            is HubCommand.Message -> overlay.show(command.text, command.seconds)
            is HubCommand.Volume -> setVolume(command.percent)
            is HubCommand.Mute -> mute(command.muted)
        }
    }

    // The launcher's own Home intent: it closes the panels and shows the home screen over any app
    private fun goHome(screensaver: Boolean) {
        val intent = Intent(context, MainActivity::class.java)
            .setAction(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_HOME)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra(MainActivity.EXTRA_SCREENSAVER, screensaver)
        try {
            context.startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            Log.w(TAG, "Home screen did not open", e)
        }
    }

    /** After the guests: the home screen, their apps closed and the usual volume. */
    private fun reset() {
        overlay.dismiss()
        goHome(screensaver = false)
        scope.launch {
            // Apps can be closed only once they are in the background behind the home screen
            delay(CLOSE_AFTER_MS)
            closeApps()
            setVolume(RESET_VOLUME_PERCENT)
        }
    }

    private fun closeApps() {
        val launchable = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER)
        context.packageManager.queryIntentActivities(launchable, 0)
            .map { it.activityInfo.packageName }
            .distinct()
            .filter { it != context.packageName }
            .forEach { packageName -> runCatching { activities.killBackgroundProcesses(packageName) } }
    }

    private fun setVolume(percent: Int) {
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
        val index = (percent.coerceIn(0, PERCENT) * max / PERCENT.toFloat()).roundToInt()
        if (index > 0 && audio.isStreamMute(AudioManager.STREAM_MUSIC)) {
            audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_UNMUTE, 0)
        }
        audio.setStreamVolume(AudioManager.STREAM_MUSIC, index, AudioManager.FLAG_SHOW_UI)
    }

    private fun mute(muted: Boolean) {
        val direction = if (muted) AudioManager.ADJUST_MUTE else AudioManager.ADJUST_UNMUTE
        audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, AudioManager.FLAG_SHOW_UI)
    }

    private companion object {
        const val TAG = "TitanRemote"
        const val CLOSE_AFTER_MS = 1_500L
        const val RESET_VOLUME_PERCENT = 30
        const val PERCENT = 100
    }
}
