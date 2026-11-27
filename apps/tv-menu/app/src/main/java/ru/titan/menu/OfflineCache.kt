package ru.titan.menu

import android.content.Context
import android.net.Uri
import android.util.Log
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicInteger

/**
 * Экран работает и без интернета: приставка сама отвечает на запросы страницы.
 *  • Страница и данные экрана (/api/…) — сначала сеть с коротким таймаутом, удачный ответ
 *    сохраняется на диск; нет сети или сервер перезапускается — отдаём сохранённое.
 *  • Картинки, шрифты, прочее — сразу с диска; нет на диске — из сети и сохраняем.
 *  • Пришли свежие данные экрана — заранее докачиваем все картинки слайдов, чтобы
 *    без интернета показывались и те, до которых очередь ещё не дошла.
 * Ключ — адрес без служебных параметров (t, ping): страница добавляет их от кэша браузера.
 *
 * Каждый сетевой запрос ограничен по общему времени ([FRESH_DEADLINE_MS], [STATIC_DEADLINE_MS]):
 * таймауты HttpURLConnection не покрывают поиск адреса (DNS), и при плохой сети запросы
 * висели минутами, занимая потоки WebView, — страница переставала получать что-либо
 * и «зависала» до перезапуска. Теперь по истечении срока отдаём сохранённое, а запрос
 * доделывается в фоне и обновляет кэш.
 */
class OfflineCache(context: Context, private val userAgent: String) {
    private val dir = File(context.filesDir, "screen-cache").apply { mkdirs() }
    private val prefetcher = Executors.newSingleThreadExecutor()
    /** Ждёт опоздавшие ответы, чтобы сохранить их в кэш. */
    private val lateResults = Executors.newSingleThreadExecutor()
    /** Сетевые запросы — в своих потоках: зависший запрос не держит поток WebView. */
    private val network = ThreadPoolExecutor(NET_THREADS, NET_THREADS, 30, TimeUnit.SECONDS, ArrayBlockingQueue(NET_QUEUE)).apply {
        allowCoreThreadTimeOut(true)
    }
    private val writes = AtomicInteger()

    fun intercept(request: WebResourceRequest): WebResourceResponse? {
        if (request.method != "GET") return null
        val url = request.url
        if (url.scheme != "http" && url.scheme != "https") return null
        val fresh = request.isForMainFrame || url.path.orEmpty().startsWith("/api/")
        return try {
            if (fresh) networkFirst(url, request.requestHeaders) else cacheFirst(url, request.requestHeaders)
        } catch (e: Exception) {
            Log.w(TAG, "Кэш экрана: ${url.host}${url.path}", e)
            null
        }
    }

    private class Entry(val status: Int, val contentType: String, val body: ByteArray)

    private fun networkFirst(url: Uri, headers: Map<String, String>): WebResourceResponse? {
        val key = keyOf(url)
        val net = fetchWithin(url, headers, FRESH_TIMEOUT_MS, FRESH_DEADLINE_MS) { store(key, it) }
        if (net != null && net.status in 200..299) {
            store(key, net)
            if (url.path.orEmpty().endsWith("/public")) prefetchImages(net.body)
            return respond(net)
        }
        // Сервер ответил 404 (экран удалили) — так и показываем; сбой сети или 5xx — сохранённое.
        if (net != null && net.status in 400..499) return respond(net)
        return load(key)?.let(::respond) ?: net?.let(::respond)
    }

    private fun cacheFirst(url: Uri, headers: Map<String, String>): WebResourceResponse? {
        val key = keyOf(url)
        load(key)?.let { return respond(it) }
        val net = fetchWithin(url, headers, STATIC_TIMEOUT_MS, STATIC_DEADLINE_MS) { store(key, it) } ?: return null
        if (net.status in 200..299) store(key, net)
        return respond(net)
    }

    /**
     * Запрос не дольше [deadlineMs]. Не успел — null (страница получит сохранённое), а
     * удачный поздний ответ всё равно попадёт в кэш через [lateStore].
     */
    private fun fetchWithin(url: Uri, headers: Map<String, String>, timeoutMs: Int, deadlineMs: Long, lateStore: (Entry) -> Unit): Entry? {
        val task = try {
            network.submit(Callable { fetch(url, headers, timeoutMs) })
        } catch (e: RejectedExecutionException) {
            Log.w(TAG, "Сеть перегружена, отдаём сохранённое: ${url.path}")
            return null
        }
        return try {
            task.get(deadlineMs, TimeUnit.MILLISECONDS)
        } catch (e: TimeoutException) {
            Log.w(TAG, "Сеть не ответила за ${deadlineMs / 1000} с: ${url.host}${url.path}")
            lateResults.execute { runCatching { task.get() }.getOrNull()?.takeIf { it.status in 200..299 }?.let(lateStore) }
            null
        } catch (e: ExecutionException) {
            null
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            null
        }
    }

