package expo.modules.titanha

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.Handler
import android.os.HandlerThread
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.TimeUnit

/** Подключение к Home Assistant: адрес и долгосрочный токен из Titan HUB, устройства кабинки. */
data class HaConfig(val url: String, val token: String, val entityIds: List<String>)

/** Подписчик на изменения: статус связи и изменившиеся устройства (JSON id → сущность|null). */
interface HaListener {
  fun onStatus(status: String, error: String?)
  fun onEntities(json: String)
}

/**
 * Постоянное соединение планшета с Home Assistant по локальной сети (WebSocket API).
 *
 * Живёт в нативном слое и не зависит от экрана приложения: его держит HaService.
 * Всё состояние меняется только в своём потоке (handler), колбэки OkHttp туда
 * перекладываются. Состояния устройств — подписка subscribe_entities; обрыв —
 * переподключение с паузой 1→30 с, а при появлении сети — сразу; неверный токен —
 * без повторов (нужно исправить токен в Titan HUB).
 *
 * Экрану отдаём только изменения: изменившиеся устройства копятся 100 мс и уходят
 * одним событием. Команды, пришедшие во время переподключения, ждут в очереди
 * до своего тайм-аута и уходят, как только связь вернётся.
 */
object HaClient {
  private val thread = HandlerThread("titan-ha").apply { start() }
  private val handler = Handler(thread.looper)
  private val http = OkHttpClient.Builder()
    .connectTimeout(10, TimeUnit.SECONDS)
    .readTimeout(0, TimeUnit.MILLISECONDS)
    // Пинги уровня WebSocket: «зависшее» соединение (роутер перезагрузился) рвётся
    // само, а не висит до следующей команды.
    .pingInterval(20, TimeUnit.SECONDS)
    .build()

  private val retrySteps = longArrayOf(1_000, 2_000, 5_000, 10_000, 20_000, 30_000)

  private class Pending(val callback: (Any?, String?) -> Unit, val timeout: Runnable)
  private class Queued(val payload: JSONObject, val callback: (Any?, String?) -> Unit, val timeout: Runnable)

  private var config: HaConfig? = null
  private var socket: WebSocket? = null
  /** Номер соединения: колбэки уже закрытых сокетов игнорируем. */
  private var generation = 0
  private var seq = 1
  private var subscriptionId = -1
  private var retry = 0
  private val entities = LinkedHashMap<String, JSONObject>()
  private val pending = HashMap<Int, Pending>()
  private val queue = ArrayList<Queued>()
  private val dirty = LinkedHashSet<String>()
  private val listeners = CopyOnWriteArraySet<HaListener>()
  private var networkCallback: ConnectivityManager.NetworkCallback? = null
  private var appContext: Context? = null

  @Volatile var status = "idle"
    private set
  @Volatile private var error: String? = null
  @Volatile private var snapshotJson = """{"status":"idle","error":null,"entities":{}}"""

  private val reconnectRunnable = Runnable { open() }
  private val flushRunnable = Runnable { flushEntities() }
  private val pongTimeout = Runnable { socket?.cancel() }
  private val pingRunnable: Runnable = object : Runnable {
    override fun run() {
      if (socket == null || status != "connected") return
      send(JSONObject().put("id", seq++).put("type", "ping"))
      handler.removeCallbacks(pongTimeout)
      handler.postDelayed(pongTimeout, 10_000)
      handler.postDelayed(this, 30_000)
    }
  }

  // ───────────────────────────── Публичное API ─────────────────────────────

  /** Подключиться; повторный вызов с той же конфигурацией ничего не рвёт. */
  fun start(context: Context, cfg: HaConfig) {
    handler.post {
      appContext = context.applicationContext
      registerNetwork(context.applicationContext)
      val same = cfg == config
      if (same && (status == "connected" || status == "connecting")) return@post
      if (!same) entities.clear()
      config = cfg
      retry = 0
      reconnect()
    }
  }

  fun stop() {
    handler.post {
      config = null
      handler.removeCallbacks(reconnectRunnable)
      closeSocket()
      failQueue("Умный дом отключён")
      val removed = entities.keys.toList()
      entities.clear()
      dirty.addAll(removed)
      flushEntities()
      setStatus("idle", null, force = true)
    }
  }

  /** Сеть вернулась / сотрудник нажал «Переподключить» — не ждём паузу. */
  fun reconnectNow() {
    handler.post {
      if (config == null || status == "connected") return@post
      retry = 0
      reconnect()
    }
  }

  fun snapshot(): String = snapshotJson

  fun addListener(listener: HaListener) {
    listeners.add(listener)
  }

  fun removeListener(listener: HaListener) {
    listeners.remove(listener)
  }

