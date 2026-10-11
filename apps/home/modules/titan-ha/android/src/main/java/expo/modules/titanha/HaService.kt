package expo.modules.titanha

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/** Адрес, токен и устройства кабинки хранятся на планшете: связь с HA не зависит от сервера Titan. */
object HaPrefs {
  private const val NAME = "titan_ha"

  fun load(context: Context): HaConfig? {
    val p = context.getSharedPreferences(NAME, Context.MODE_PRIVATE)
    val url = p.getString("url", null) ?: return null
    val token = p.getString("token", null) ?: return null
    val ids = (p.getString("entities", "") ?: "").split(',').filter { it.isNotBlank() }
    return HaConfig(url, token, ids)
  }

  fun save(context: Context, cfg: HaConfig) {
    context.getSharedPreferences(NAME, Context.MODE_PRIVATE).edit()
      .putString("url", cfg.url)
      .putString("token", cfg.token)
      .putString("entities", cfg.entityIds.joinToString(","))
      .commit()
  }

  fun clear(context: Context) {
    context.getSharedPreferences(NAME, Context.MODE_PRIVATE).edit().clear().commit()
  }

  fun saveLastMode(context: Context, entityId: String, mode: String) {
    val p = context.getSharedPreferences(NAME, Context.MODE_PRIVATE)
    if (p.getString("mode:$entityId", null) != mode) p.edit().putString("mode:$entityId", mode).apply()
  }

  fun lastMode(context: Context, entityId: String): String? =
    context.getSharedPreferences(NAME, Context.MODE_PRIVATE).getString("mode:$entityId", null)
}

/**
 * Постоянный сервис «Умный дом»: держит соединение с Home Assistant всё время, пока
 * работает планшет, — и когда экран Titan Home свёрнут (сотрудник в настройках
 * Android), и после перезапуска интерфейса. Держит Wi-Fi и процесс бодрыми,
 * перезапускается системой (START_STICKY) и после перезагрузки (HaBootReceiver).
 */
class HaService : Service() {
  private val main = Handler(Looper.getMainLooper())
  private val listener = object : HaListener {
    override fun onStatus(status: String, error: String?) {
      main.post { updateNotification() }
    }

    override fun onEntities(json: String) = Unit
  }
  private var wifiLock: WifiManager.WifiLock? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var shownStatus: String? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    createChannel()
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
      } else {
        startForeground(NOTIFICATION_ID, buildNotification())
      }
    } catch (_: Exception) {
      // Система не дала стать foreground — соединение всё равно держим, пока жив процесс.
    }
    acquireLocks()
    HaClient.addListener(listener)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val cfg = HaPrefs.load(this)
    if (cfg == null) {
      stopSelf()
      return START_NOT_STICKY
    }
    HaClient.start(applicationContext, cfg)
    return START_STICKY
  }

  override fun onDestroy() {
    HaClient.removeListener(listener)
    wifiLock?.let { if (it.isHeld) it.release() }
    wakeLock?.let { if (it.isHeld) it.release() }
    super.onDestroy()
  }

  private fun acquireLocks() {
    try {
      val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
      @Suppress("DEPRECATION")
      val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) WifiManager.WIFI_MODE_FULL_LOW_LATENCY else WifiManager.WIFI_MODE_FULL_HIGH_PERF
      wifiLock = wm.createWifiLock(mode, "titan-home:ha").apply {
        setReferenceCounted(false)
        acquire()
      }
    } catch (_: Exception) {
    }
    try {
      val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "titan-home:ha").apply {
        setReferenceCounted(false)
        acquire()
      }
    } catch (_: Exception) {
    }
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = getSystemService(NotificationManager::class.java) ?: return
    val channel = NotificationChannel(CHANNEL_ID, "Умный дом", NotificationManager.IMPORTANCE_MIN).apply {
      description = "Постоянное подключение к Home Assistant"
      setShowBadge(false)
    }
    nm.createNotificationChannel(channel)
  }

  private fun buildNotification() = NotificationCompat.Builder(this, CHANNEL_ID)
    .setSmallIcon(R.drawable.titan_ha_notification)
    .setContentTitle("Titan Home")
    .setContentText(statusText(HaClient.status))
    .setOngoing(true)
    .setSilent(true)
    .setPriority(NotificationCompat.PRIORITY_MIN)
    .setCategory(NotificationCompat.CATEGORY_SERVICE)
    .setContentIntent(openAppIntent())
    .build()

  private fun updateNotification() {
    val status = HaClient.status
    if (status == shownStatus) return
    shownStatus = status
    try {
      getSystemService(NotificationManager::class.java)?.notify(NOTIFICATION_ID, buildNotification())
    } catch (_: Exception) {
    }
  }

  private fun statusText(status: String) = when (status) {
    "connected" -> "Умный дом подключён"
    "connecting" -> "Подключаемся к Home Assistant…"
    "auth_failed" -> "Home Assistant не принял токен — проверьте его в Titan HUB"
    "offline" -> "Нет связи с Home Assistant — переподключаемся"
    else -> "Умный дом"
  }

  private fun openAppIntent(): PendingIntent? {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return null
    return PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  companion object {
    private const val CHANNEL_ID = "titan_home_ha"
    private const val NOTIFICATION_ID = 4710

    fun start(context: Context) {
      try {
        ContextCompat.startForegroundService(context, Intent(context, HaService::class.java))
      } catch (_: Exception) {
        // Запуск из фона запрещён (Android 12+) — поднимемся при следующем открытии экрана.
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, HaService::class.java))
    }
  }
}

/** После перезагрузки или обновления приложения — сразу снова на связи с HA. */
class HaBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (HaPrefs.load(context) != null) HaService.start(context)
  }
}
