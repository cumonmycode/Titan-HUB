package ru.titan.menu

import android.annotation.SuppressLint
import android.annotation.TargetApi
import android.app.Activity
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
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import org.json.JSONObject
import java.io.IOException
import java.net.Inet4Address
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * Экран телевизора. Что показывать, решает Titan HUB («Управление → Экраны»):
 *  • привязан — открываем /screen/<id> клуба, раз в 20 с отмечаемся (в сети, поворот);
 *  • не привязан — показываем код, объявляемся в локальной сети и ждём телефон;
 *  • старый режим Titan Menu 1.0 — показываем /menu, но телефон уже может нас найти.
 * «Назад» экран не закрывает; пропала связь — показываем, что происходит, и повторяем
 * сами. Настройки приставки — удержать OK на пульте.
 */
class MenuActivity : Activity(), LocalServer.Listener {
    private enum class Mode { PAIRED, LEGACY, UNPAIRED }

    private val handler = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadScheduledExecutor()
    private lateinit var prefs: Prefs
    private lateinit var rotated: RotatedLayout
    private lateinit var stage: FrameLayout
    private lateinit var status: View
    private lateinit var statusText: TextView
    private lateinit var statusHost: TextView
    private lateinit var pairing: View
    private lateinit var hint: TextView
    private lateinit var advertiser: Advertiser
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

    private val retry = Runnable { load() }
    private val stuck = Runnable { fail(getString(R.string.status_slow)) }
    private val hideHint = Runnable { hint.animate().alpha(0f).setDuration(HINT_FADE_MS).start() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        advertiser = Advertiser(this)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        // Страницу можно отладить через chrome://inspect, подключив приставку по adb.
        WebView.setWebContentsDebuggingEnabled(true)
        setContentView(buildScreen())
        hideSystemBars()
        watchNetwork()
        applyMode()
    }

    private fun buildScreen(): View {
        stage = FrameLayout(this).apply { setBackgroundColor(getColor(R.color.bg)) }
        status = layoutInflater.inflate(R.layout.view_status, stage, false)
        statusText = status.findViewById(R.id.status_text)
        statusHost = status.findViewById(R.id.status_host)
        pairing = layoutInflater.inflate(R.layout.view_pairing, stage, false)
        hint = layoutInflater.inflate(R.layout.view_hint, stage, false) as TextView
        stage.addView(status)
        stage.addView(pairing)
        stage.addView(hint)
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
        heartbeat = worker.scheduleWithFixedDelay({ beat() }, 0, HEARTBEAT_SEC, TimeUnit.SECONDS)
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
            cache = OfflineCache(this@MenuActivity, settings.userAgentString)
            webViewClient = PageClient()
            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                    Log.d(TAG, "${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                    return true
                }
            }
        }
        stage.addView(view, 0, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        web = view
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
            restartWebView()
            return true
        }
    }

    private fun restartWebView() {
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
        web?.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        stopHeartbeat()
        worker.shutdownNow()
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
