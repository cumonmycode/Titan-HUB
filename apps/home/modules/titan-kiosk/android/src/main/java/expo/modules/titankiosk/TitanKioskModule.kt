package expo.modules.titankiosk

import android.app.Activity
import android.app.ActivityManager
import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.graphics.Rect
import android.os.BatteryManager
import android.os.Build
import android.provider.Settings
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Администратор устройства: через него владелец устройства получает права киоска. */
class KioskAdminReceiver : DeviceAdminReceiver()

/**
 * Режим киоска Titan Home.
 *
 * Два уровня защиты:
 *  - владелец устройства (dpm set-device-owner): закрепление экрана без вопросов,
 *    Titan Home навсегда становится «Домой», шторка уведомлений и экран блокировки
 *    отключены, экран не гаснет на зарядке;
 *  - без владельца: приложение — домашний экран (если выбрано в системе), полный
 *    экран и закрепление экрана Android по кнопке из панели сотрудника.
 */
class TitanKioskModule : Module() {
  private var immersive = false
  private var keepScreenOn = false

  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React context is not ready")
  private val dpm: DevicePolicyManager
    get() = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
  private val admin: ComponentName
    get() = ComponentName(context, KioskAdminReceiver::class.java)

  private fun isDeviceOwner(): Boolean = dpm.isDeviceOwnerApp(context.packageName)

  private fun lockTaskState(): String {
    val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    return when (am.lockTaskModeState) {
      ActivityManager.LOCK_TASK_MODE_LOCKED -> "locked"
      ActivityManager.LOCK_TASK_MODE_PINNED -> "pinned"
      else -> "none"
    }
  }