  /**
   * Команда в HA (call_service, get_states). Ответ — result или текст ошибки.
   * Связь переподнимается — команда ждёт в очереди (не дольше timeoutMs).
   */
  fun request(payload: JSONObject, timeoutMs: Long, callback: (Any?, String?) -> Unit) {
    handler.post {
      if (config == null) {
        callback(null, "Умный дом не настроен")
        return@post
      }
      if (socket != null && status == "connected") {
        dispatch(payload, timeoutMs, callback)
        return@post
      }
      lateinit var queued: Queued
      val timeout = Runnable {
        if (queue.remove(queued)) queued.callback(null, "Нет связи с Home Assistant")
      }
      queued = Queued(payload, callback, timeout)
      queue.add(queued)
      handler.postDelayed(timeout, timeoutMs)
      // Ждём паузы перед повтором — не ждём, подключаемся сейчас. Идущее
      // подключение не трогаем: команда уйдёт, как только оно завершится.
      if (status == "offline") {
        retry = 0
        reconnect()
      }
    }
  }

  private fun dispatch(payload: JSONObject, timeoutMs: Long, callback: (Any?, String?) -> Unit) {
    val id = seq++
    payload.put("id", id)
    val timeout = Runnable {
      pending.remove(id)?.callback?.invoke(null, "Home Assistant не ответил")
    }
    pending[id] = Pending(callback, timeout)
    handler.postDelayed(timeout, timeoutMs)
    send(payload)
  }

  /** Связь вернулась — отправляем накопленные команды (их тайм-аут уже идёт). */
  private fun flushQueue() {
    if (queue.isEmpty()) return
    val all = queue.toList()
    queue.clear()
    for (q in all) {
      handler.removeCallbacks(q.timeout)
      dispatch(q.payload, COMMAND_TIMEOUT_MS, q.callback)
    }
  }

  private fun failQueue(message: String) {
    if (queue.isEmpty()) return
    val all = queue.toList()
    queue.clear()
    for (q in all) {
      handler.removeCallbacks(q.timeout)
      q.callback(null, message)
    }
  }

  // ───────────────────────────── Соединение ─────────────────────────────

  private fun wsUrl(url: String): String {
    val base = url.trim().trimEnd('/')
    val ws = when {
      base.startsWith("https://", ignoreCase = true) -> "wss://" + base.substring(8)
      base.startsWith("http://", ignoreCase = true) -> "ws://" + base.substring(7)
      else -> "ws://$base"
    }
    return "$ws/api/websocket"
  }

  private fun reconnect() {
    handler.removeCallbacks(reconnectRunnable)
    closeSocket()
    open()
  }

