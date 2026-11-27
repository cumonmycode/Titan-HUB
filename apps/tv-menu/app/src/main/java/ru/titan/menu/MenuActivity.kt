package ru.titan.menu

import android.annotation.SuppressLint
import android.annotation.TargetApi
import android.app.Activity
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Intent
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebViewRenderProcess
import android.webkit.WebViewRenderProcessClient
import android.widget.FrameLayout
import android.widget.TextView
import org.json.JSONObject
import java.io.IOException
import java.net.Inet4Address
import java.text.DateFormat
import java.util.Calendar
import java.util.Date
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * Экран телевизора. Что показывать, решает Titan HUB («Управление → Экраны»):
 *  • привязан — открываем /screen/<id> клуба, раз в 20 с отмечаемся (в сети, поворот);
 *  • не привязан — показываем код, объявляемся в локальной сети и ждём телефон;
 *  • старый режим Titan Menu 1.0 — показываем /menu, но телефон уже может нас найти.
 * В любом режиме держим Wi‑Fi включённым (NetworkKeeper). Точное время узнаём сами (TrueTime):
 * сбитая дата приставки больше не рвёт связь с сервером, а систему подталкиваем взять время
 * из сети заново (DeviceClock).
 * Страница сама отмечается раз в 10 с (мост TitanMenu.alive). Замолчала на 90 с — перезагружаем
 * её, не помогло — пересоздаём WebView; движок страницы завис или упал — тоже пересоздаём.
 * Раз в сутки ночью приложение перезапускается целиком: WebView на приставке копит память.
 * «Назад» экран не закрывает; пропала связь — показываем, что происходит, и повторяем
 * сами. Настройки приставки — удержать OK на пульте.
 */
class MenuActivity : Activity(), LocalServer.Listener {
    private enum class Mode { PAIRED, LEGACY, UNPAIRED }

    private val handler = Handler(Looper.getMainLooper())
    /** Пульс к серверу. */
    private val worker = Executors.newSingleThreadScheduledExecutor()
    /** Wi‑Fi и часы — отдельно: зависший запрос пульса их не задерживает. */
    private val upkeep = Executors.newSingleThreadScheduledExecutor()
    private lateinit var prefs: Prefs
    private lateinit var rotated: RotatedLayout
    private lateinit var stage: FrameLayout
    private lateinit var status: View
    private lateinit var statusText: TextView
    private lateinit var statusHost: TextView
    private lateinit var pairing: View
    private lateinit var hint: TextView
    private lateinit var clockWarning: TextView
    private lateinit var advertiser: Advertiser
    private lateinit var keeper: NetworkKeeper
    private val server = LocalServer(this)
    private var web: WebView? = null
    @Volatile private var cache: OfflineCache? = null
    private var mode = Mode.UNPAIRED
    private var url: String? = null
    private var host = ""
    private var failed = false
    private var retryDelay = RETRY_MIN_MS
    private var holdHandled = false
    private var heartbeat: ScheduledFuture<*>? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var resumed = false
    /** Страница отмечалась хотя бы раз после загрузки — значит, умеет, и её молчание — сбой. */
    @Volatile private var aliveSeen = false
    @Volatile private var lastAlive = 0L
    private var rescues = 0
    @Volatile private var unresponsiveSince = 0L