  private fun isDefaultHome(): Boolean {
    val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
    val info = context.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)
    return info?.activityInfo?.packageName == context.packageName
  }

  /** Права владельца устройства: «Домой» = Titan Home, без шторки и блокировки. */
  private fun prepareOwnerKiosk() {
    val pkg = context.packageName
    dpm.setLockTaskPackages(admin, arrayOf(pkg))
    val home = IntentFilter(Intent.ACTION_MAIN).apply {
      addCategory(Intent.CATEGORY_HOME)
      addCategory(Intent.CATEGORY_DEFAULT)
    }
    context.packageManager.getLaunchIntentForPackage(pkg)?.component?.let {
      dpm.addPersistentPreferredActivity(admin, home, it)
    }
    runCatching { dpm.setKeyguardDisabled(admin, true) }
    runCatching { dpm.setStatusBarDisabled(admin, true) }
    runCatching {
      val plugged = BatteryManager.BATTERY_PLUGGED_AC or BatteryManager.BATTERY_PLUGGED_USB or
        BatteryManager.BATTERY_PLUGGED_WIRELESS
      dpm.setGlobalSetting(admin, Settings.Global.STAY_ON_WHILE_PLUGGED_IN, plugged.toString())
    }
  }

  private fun applyWindow(activity: Activity) {
    val window = activity.window
    if (keepScreenOn) {
      window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    } else {
      window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      window.insetsController?.let {
        if (immersive) {
          it.hide(WindowInsets.Type.systemBars())
          it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        } else {
          it.show(WindowInsets.Type.systemBars())
        }
      }
    } else {
      @Suppress("DEPRECATION")
      window.decorView.systemUiVisibility = if (immersive) {
        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN or
          View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
          View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
      } else {
        View.SYSTEM_UI_FLAG_VISIBLE
      }
    }
  }

  private fun withActivity(block: (Activity) -> Unit) {
    appContext.currentActivity?.let(block)
  }

  override fun definition() = ModuleDefinition {
    Name("TitanKiosk")

    // Падение — не повод оставлять гостя на системном экране.
    OnCreate {
      appContext.reactContext?.let { CrashRestart.install(it) }
    }

    Function("getStatus") {
      mapOf(
        "isDeviceOwner" to isDeviceOwner(),
        "lockTask" to lockTaskState(),
        "isDefaultHome" to isDefaultHome(),
        "model" to "${Build.MANUFACTURER} ${Build.MODEL}",
        "androidVersion" to Build.VERSION.RELEASE,
        "sdk" to Build.VERSION.SDK_INT,
      )
    }

    /**
     * Закрепить экран. Владельцу устройства — молча; иначе Android спросит
     * «Закрепить приложение?» (вызывать только по кнопке сотрудника).
     */
    AsyncFunction("startLockTask") {
      if (isDeviceOwner()) prepareOwnerKiosk()
      withActivity { if (lockTaskState() == "none") it.startLockTask() }
      lockTaskState()
    }.runOnQueue(Queues.MAIN)

    /** Снять закрепление (сотрудник открывает настройки Android). */
    AsyncFunction("stopLockTask") {
      if (isDeviceOwner()) runCatching { dpm.setStatusBarDisabled(admin, false) }
      withActivity { if (lockTaskState() != "none") it.stopLockTask() }
      lockTaskState()
    }.runOnQueue(Queues.MAIN)

    /** Полностью вернуть планшет в обычный режим: снять владельца устройства. */
    AsyncFunction("clearDeviceOwner") {
      if (isDeviceOwner()) {
        val pkg = context.packageName
        withActivity { runCatching { it.stopLockTask() } }
        dpm.clearPackagePersistentPreferredActivities(admin, pkg)
        runCatching { dpm.setStatusBarDisabled(admin, false) }
        runCatching { dpm.setKeyguardDisabled(admin, false) }
        dpm.setLockTaskPackages(admin, arrayOf())
        @Suppress("DEPRECATION")
        dpm.clearDeviceOwnerApp(pkg)
      }
      isDeviceOwner()
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setImmersive") { enabled: Boolean ->
      immersive = enabled
      withActivity { applyWindow(it) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setKeepScreenOn") { enabled: Boolean ->
      keepScreenOn = enabled
      withActivity { applyWindow(it) }
    }.runOnQueue(Queues.MAIN)

    /** landscape | portrait | auto — как планшет закреплён в кабинке. */
    AsyncFunction("setOrientation") { mode: String ->
      withActivity {
        it.requestedOrientation = when (mode) {
          "landscape" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
          "portrait" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
          else -> ActivityInfo.SCREEN_ORIENTATION_FULL_USER
        }
      }
    }.runOnQueue(Queues.MAIN)

    /** settings | wifi | home — системные настройки для сотрудника. */
    AsyncFunction("openSettings") { kind: String ->
      val action = when (kind) {
        "wifi" -> Settings.ACTION_WIFI_SETTINGS
        "home" -> Settings.ACTION_HOME_SETTINGS
        else -> Settings.ACTION_SETTINGS
      }
      val intent = Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      runCatching { context.startActivity(intent) }.isSuccess
    }.runOnQueue(Queues.MAIN)

    /**
     * Участки у края экрана, где жест «Назад» навигации жестами не перехватывает
     * касание (язычок панели «Свет и климат»). Прямоугольники в dp:
     * [left, top, right, bottom]; пустой список — снять. Android учитывает не
     * больше 200 dp по высоте на каждый край.
     */
    AsyncFunction("setGestureExclusion") { rects: List<List<Double>> ->
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        withActivity { activity ->
          val d = activity.resources.displayMetrics.density
          activity.window.decorView.systemGestureExclusionRects = rects.filter { it.size == 4 }.map { (l, t, r, b) ->
            Rect((l * d).toInt(), (t * d).toInt(), (r * d).toInt(), (b * d).toInt())
          }
        }
      }
    }.runOnQueue(Queues.MAIN)

    /** Перезагрузка — только у владельца устройства. */
    AsyncFunction("reboot") {
      if (isDeviceOwner()) dpm.reboot(admin)
      isDeviceOwner()
    }

    // Окно пересоздаётся/теряет флаги после сворачивания — возвращаем режим.
    OnActivityEntersForeground {
      withActivity { activity -> activity.runOnUiThread { applyWindow(activity) } }
    }
  }
}
