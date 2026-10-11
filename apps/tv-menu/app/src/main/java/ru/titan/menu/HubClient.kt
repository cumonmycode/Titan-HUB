package ru.titan.menu

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Связь приставки с Titan HUB: обмен одноразового секрета привязки на токен и пульс
 * («я в сети» + узнать поворот и название экрана). Синхронно — звать не из UI-потока.
 */
object HubClient {
    data class Bound(val screenId: String, val name: String, val rotation: Int)

    sealed interface Beat {
        data class Ok(val bound: Bound) : Beat
        /** Экран удалили или отвязали в HUB — приставка возвращается к коду. */
        data object Unpaired : Beat
        /** Нет связи — показываем то, что уже на экране, и пробуем позже. */
        data object Offline : Beat
    }

    class ClaimFailed(message: String) : Exception(message)

    private const val TIMEOUT_MS = 10_000

    fun claim(host: String, secret: String, deviceId: String, model: String, appVersion: String): Pair<Bound, String> {
        val body = JSONObject()
            .put("secret", secret)
            .put("deviceId", deviceId)
            .put("model", model.take(100))
            .put("appVersion", appVersion)
        val (code, json) = post("$host/api/screens/device/claim", body, null)
        if (code != 200) throw ClaimFailed(json?.optString("error").takeUnless { it.isNullOrBlank() } ?: "Сервер ответил $code")
        val token = json?.optString("token").orEmpty()
        val bound = json?.let(::bound)
        if (token.isEmpty() || bound == null) throw ClaimFailed("Сервер не прислал токен")
        return bound to token
    }

    fun heartbeat(host: String, token: String, appVersion: String): Beat = try {
        val (code, json) = post("$host/api/screens/device/heartbeat", JSONObject().put("appVersion", appVersion), token)
        when {
            code == 200 -> json?.let(::bound)?.let { Beat.Ok(it) } ?: Beat.Offline
            code == 401 || code == 404 -> Beat.Unpaired
            else -> Beat.Offline
        }
    } catch (e: IOException) {
        Beat.Offline
    }

    private fun bound(json: JSONObject): Bound? {
        val id = json.optString("screenId")
        if (id.isBlank()) return null
        return Bound(id, json.optString("name"), json.optInt("rotation", 0))
    }

    private fun post(url: String, body: JSONObject, token: String?): Pair<Int, JSONObject?> {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = TIMEOUT_MS
            conn.readTimeout = TIMEOUT_MS
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            conn.setRequestProperty("Accept", "application/json")
            if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")
            conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            val json = runCatching { JSONObject(text) }.getOrNull()
            return code to json
        } finally {
            conn.disconnect()
        }
    }
}
