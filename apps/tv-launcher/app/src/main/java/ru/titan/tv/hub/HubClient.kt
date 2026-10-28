package ru.titan.tv.hub

import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Titan HUB's screen API as this TV sees it. Every call blocks; run it off the main thread.
 * A 401 means the screen was deleted or unpaired in HUB, so the TV goes back to waiting for a phone.
 */
class HubClient(base: OkHttpClient) {
    sealed interface Beat {
        data class Ok(val screenName: String, val adsVersion: String) : Beat

        data object Unpaired : Beat

        data object Offline : Beat
    }

    class ClaimFailed(message: String) : Exception(message)

    class UnpairedException : IOException("The TV was unpaired in HUB")

    private val http = base.newBuilder()
        .connectTimeout(TIMEOUT_S, TimeUnit.SECONDS)
        .readTimeout(TIMEOUT_S, TimeUnit.SECONDS)
        .build()

    // HUB pings the stream every 25 s; a minute of silence means the connection is gone
    private val streaming = http.newBuilder().readTimeout(STREAM_SILENCE_S, TimeUnit.SECONDS).build()

    /** Trades the one-time secret a phone brought for this TV's own token. */
    fun claim(host: String, secret: String, deviceId: String, model: String, appVersion: String): HubPairing {
        val body = JSONObject()
            .put("secret", secret)
            .put("deviceId", deviceId)
            .put("model", model.take(MAX_MODEL))
            .put("appVersion", appVersion)
            .put("app", APP)
        val (code, json) = try {
            post("$host/api/screens/device/claim", body, null)
        } catch (e: IOException) {
            throw ClaimFailed("Нет связи с клубом: ${e.message}")
        }
        if (code != HTTP_OK) throw ClaimFailed(json?.optString("error").takeUnless { it.isNullOrBlank() } ?: "Сервер ответил $code")
        val token = json?.optString("token").orEmpty()
        val screenId = json?.optString("screenId").orEmpty()
        if (token.isEmpty() || screenId.isEmpty()) throw ClaimFailed("Сервер не прислал токен")
        return HubPairing(host, token, screenId, json?.optString("name").orEmpty())
    }

    fun heartbeat(pairing: HubPairing, appVersion: String, state: JSONObject): Beat = try {
        val body = JSONObject().put("appVersion", appVersion).put("app", APP).put("state", state)
        val (code, json) = post("${pairing.host}/api/screens/device/heartbeat", body, pairing.token)
        when {
            code == HTTP_OK && json != null -> Beat.Ok(json.optString("name"), json.optString("adsVersion"))
            code == HTTP_UNAUTHORIZED -> Beat.Unpaired
            else -> Beat.Offline
        }
    } catch (e: IOException) {
        Beat.Offline
    }

    /** The ads for this TV as HUB sent them (kept as is for offline starts); throws [UnpairedException] when HUB no longer knows it. */
    fun content(pairing: HubPairing): String? {
        val request = Request.Builder()
            .url("${pairing.host}/api/screens/device/content")
            .header("Authorization", "Bearer ${pairing.token}")
            .build()
        http.newCall(request).execute().use { response ->
            if (response.code == HTTP_UNAUTHORIZED) throw UnpairedException()
            if (!response.isSuccessful) return null
            return response.body?.string()
        }
    }

    /**
     * Listens to the remote control until the connection drops; throws [UnpairedException] on 401.
     * [onOpen] gets the call, so the TV can hang up when it is unpaired instead of waiting for a drop.
     */
    fun listen(pairing: HubPairing, onOpen: (Call) -> Unit, onSignal: (HubSignal) -> Unit) {
        val request = Request.Builder()
            .url("${pairing.host}/api/screens/device/stream")
            .header("Authorization", "Bearer ${pairing.token}")
            .header("Accept", "text/event-stream")
            .build()
        val call = streaming.newCall(request).also(onOpen)
        call.execute().use { response ->
            if (response.code == HTTP_UNAUTHORIZED) throw UnpairedException()
            if (!response.isSuccessful) throw IOException("Stream answered ${response.code}")
            val source = response.body?.source() ?: return
            while (true) {
                val line = source.readUtf8Line() ?: return
                if (line.startsWith(DATA)) parseSignal(line.substring(DATA.length).trim())?.let(onSignal)
            }
        }
    }

    private fun post(url: String, body: JSONObject, token: String?): Pair<Int, JSONObject?> {
        val request = Request.Builder()
            .url(url)
            .post(body.toString().toRequestBody(JSON))
            .apply { if (token != null) header("Authorization", "Bearer $token") }
            .build()
        http.newCall(request).execute().use { response ->
            val json = runCatching { JSONObject(response.body?.string().orEmpty()) }.getOrNull()
            return response.code to json
        }
    }

    private companion object {
        const val APP = "launcher"
        const val DATA = "data:"
        const val TIMEOUT_S = 10L
        const val STREAM_SILENCE_S = 60L
        const val MAX_MODEL = 100
        const val HTTP_OK = 200
        const val HTTP_UNAUTHORIZED = 401
        val JSON = "application/json; charset=utf-8".toMediaType()
    }
}
