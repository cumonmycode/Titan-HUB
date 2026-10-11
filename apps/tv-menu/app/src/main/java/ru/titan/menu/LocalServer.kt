package ru.titan.menu

import android.util.Log
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.ServerSocket
import java.net.Socket

/**
 * Маленький HTTP-сервер приставки для привязки с телефона по локальной сети.
 *   GET  /info — кто я: код на экране, модель, версия, подключена ли;
 *   POST /pair — {host, secret, code}: код должен совпасть с кодом на экране, тогда
 *               приставка сама меняет секрет на токен у сервера клуба и отвечает
 *               телефону, получилось ли.
 * Запросы обслуживаются по одному; тело — не больше 4 КБ.
 */
class LocalServer(private val listener: Listener) {
    interface Listener {
        fun info(): JSONObject
        /** Вызывается в потоке сервера (внутри — сетевой запрос к клубу). */
        fun pair(host: String, secret: String, code: String): Pair<Int, JSONObject>
    }

    @Volatile private var socket: ServerSocket? = null

    val isRunning: Boolean get() = socket?.isClosed == false

    fun start() {
        if (isRunning) return
        val server = try {
            ServerSocket(PORT).apply { reuseAddress = true }
        } catch (e: IOException) {
            Log.w(TAG, "Порт $PORT занят — привязка с телефона недоступна", e)
            return
        }
        socket = server
        Thread({ serve(server) }, "titan-pair").apply { isDaemon = true }.start()
    }

    fun stop() {
        runCatching { socket?.close() }
        socket = null
    }

    private fun serve(server: ServerSocket) {
        while (!server.isClosed) {
            val client = try { server.accept() } catch (e: IOException) { break }
            client.use { handle(it) }
        }
    }

    private fun handle(client: Socket) {
        try {
            client.soTimeout = READ_TIMEOUT_MS
            val input = client.getInputStream().buffered()
            val request = readLine(input)?.split(' ') ?: return
            if (request.size < 2) return
            val method = request[0]
            val path = request[1].substringBefore('?')
            var length = 0
            while (true) {
                val line = readLine(input) ?: return
                if (line.isEmpty()) break
                val colon = line.indexOf(':')
                if (colon > 0 && line.substring(0, colon).trim().equals("content-length", ignoreCase = true)) {
                    length = line.substring(colon + 1).trim().toIntOrNull() ?: 0
                }
            }
            if (length !in 0..MAX_BODY) return respond(client, 413, error("Слишком большой запрос"))
            val body = ByteArray(length)
            var read = 0
            while (read < length) {
                val n = input.read(body, read, length - read)
                if (n < 0) break
                read += n
            }
            val (status, json) = when {
                method == "OPTIONS" -> 204 to null
                method == "GET" && path == "/info" -> 200 to listener.info()
                method == "POST" && path == "/pair" -> pair(String(body, 0, read, Charsets.UTF_8))
                else -> 404 to error("Не найдено")
            }
            respond(client, status, json)
        } catch (e: Exception) {
            Log.w(TAG, "Запрос привязки не обработан", e)
        }
    }

    private fun pair(text: String): Pair<Int, JSONObject> {
        val json = runCatching { JSONObject(text) }.getOrNull() ?: return 400 to error("Нужен JSON")
        val host = json.optString("host").trim().trimEnd('/')
        val secret = json.optString("secret").trim()
        val code = json.optString("code").trim()
        if (!HOST.matches(host)) return 400 to error("Нужен адрес клуба (https://…)")
        if (secret.length < 16) return 400 to error("Нет секрета привязки")
        return listener.pair(host, secret, code)
    }

    private fun respond(client: Socket, status: Int, json: JSONObject?) {
        val body = json?.toString()?.toByteArray(Charsets.UTF_8) ?: ByteArray(0)
        val head = buildString {
            append("HTTP/1.1 ").append(status).append(' ').append(REASONS[status] ?: "OK").append("\r\n")
            append("Content-Type: application/json; charset=utf-8\r\n")
            append("Content-Length: ").append(body.size).append("\r\n")
            append("Access-Control-Allow-Origin: *\r\n")
            append("Access-Control-Allow-Headers: Content-Type\r\n")
            append("Connection: close\r\n\r\n")
        }
        client.getOutputStream().apply {
            write(head.toByteArray(Charsets.ISO_8859_1))
            write(body)
            flush()
        }
    }

    private fun readLine(input: InputStream): String? {
        val out = ByteArrayOutputStream()
        while (out.size() < MAX_LINE) {
            val b = input.read()
            if (b < 0) return if (out.size() == 0) null else out.toString(Charsets.ISO_8859_1.name())
            if (b == '\n'.code) return out.toString(Charsets.ISO_8859_1.name()).trimEnd('\r')
            out.write(b)
        }
        return null
    }

    companion object {
        const val PORT = 8788
        fun error(message: String): JSONObject = JSONObject().put("ok", false).put("error", message)

        private const val TAG = "TitanMenu"
        private const val READ_TIMEOUT_MS = 10_000
        private const val MAX_BODY = 4096
        private const val MAX_LINE = 4096
        private val HOST = Regex("^https?://[A-Za-z0-9.-]+(:\\d{1,5})?$")
        private val REASONS = mapOf(200 to "OK", 204 to "No Content", 400 to "Bad Request", 403 to "Forbidden", 404 to "Not Found", 409 to "Conflict", 413 to "Payload Too Large", 502 to "Bad Gateway")
    }
}