  private fun open() {
    val cfg = config ?: return
    val gen = ++generation
    setStatus("connecting", null)
    val request = try {
      Request.Builder().url(wsUrl(cfg.url)).build()
    } catch (e: IllegalArgumentException) {
      setStatus("offline", "Неверный адрес Home Assistant")
      return
    }
    socket = http.newWebSocket(request, object : WebSocketListener() {
      override fun onMessage(webSocket: WebSocket, text: String) {
        handler.post { if (gen == generation) onMessage(text) }
      }

      override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        handler.post { if (gen == generation) onDisconnected() }
      }

      override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        handler.post { if (gen == generation) onDisconnected() }
      }
    })
  }

  private fun closeSocket() {
    generation++
    socket?.close(1000, null)
    socket = null
    subscriptionId = -1
    stopPing()
    failPending("Нет связи с Home Assistant")
  }

  private fun onDisconnected() {
    socket = null
    subscriptionId = -1
    stopPing()
    failPending("Нет связи с Home Assistant")
    if (config == null || status == "auth_failed") return
    setStatus("offline", "Нет связи с Home Assistant")
    scheduleReconnect()
  }

  private fun scheduleReconnect() {
    handler.removeCallbacks(reconnectRunnable)
    val delay = retrySteps[minOf(retry, retrySteps.size - 1)]
    retry++
    handler.postDelayed(reconnectRunnable, delay)
  }

  private fun registerNetwork(context: Context) {
    if (networkCallback != null) return
    val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
    val callback = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) {
        handler.post {
          if (config != null && status == "offline") {
            retry = 0
            reconnect()
          }
        }
      }
    }
    try {
      cm.registerDefaultNetworkCallback(callback)
      networkCallback = callback
    } catch (_: Exception) {
      // Без колбэка сети всё равно переподключимся по таймеру.
    }
  }

  private fun send(payload: JSONObject) {
    socket?.send(payload.toString())
  }

  private fun startPing() {
    stopPing()
    handler.postDelayed(pingRunnable, 30_000)
  }

  private fun stopPing() {
    handler.removeCallbacks(pingRunnable)
    handler.removeCallbacks(pongTimeout)
  }

  private fun failPending(message: String) {
    if (pending.isEmpty()) return
    val all = pending.values.toList()
    pending.clear()
    for (p in all) {
      handler.removeCallbacks(p.timeout)
      p.callback(null, message)
    }
  }

  // ───────────────────────────── Протокол HA ─────────────────────────────

  private fun onMessage(text: String) {
    val msg = try {
      JSONObject(text)
    } catch (_: Exception) {
      return
    }
    when (msg.optString("type")) {
      "auth_required" -> send(JSONObject().put("type", "auth").put("access_token", config?.token ?: ""))
      "auth_ok" -> {
        retry = 0
        setStatus("connected", null)
        subscribe()
        startPing()
        flushQueue()
      }
      "auth_invalid" -> {
        setStatus("auth_failed", "Home Assistant не принял токен")
        closeSocket()
        failQueue("Home Assistant не принял токен")
      }
      "result" -> {
        val p = pending.remove(msg.optInt("id", -1)) ?: return
        handler.removeCallbacks(p.timeout)
        if (msg.optBoolean("success")) {
          val result = msg.opt("result")
          p.callback(if (result == JSONObject.NULL) null else result, null)
        } else {
          val message = msg.optJSONObject("error")?.optString("message")
          p.callback(null, if (message.isNullOrBlank()) "Home Assistant отклонил команду" else message)
        }
      }
      "event" -> if (msg.optInt("id", -1) == subscriptionId) applyEntities(msg.optJSONObject("event"))
      "pong" -> handler.removeCallbacks(pongTimeout)
    }
  }

  private fun subscribe() {
    val ids = config?.entityIds ?: return
    if (ids.isEmpty()) return
    val id = seq++
    subscriptionId = id
    send(JSONObject().put("id", id).put("type", "subscribe_entities").put("entity_ids", JSONArray(ids)))
  }

  /** Сжатый формат subscribe_entities: a — полные состояния, c — изменения, r — удалённые. */
  private fun applyEntities(event: JSONObject?) {
    event ?: return
    event.optJSONObject("a")?.let { added ->
      for (id in added.keys()) {
        val s = added.optJSONObject(id) ?: continue
        entities[id] = JSONObject()
          .put("entity_id", id)
          .put("state", s.optString("s", "unknown"))
          .put("attributes", s.optJSONObject("a") ?: JSONObject())
        dirty.add(id)
      }
    }
    event.optJSONObject("c")?.let { changed ->
      for (id in changed.keys()) {
        val cur = entities[id] ?: continue
        val diff = changed.optJSONObject(id) ?: continue
        val attrs = cur.optJSONObject("attributes") ?: JSONObject().also { cur.put("attributes", it) }
        diff.optJSONObject("+")?.let { plus ->
          if (plus.has("s")) cur.put("state", plus.optString("s"))
          plus.optJSONObject("a")?.let { a -> for (k in a.keys()) attrs.put(k, a.get(k)) }
        }
        diff.optJSONObject("-")?.optJSONArray("a")?.let { removed ->
          for (i in 0 until removed.length()) attrs.remove(removed.optString(i))
        }
        dirty.add(id)
      }
    }
    event.optJSONArray("r")?.let { removed ->
      for (i in 0 until removed.length()) {
        val id = removed.optString(i)
        entities.remove(id)
        dirty.add(id)
      }
    }
    rememberModes()
    handler.removeCallbacks(flushRunnable)
    handler.postDelayed(flushRunnable, FLUSH_DELAY_MS)
  }

  /** Последний рабочий режим кондиционеров — «включить» вернёт его даже после перезапуска. */
  private fun rememberModes() {
    val ctx = appContext ?: return
    for (id in dirty) {
      if (!id.startsWith("climate.")) continue
      val mode = entities[id]?.optString("state") ?: continue
      if (mode.isNotEmpty() && mode != "off" && mode != "unavailable" && mode != "unknown") HaPrefs.saveLastMode(ctx, id, mode)
    }
  }

  private fun flushEntities() {
    handler.removeCallbacks(flushRunnable)
    if (dirty.isEmpty()) return
    val patch = JSONObject()
    for (id in dirty) patch.put(id, entities[id] ?: JSONObject.NULL)
    dirty.clear()
    rebuildSnapshot()
    val json = patch.toString()
    for (l in listeners) l.onEntities(json)
  }

  // ───────────────────────────── Состояние ─────────────────────────────

  private fun setStatus(next: String, err: String?, force: Boolean = false) {
    if (!force && next == status && err == error) return
    status = next
    error = err
    rebuildSnapshot()
    for (l in listeners) l.onStatus(next, err)
  }

  private fun rebuildSnapshot() {
    val all = JSONObject()
    for ((id, e) in entities) all.put(id, e)
    snapshotJson = JSONObject()
      .put("status", status)
      .put("error", error ?: JSONObject.NULL)
      .put("entities", all)
      .toString()
  }

  private const val FLUSH_DELAY_MS = 100L
  const val COMMAND_TIMEOUT_MS = 10_000L
}
