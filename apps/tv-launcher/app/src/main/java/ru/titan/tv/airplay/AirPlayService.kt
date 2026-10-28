package ru.titan.tv.airplay

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import ru.titan.tv.R
import ru.titan.tv.graph

private const val TAG = "Titan/AirPlay"
private const val CHANNEL = "airplay"
private const val NOTIFICATION_ID = 7_001

/**
 * Keeps the launcher's process running while another app is in front, so the TV stays an AirPlay speaker
 * and keeps playing: without it Android may reclaim a background launcher on a 2 GB TV.
 */
class AirPlayService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        // Android may restart this service on its own after reclaiming the process; the speaker comes back with it
        graph.airplay
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notifications = getSystemService(NotificationManager::class.java)
        notifications.createNotificationChannel(NotificationChannel(CHANNEL, "AirPlay", NotificationManager.IMPORTANCE_MIN))
        val notification = Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle("AirPlay")
            .setOngoing(true)
            .build()
        // A restart from the background may be refused the foreground; the launcher starts it again when shown
        val started = runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        }
        started.onFailure {
            Log.w(TAG, "AirPlay service could not come to the foreground", it)
            stopSelf()
        }
        return START_STICKY
    }

    companion object {
        /** Call while the launcher is in front: Android refuses to start it from the background. */
        fun start(context: Context) {
            runCatching { context.startForegroundService(Intent(context, AirPlayService::class.java)) }
                .onFailure { Log.w(TAG, "AirPlay service did not start", it) }
        }
    }
}