    private val retry = Runnable { load() }
    private val stuck = Runnable { fail(getString(R.string.status_slow)) }
    private val hideHint = Runnable { hint.animate().alpha(0f).setDuration(HINT_FADE_MS).start() }
    private val clockWatch = object : Runnable {
        override fun run() {
            showClockWarning()
            handler.postDelayed(this, CLOCK_CHECK_MS)
        }
    }
    private val watchdog = object : Runnable {
        override fun run() {
            checkPage()
            maybeDailyRestart()
            handler.postDelayed(this, WATCHDOG_MS)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        advertiser = Advertiser(this)
        keeper = NetworkKeeper(this)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        // Страницу можно отладить через chrome://inspect, подключив приставку по adb.
        WebView.setWebContentsDebuggingEnabled(true)
        setContentView(buildScreen())
        hideSystemBars()
        watchNetwork()
        upkeep.scheduleWithFixedDelay(guarded("Wi‑Fi") { keeper.check() }, 0, KEEPER_SEC, TimeUnit.SECONDS)
        upkeep.scheduleWithFixedDelay(guarded("часы") { syncClock() }, 0, CLOCK_SYNC_CHECK_SEC, TimeUnit.SECONDS)
        handler.post(clockWatch)
        handler.postDelayed(watchdog, WATCHDOG_MS)
        applyMode()
    }

    private fun buildScreen(): View {
        stage = FrameLayout(this).apply { setBackgroundColor(getColor(R.color.bg)) }
        status = layoutInflater.inflate(R.layout.view_status, stage, false)
        statusText = status.findViewById(R.id.status_text)
        statusHost = status.findViewById(R.id.status_host)
        pairing = layoutInflater.inflate(R.layout.view_pairing, stage, false)
        hint = layoutInflater.inflate(R.layout.view_hint, stage, false) as TextView
        clockWarning = layoutInflater.inflate(R.layout.view_clock, stage, false) as TextView
        stage.addView(status)
        stage.addView(pairing)
        stage.addView(hint)
        stage.addView(clockWarning)
        rotated = RotatedLayout(this).apply {
            setBackgroundColor(getColor(R.color.bg))
            addView(stage)
        }
        return rotated
    }

    // ── Режимы ─────────────────────────────────────────────────────────────

    private fun applyMode() {
        val screenUrl = prefs.screenUrl
        val legacyUrl = prefs.legacyUrl
        mode = when {
            screenUrl != null -> Mode.PAIRED
            legacyUrl != null -> Mode.LEGACY
            else -> Mode.UNPAIRED
        }
        rotated.angle = prefs.rotation
        when (mode) {
            Mode.PAIRED -> {
                stopDiscovery()
                pairing.visibility = View.GONE
                screenUrl?.let(::open)
                startHeartbeat()
            }
            Mode.LEGACY -> {
                stopHeartbeat()
                startDiscovery()
                pairing.visibility = View.GONE
                legacyUrl?.let(::open)
            }
            Mode.UNPAIRED -> {
                stopHeartbeat()
                closePage()
                startDiscovery()
                showPairing()
            }
        }
        showHint()
    }

    private fun showPairing() {
        pairing.findViewById<TextView>(R.id.pair_code).text = prefs.pairCode
        pairing.findViewById<TextView>(R.id.pair_meta).text =
            listOfNotNull(localIp()?.let { "IP $it" }, "Titan Menu ${BuildConfig.VERSION_NAME}").joinToString(" · ")
        pairing.visibility = View.VISIBLE
    }

    private fun startDiscovery() {
        server.start()
        val code = prefs.pairCode
        advertiser.start(
            "Titan TV $code",
            mapOf("id" to prefs.deviceId, "code" to code, "model" to deviceModel(), "v" to BuildConfig.VERSION_NAME),
        )
    }

    private fun stopDiscovery() {
        advertiser.stop()
        server.stop()
    }

    // ── Привязка с телефона (LocalServer) ──────────────────────────────────

    override fun info(): JSONObject = JSONObject()
        .put("deviceId", prefs.deviceId)
        .put("code", prefs.pairCode)
        .put("name", "Titan TV ${prefs.pairCode}")
        .put("model", deviceModel())
        .put("appVersion", BuildConfig.VERSION_NAME)
        .put("paired", prefs.isPaired)
        .put("screenName", prefs.screenName ?: JSONObject.NULL)

    override fun pair(host: String, secret: String, code: String): Pair<Int, JSONObject> {
        if (prefs.isPaired) {
            return 409 to LocalServer.error("Приставка уже показывает экран «${prefs.screenName.orEmpty()}». Отвяжите её в Titan HUB.")
        }
        if (code != prefs.pairCode) return 403 to LocalServer.error("Код не совпадает с кодом на экране телевизора")
        return try {
            val (bound, token) = HubClient.claim(host, secret, prefs.deviceId, deviceModel(), BuildConfig.VERSION_NAME)
            prefs.savePairing(host, bound.screenId, token, bound.name, bound.rotation)
            handler.post { applyMode() }
            200 to JSONObject().put("ok", true).put("screenId", bound.screenId).put("name", bound.name)
        } catch (e: HubClient.ClaimFailed) {
            400 to LocalServer.error(e.message ?: "Привязка не удалась")
        } catch (e: IOException) {
            Log.w(TAG, "Нет связи с клубом при привязке", e)
            502 to LocalServer.error("Телевизор не достучался до $host — проверьте интернет на приставке")
        }
    }

    // ── Пульс: «в сети», поворот, отвязка из HUB ───────────────────────────

    private fun startHeartbeat() {
        stopHeartbeat()
        heartbeat = worker.scheduleWithFixedDelay(guarded("пульс") { beat() }, 0, HEARTBEAT_SEC, TimeUnit.SECONDS)
    }

    /** Упавшая задача у ScheduledExecutor больше не повторяется — без этого пульс замолчал бы до перезапуска. */
    private fun guarded(name: String, task: () -> Unit) = Runnable {
        try {
            task()
        } catch (e: Exception) {
            Log.w(TAG, "Сбой задачи «$name»", e)
        }
    }

    private fun stopHeartbeat() {
        heartbeat?.cancel(false)
        heartbeat = null
    }

    private fun beat() {
        val host = prefs.host ?: return
        val token = prefs.token ?: return
        when (val result = HubClient.heartbeat(host, token, BuildConfig.VERSION_NAME)) {
            is HubClient.Beat.Ok -> handler.post { onBound(result.bound) }
            HubClient.Beat.Unpaired -> handler.post { onUnpaired() }
            HubClient.Beat.Offline -> Unit
        }
    }

    private fun onBound(bound: HubClient.Bound) {
        if (mode != Mode.PAIRED) return
        if (bound.rotation != prefs.rotation || bound.name != prefs.screenName) {
            prefs.saveScreen(bound.name, bound.rotation)
            rotated.angle = prefs.rotation
        }
    }

    private fun onUnpaired() {
        if (mode != Mode.PAIRED) return
        Log.i(TAG, "Экран отвязан в Titan HUB — показываем код")
        prefs.clearPairing()
        applyMode()
    }

    // ── Дата приставки ─────────────────────────────────────────────────────

    /**
     * Сверяем время: пока точного нет или часы приставки сбиты — каждую минуту, иначе раз в
     * 30 мин. Сбиты — подталкиваем систему; узнали точное время — сразу повторяем загрузку.
     */
    private fun syncClock() {
        val due = !TrueTime.isKnown || TrueTime.isDeviceClockOff() || TrueTime.sinceSyncMs > CLOCK_RESYNC_MS
        if (due) {
            val wasKnown = TrueTime.isKnown
            val hosts = listOfNotNull(prefs.host, url?.let { Uri.parse(it) }?.let { "${it.scheme}://${it.host}" }).distinct()
            if (TrueTime.sync(hosts) && !wasKnown) handler.post { if (failed) { retryDelay = RETRY_MIN_MS; load() } }
        }
        DeviceClock.nudgeSystem(this)
    }

    private fun showClockWarning() {
        val wrong = DeviceClock.isWrong()
        if (wrong) clockWarning.text = getString(R.string.clock_wrong, DateFormat.getDateInstance(DateFormat.LONG).format(Date()))
        clockWarning.visibility = if (wrong) View.VISIBLE else View.GONE
    }

    // ── Страница ───────────────────────────────────────────────────────────

    private fun open(target: String) {
        if (target == url && web != null) return
        url = target
        host = Uri.parse(target).host.orEmpty()
        statusHost.text = host
        statusText.text = getString(R.string.status_loading)
        status.visibility = View.VISIBLE
        failed = false
        retryDelay = RETRY_MIN_MS
        if (web == null) createWebView()
        load()
    }

    private fun closePage() {
        handler.removeCallbacks(retry)
        handler.removeCallbacks(stuck)
        url = null
        web?.loadUrl("about:blank")
        status.visibility = View.GONE
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView() {
        val view = WebView(this).apply {
            setBackgroundColor(getColor(R.color.bg))
            isFocusable = false
            isFocusableInTouchMode = false
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            settings.javaScriptEnabled = true // страница экрана собирается скриптом
            settings.domStorageEnabled = true // она помнит тему и время прошлой загрузки
            settings.mediaPlaybackRequiresUserGesture = false
            settings.textZoom = 100 // крупный шрифт в системе ломает раскладку меню
            settings.setSupportZoom(false)
            settings.userAgentString = "${settings.userAgentString} TitanMenu/${BuildConfig.VERSION_NAME}"
            if (cache == null) cache = OfflineCache(this@MenuActivity, settings.userAgentString)
            addJavascriptInterface(PageBridge(), "TitanMenu")
            webViewClient = PageClient()
            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                    Log.d(TAG, "${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                    return true
                }
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) watchRenderer(view)
        stage.addView(view, 0, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        web = view
        aliveSeen = false
        unresponsiveSince = 0L
    }

    /** Мост для страницы экрана: «я жива» и точное время для часов на экране. */
    private inner class PageBridge {
        @JavascriptInterface
        fun alive() {
            lastAlive = SystemClock.elapsedRealtime()
            aliveSeen = true
        }

        @JavascriptInterface
        fun now(): Double = TrueTime.now().toDouble()

        @JavascriptInterface
        fun version(): String = BuildConfig.VERSION_NAME
    }

    /** Движок страницы завис (не отвечает дольше 30 с) — завершаем его, дальше onRenderProcessGone. */
    @TargetApi(Build.VERSION_CODES.Q)
    private fun watchRenderer(view: WebView) {
        view.setWebViewRenderProcessClient(object : WebViewRenderProcessClient() {
            override fun onRenderProcessUnresponsive(view: WebView, renderer: WebViewRenderProcess?) {
                val now = SystemClock.elapsedRealtime()
                if (unresponsiveSince == 0L) unresponsiveSince = now
                if (now - unresponsiveSince < RENDERER_HANG_MS) return
                Log.w(TAG, "Страница не отвечает ${(now - unresponsiveSince) / 1000} с — перезапускаем движок")
                unresponsiveSince = 0L
                if (renderer?.terminate() != true) handler.post { restartWebView() }
            }

            override fun onRenderProcessResponsive(view: WebView, renderer: WebViewRenderProcess?) {
                unresponsiveSince = 0L
            }
        })
    }

    /**
     * Страница отмечается раз в 10 с. Замолчала (зависли скрипты, сеть, движок) — сначала
     * перезагружаем её, не помогло — пересоздаём WebView. Старая страница из кэша, которая
     * отмечаться не умеет, сторожа не включает.
     */
    private fun checkPage() {
        val view = web ?: return
        if (url == null || failed || !aliveSeen) return
        val now = SystemClock.elapsedRealtime()
        if (now - lastAlive < PAGE_SILENT_MS) {
            rescues = 0
            return
        }
        lastAlive = now
        rescues++
        if (rescues == 1) {
            Log.w(TAG, "Страница замолчала — перезагружаем")
            view.reload()
        } else {
            Log.w(TAG, "Страница снова молчит — пересоздаём WebView")
            rescues = 0
            restartWebView()
        }
    }

    /**
     * Раз в сутки, ночью (5:00–6:00 по точному времени) — перезапуск приложения целиком:
     * WebView на приставке за дни копит память, а с ней приходят рывки и зависания.
     * Если точного времени нет — после 26 часов работы в любое время.
     */
    private fun maybeDailyRestart() {
        if (!resumed || mode == Mode.UNPAIRED) return
        val up = SystemClock.elapsedRealtime() - Process.getStartElapsedRealtime()
        if (up < DAILY_MIN_UPTIME_MS) return
        val hour = Calendar.getInstance().apply { timeInMillis = TrueTime.now() }.get(Calendar.HOUR_OF_DAY)
        val night = TrueTime.isKnown && hour == DAILY_RESTART_HOUR
        if (!night && up < DAILY_MAX_UPTIME_MS) return
        Log.i(TAG, "Плановый перезапуск после ${up / 3_600_000} ч работы")
        val relaunch = PendingIntent.getActivity(
            this, 0,
            Intent(this, MenuActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        getSystemService(AlarmManager::class.java)?.set(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + RELAUNCH_DELAY_MS, relaunch)
        Process.killProcess(Process.myPid())
    }

    private fun load() {
        handler.removeCallbacks(retry)
        val target = url ?: return
        if (status.visibility == View.VISIBLE && failed) statusText.text = getString(R.string.status_connecting)
        web?.loadUrl(target)
    }

    private fun fail(reason: String) {
        if (url == null) return
        failed = true
        handler.removeCallbacks(stuck)
        handler.removeCallbacks(retry)
        statusText.text = getString(R.string.status_retry, reason, retryDelay / 1000)
        status.visibility = View.VISIBLE
        handler.postDelayed(retry, retryDelay)
        retryDelay = (retryDelay * 2).coerceAtMost(RETRY_MAX_MS)
    }

    private fun shown() {
        if (failed || url == null) return
        handler.removeCallbacks(stuck)
        retryDelay = RETRY_MIN_MS
        status.visibility = View.GONE
    }

    private fun describe(code: Int): String = when {
        !online() -> getString(R.string.status_offline)
        code == WebViewClient.ERROR_HOST_LOOKUP -> getString(R.string.status_dns, host)
        code == WebViewClient.ERROR_CONNECT || code == WebViewClient.ERROR_TIMEOUT -> getString(R.string.status_timeout)
        code == WebViewClient.ERROR_FAILED_SSL_HANDSHAKE -> getString(R.string.status_ssl)
        else -> getString(R.string.status_error, code)
    }

    private fun online(): Boolean = getSystemService(ConnectivityManager::class.java)?.activeNetwork != null

    private inner class PageClient : WebViewClient() {
        // Уходить со страницы экрана некуда: чужие адреса не открываем.
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = request.url.host != host

        // Страница, данные, картинки и шрифты — через локальный кэш: экран живёт и без сети.
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? = cache?.intercept(request)

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            if (url == "about:blank") return
            aliveSeen = false
            failed = false
            handler.removeCallbacks(stuck)
            handler.postDelayed(stuck, LOAD_TIMEOUT_MS)
        }

        override fun onPageCommitVisible(view: WebView, url: String?) = shown()

        override fun onPageFinished(view: WebView, url: String?) = shown()

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) fail(describe(error.errorCode))
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
            if (!request.isForMainFrame) return
            val code = response.statusCode
            fail(if (code == 404) getString(R.string.status_not_found) else getString(R.string.status_http, code))
        }

        override fun onReceivedSslError(view: WebView, ssl: SslErrorHandler, error: SslError) {
            ssl.cancel()
            if (Uri.parse(error.url).host == host) fail(getString(R.string.status_ssl))
        }

        @TargetApi(Build.VERSION_CODES.O)
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            Log.w(TAG, "Процесс страницы завершился (сбой: ${detail.didCrash()}), открываем заново")
            // Колбэк может прийти и от уже убранного WebView — пересоздаём только текущий.
            if (view === web) handler.post { restartWebView() } else view.destroy()
            return true
        }
    }

    private fun restartWebView() {
        handler.removeCallbacks(stuck)
        web?.let {
            stage.removeView(it)
            it.destroy()
        }
        web = null
        createWebView()
        load()
    }

    private fun watchNetwork() {
        val connectivity = getSystemService(ConnectivityManager::class.java) ?: return
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                handler.post {
                    if (failed) {
                        retryDelay = RETRY_MIN_MS
                        load()
                    }
                    if (!TrueTime.isKnown || TrueTime.isDeviceClockOff()) upkeep.execute(guarded("часы") { syncClock() })
                    // Сеть сменилась — объявляемся заново (новый IP).
                    if (mode != Mode.PAIRED) startDiscovery()
                    if (mode == Mode.UNPAIRED) showPairing()
                }
            }
        }
        runCatching { connectivity.registerDefaultNetworkCallback(callback) }
            .onSuccess { networkCallback = callback }
            .onFailure { Log.w(TAG, "Не удалось следить за сетью", it) }
    }

    private fun localIp(): String? {
        val connectivity = getSystemService(ConnectivityManager::class.java) ?: return null
        val props = connectivity.getLinkProperties(connectivity.activeNetwork) ?: return null
        return props.linkAddresses.map { it.address }.firstOrNull { it is Inet4Address && !it.isLoopbackAddress }?.hostAddress
    }

    private fun deviceModel(): String = listOf(Build.MANUFACTURER, Build.MODEL).filter { it.isNotBlank() }.distinct().joinToString(" ")

    // ── Окно и пульт ───────────────────────────────────────────────────────

    private fun hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.apply {
                hide(WindowInsets.Type.systemBars())
                systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        when (event.keyCode) {
            in PASS_THROUGH -> return super.dispatchKeyEvent(event)
            KeyEvent.KEYCODE_MENU, KeyEvent.KEYCODE_SETTINGS, KeyEvent.KEYCODE_INFO -> if (event.action == KeyEvent.ACTION_UP) openSetup()
            in OK_KEYS -> onOk(event)
            else -> if (event.action == KeyEvent.ACTION_UP) showHint()
        }
        return true
    }

    /**
     * Удержание OK — настройки. Одни пульты при удержании шлют повторы (система
     * помечает их «долгим нажатием»), другие — только «отпущено» спустя время.
     */
    private fun onOk(event: KeyEvent) {
        val held = event.isLongPress || event.eventTime - event.downTime >= HOLD_MS
        when (event.action) {
            KeyEvent.ACTION_DOWN -> {
                if (event.repeatCount == 0) holdHandled = false
                if (held && !holdHandled) {
                    holdHandled = true
                    openSetup()
                }
            }
            KeyEvent.ACTION_UP -> when {
                holdHandled -> Unit
                held -> openSetup()
                else -> showHint()
            }
        }
    }

    private fun showHint() {
        hint.text = when (mode) {
            Mode.LEGACY -> getString(R.string.hint_legacy, prefs.pairCode)
            else -> getString(R.string.hint_settings)
        }
        handler.removeCallbacks(hideHint)
        hint.animate().cancel()
        hint.alpha = 1f
        handler.postDelayed(hideHint, HINT_MS)
    }

    private fun openSetup() = startActivity(Intent(this, SetupActivity::class.java))

    override fun onResume() {
        super.onResume()
        resumed = true
        web?.onResume()
        // Из настроек могли отвязать приставку или выключить старый режим.
        val expected = when {
            prefs.screenUrl != null -> Mode.PAIRED
            prefs.legacyUrl != null -> Mode.LEGACY
            else -> Mode.UNPAIRED
        }
        if (expected != mode) applyMode()
    }

    override fun onPause() {
        resumed = false
        web?.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        stopHeartbeat()
        worker.shutdownNow()
        upkeep.shutdownNow()
        stopDiscovery()
        networkCallback?.let { getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(it) }
        web?.destroy()
        web = null
        super.onDestroy()
    }

    private companion object {
        const val TAG = "TitanMenu"
        const val RETRY_MIN_MS = 5_000L
        const val RETRY_MAX_MS = 60_000L
        const val LOAD_TIMEOUT_MS = 45_000L
        const val HEARTBEAT_SEC = 20L
        const val KEEPER_SEC = 20L
        const val CLOCK_CHECK_MS = 15_000L
        const val CLOCK_SYNC_CHECK_SEC = 60L
        const val CLOCK_RESYNC_MS = 30 * 60_000L
        const val WATCHDOG_MS = 30_000L
        const val PAGE_SILENT_MS = 90_000L
        const val RENDERER_HANG_MS = 30_000L
        const val DAILY_RESTART_HOUR = 5
        const val DAILY_MIN_UPTIME_MS = 20 * 3_600_000L
        const val DAILY_MAX_UPTIME_MS = 26 * 3_600_000L
        const val RELAUNCH_DELAY_MS = 2_000L
        const val HOLD_MS = 1_200L
        const val HINT_MS = 6_000L
        const val HINT_FADE_MS = 400L
        val OK_KEYS = setOf(KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER)
        val PASS_THROUGH = setOf(
            KeyEvent.KEYCODE_VOLUME_UP,
            KeyEvent.KEYCODE_VOLUME_DOWN,
            KeyEvent.KEYCODE_VOLUME_MUTE,
            KeyEvent.KEYCODE_POWER,
            KeyEvent.KEYCODE_SLEEP,
            KeyEvent.KEYCODE_WAKEUP,
        )
    }
}