    private fun prefetchImages(json: ByteArray) {
        val slides = runCatching { JSONObject(String(json, Charsets.UTF_8)).optJSONArray("slides") }.getOrNull() ?: return
        for (i in 0 until slides.length()) {
            val image = slides.optJSONObject(i)?.optString("imageUrl").orEmpty()
            if (!image.startsWith("http")) continue
            val uri = Uri.parse(image)
            if (bodyFile(keyOf(uri)).exists()) continue
            prefetcher.execute {
                runCatching { fetch(uri, emptyMap(), STATIC_TIMEOUT_MS) }
                    .onSuccess { if (it.status in 200..299) store(keyOf(uri), it) }
            }
        }
    }

    private fun fetch(url: Uri, headers: Map<String, String>, timeoutMs: Int): Entry {
        val conn = URL(url.toString()).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = timeoutMs
            conn.readTimeout = timeoutMs * 3
            conn.instanceFollowRedirects = true
            headers.forEach { (name, value) -> if (!name.equals("Range", ignoreCase = true)) conn.setRequestProperty(name, value) }
            conn.setRequestProperty("User-Agent", userAgent)
            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val body = stream?.use { it.readBytes() } ?: ByteArray(0)
            return Entry(status, conn.contentType ?: "application/octet-stream", body)
        } finally {
            conn.disconnect()
        }
    }

    private fun store(key: String, entry: Entry) {
        val body = bodyFile(key)
        val tmp = File(dir, "$key.tmp")
        tmp.writeBytes(entry.body)
        tmp.renameTo(body)
        File(dir, "$key.meta").writeText(JSONObject().put("status", entry.status).put("contentType", entry.contentType).toString())
        if (writes.incrementAndGet() % TRIM_EVERY == 0) trim()
    }

    private fun load(key: String): Entry? {
        val body = bodyFile(key)
        val meta = File(dir, "$key.meta")
        if (!body.exists() || !meta.exists()) return null
        val info = runCatching { JSONObject(meta.readText()) }.getOrNull() ?: return null
        body.setLastModified(System.currentTimeMillis()) // свежие по использованию — дольше живут
        return Entry(info.optInt("status", 200), info.optString("contentType", "application/octet-stream"), body.readBytes())
    }

    private fun respond(entry: Entry): WebResourceResponse {
        val parts = entry.contentType.split(';').map { it.trim() }
        val mime = parts.firstOrNull().orEmpty().ifEmpty { "application/octet-stream" }
        val charset = parts.firstOrNull { it.startsWith("charset=", ignoreCase = true) }?.substringAfter('=')
        val headers = mapOf("Access-Control-Allow-Origin" to "*", "Cache-Control" to "no-store")
        val reason = if (entry.status in 200..299) "OK" else "Error"
        return WebResourceResponse(mime, charset, entry.status, reason, headers, ByteArrayInputStream(entry.body))
    }

    /** Больше 200 МБ — удаляем давно не использованное до 150 МБ. */
    private fun trim() {
        val bodies = dir.listFiles { f -> f.name.endsWith(".body") }?.toMutableList() ?: return
        var total = bodies.sumOf { it.length() }
        if (total < MAX_BYTES) return
        bodies.sortBy { it.lastModified() }
        for (file in bodies) {
            if (total < TRIM_TO_BYTES) break
            total -= file.length()
            file.delete()
            File(dir, file.name.removeSuffix(".body") + ".meta").delete()
        }
    }

    private fun bodyFile(key: String) = File(dir, "$key.body")

    private fun keyOf(url: Uri): String {
        val builder = url.buildUpon().clearQuery()
        url.queryParameterNames.filter { it !in VOLATILE }.sorted().forEach { name ->
            url.getQueryParameters(name).forEach { builder.appendQueryParameter(name, it) }
        }
        val digest = MessageDigest.getInstance("SHA-1").digest(builder.build().toString().toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    private companion object {
        const val TAG = "TitanMenu"
        const val FRESH_TIMEOUT_MS = 5_000
        const val STATIC_TIMEOUT_MS = 10_000
        const val FRESH_DEADLINE_MS = 8_000L
        const val STATIC_DEADLINE_MS = 20_000L
        const val NET_THREADS = 4
        const val NET_QUEUE = 24
        const val TRIM_EVERY = 20
        const val MAX_BYTES = 200L * 1024 * 1024
        const val TRIM_TO_BYTES = 150L * 1024 * 1024
        val VOLATILE = setOf("t", "ping")
    }
}
