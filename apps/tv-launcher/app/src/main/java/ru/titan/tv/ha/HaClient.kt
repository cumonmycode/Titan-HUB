package ru.titan.tv.ha

import android.util.Log
import ru.titan.tv.config.HaConfig
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

sealed interface HaStatus {
    data object NotConfigured : HaStatus
    data object Connecting : HaStatus
    data object Connected : HaStatus
    data class Offline(val reason: String) : HaStatus
    data class AuthFailed(val reason: String) : HaStatus
}

/**
 * Keeps one WebSocket open to Home Assistant, mirrors the watched entities and
 * reconnects with backoff. A rejected token stops the loop instead of retrying.
 */
class HaClient(
    private val config: HaConfig,
    initiallyWatched: Set<String>,
    private val http: OkHttpClient,
    private val scope: CoroutineScope,
) {
    // Read on the socket's reader thread, replaced from the main thread when a room finds more lights
    @Volatile
    private var watched: Set<String> = initiallyWatched

    private val _states = MutableStateFlow<Map<String, EntityState>>(emptyMap())
    val states: StateFlow<Map<String, EntityState>> = _states.asStateFlow()

    private val _status = MutableStateFlow<HaStatus>(HaStatus.Connecting)
    val status: StateFlow<HaStatus> = _status.asStateFlow()

    private val nextId = AtomicInteger(1)
    private val statesRequestId = AtomicInteger(NO_REQUEST)
    private val pending = ConcurrentHashMap<Int, CompletableDeferred<HaMessage.Result>>()

    @Volatile
    private var socket: WebSocket? = null

    // Only an authenticated socket may carry requests: anything sent before auth makes Home Assistant
    // answer auth_invalid and drop the connection for good
    @Volatile
    private var authedSocket: WebSocket? = null
    private var loop: Job? = null

    fun start() {
        if (loop?.isActive == true) return
        loop = scope.launch { connectLoop() }
    }

    fun stop() {
        loop?.cancel()
        loop = null
        socket?.close(NORMAL_CLOSE, null)
        socket = null
        authedSocket = null
    }

    suspend fun callService(
        domain: String,
        service: String,
        entityId: String?,
        data: Map<String, Any> = emptyMap(),
        returnResponse: Boolean = false,
    ): HaMessage.Result? = request { id -> HaProtocol.callService(id, domain, service, entityId, data, returnResponse) }

    /** Sends a command such as reading a registry or asking for a camera stream, and waits for its reply. */
    suspend fun query(type: String, fields: Map<String, Any> = emptyMap()): HaMessage.Result? =
        request { id -> HaProtocol.command(id, type, fields) }

    /** Mirrors [entities] from now on; a fresh snapshot makes newly added ones appear at once. */
    fun watch(entities: Set<String>) {
        if (entities == watched) return
        watched = entities
        // Before auth the snapshot sent on authentication already reads the new set
        val ws = authedSocket ?: return
        val id = nextId.getAndIncrement()
        statesRequestId.set(id)
        ws.send(HaProtocol.getStates(id))
    }

    private suspend fun request(build: (Int) -> String): HaMessage.Result? {
        val ws = authedSocket ?: return null
        val id = nextId.getAndIncrement()
        val reply = CompletableDeferred<HaMessage.Result>()
        pending[id] = reply
        return try {
            if (ws.send(build(id))) withTimeoutOrNull(CALL_TIMEOUT_MS) { reply.await() } else null
        } finally {
            pending.remove(id)
        }
    }

    private suspend fun connectLoop() {
        var backoff = INITIAL_BACKOFF_MS
        while (currentCoroutineContext().isActive) {
            _status.value = HaStatus.Connecting
            val authenticated = AtomicBoolean(false)
            val closed = CompletableDeferred<String>()
            val ws = try {
                http.newWebSocket(Request.Builder().url(config.websocketUrl).build(), Listener(authenticated, closed))
            } catch (e: IllegalArgumentException) {
                Log.w(TAG, "Home Assistant address is not a valid URL", e)
                _status.value = HaStatus.Offline("неверный адрес Home Assistant")
                return
            }
            socket = ws
            val reason = try {
                closed.await()
            } finally {
                if (!closed.isCompleted) ws.cancel()
            }
            socket = null
            authedSocket = null
            failPending(reason)
            if (_status.value is HaStatus.AuthFailed) return
            _status.value = HaStatus.Offline(reason)
            if (authenticated.get()) backoff = INITIAL_BACKOFF_MS
            delay(backoff)
            backoff = (backoff * 2).coerceAtMost(MAX_BACKOFF_MS)
        }
    }

    private fun failPending(reason: String) {
        pending.values.forEach { it.complete(HaMessage.Result(id = -1, success = false, result = null, error = reason)) }
        pending.clear()
    }

    // Applied on the socket's reader thread, in order with the events, so a newer change is never overwritten
    private fun applySnapshot(result: HaMessage.Result) {
        statesRequestId.set(NO_REQUEST)
        if (result.success) _states.value = HaProtocol.statesFrom(result.result).filterKeys { it in watched }
    }

    private fun onStateChanged(message: HaMessage.StateChanged) {
        if (message.entityId !in watched) return
        _states.update { current ->
            message.newState?.let { current + (message.entityId to it) } ?: (current - message.entityId)
        }
    }

    private inner class Listener(
        private val authenticated: AtomicBoolean,
        private val closed: CompletableDeferred<String>,
    ) : WebSocketListener() {

        override fun onMessage(webSocket: WebSocket, text: String) {
            when (val message = HaProtocol.parse(text) { it in watched }) {
                HaMessage.AuthRequired -> webSocket.send(HaProtocol.auth(config.token))
                HaMessage.AuthOk -> onAuthenticated(webSocket)
                is HaMessage.AuthInvalid -> {
                    _status.value = HaStatus.AuthFailed(message.reason)
                    webSocket.close(NORMAL_CLOSE, "auth failed")
                }
                is HaMessage.Result ->
                    if (message.id == statesRequestId.get()) applySnapshot(message) else pending[message.id]?.complete(message)
                is HaMessage.StateChanged -> onStateChanged(message)
                HaMessage.Ignored -> Unit
            }
        }

        private fun onAuthenticated(webSocket: WebSocket) {
            authenticated.set(true)
            authedSocket = webSocket
            _status.value = HaStatus.Connected
            webSocket.send(HaProtocol.subscribeStateChanges(nextId.getAndIncrement()))
            val id = nextId.getAndIncrement()
            statesRequestId.set(id)
            webSocket.send(HaProtocol.getStates(id))
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(NORMAL_CLOSE, null)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            closed.complete(reason.ifEmpty { "соединение закрыто ($code)" })
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            Log.w(TAG, "Home Assistant connection failed", t)
            closed.complete(t.message ?: "нет соединения")
        }
    }

    private companion object {
        const val TAG = "HaClient"
        const val NO_REQUEST = -1
        const val NORMAL_CLOSE = 1000
        const val CALL_TIMEOUT_MS = 10_000L
        const val INITIAL_BACKOFF_MS = 1_000L
        const val MAX_BACKOFF_MS = 30_000L
    }
}
