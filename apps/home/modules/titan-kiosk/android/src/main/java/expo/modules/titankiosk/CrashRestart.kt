package expo.modules.titankiosk

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.SystemClock

/**
 * Киоск не должен оставаться на системном экране после падения: перехватываем
 * необработанное исключение, просим систему открыть Titan Home снова через 2 с и
 * отдаём падение обычному обработчику. Три падения за минуту — больше не
 * перезапускаем (иначе бесконечный цикл), до следующего удачного запуска.
 * Если Titan Home — домашний экран, Android и сам вернёт его после падения.
 */
object CrashRestart {
  private const val PREFS = "titan_kiosk_crash"
  private const val WINDOW_MS = 60_000L
  private const val MAX_IN_WINDOW = 3
  private const val RESTART_DELAY_MS = 2_000L

  @Volatile private var installed = false

  fun install(context: Context) {
    if (installed) return
    installed = true
    val app = context.applicationContext
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, error ->
      runCatching { scheduleRestart(app) }
      previous?.uncaughtException(thread, error)
    }
  }

  private fun scheduleRestart(context: Context) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val now = System.currentTimeMillis()
    val recent = (prefs.getString("times", "") ?: "")
      .split(',')
      .mapNotNull { it.toLongOrNull() }
      .filter { now - it < WINDOW_MS }
    prefs.edit().putString("times", (recent + now).joinToString(",")).commit()
    if (recent.size + 1 >= MAX_IN_WINDOW) return

    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
    val pending = PendingIntent.getActivity(
      context, 4711, launch, PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val alarms = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
    alarms.set(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + RESTART_DELAY_MS, pending)
  }
}
