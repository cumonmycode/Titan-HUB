package ru.titan.tv.config

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** The home row: video, streams, music and TV channels; the cinemas live behind their own tile. */
val DEFAULT_PINNED_APPS: List<String> = listOf(
    "com.spotify.tv.android",
)

/** Every video app — cinemas, video hosting, streams and TV channels — together under «Фильмы и сериалы». */
val DEFAULT_CINEMA_APPS: List<String> = listOf(
    "com.google.android.youtube.tv",
    "ru.kinopoisk.tv",
    "ru.rt.video.app.tv",
    "com.vk.tv",
    "rtb.mobile.android",
    "tv.twitch.android.app",
    "ar.tvplayer.tv",
    "top.rootu.lampa",
)

private val LIGHT_DOMAINS = listOf("light.", "switch.")
private val LIGHT_ICONS = setOf("ceiling", "floor", "strip", "sconce", "bulb")
private val SCENE_ICONS = setOf("film", "sunset", "sun", "moon", "bulb")
private const val FALLBACK_ICON = "bulb"
private const val DEFAULT_ROOM_NAME = "Кабинка"
private const val DEFAULT_CLIMATE_NAME = "Кондиционер"
private val LOCAL_SUFFIXES = listOf(".local", ".lan", ".home.arpa", ".internal")

data class TitanConfig(
    val homeAssistant: HaConfig?,
    val room: RoomConfig?,
    val weather: WeatherConfig?,
    val pinnedApps: List<String>,
    val cinemaApps: List<String>,
)

data class HaConfig(val baseUrl: String, val token: String) {
    val websocketUrl: String
        get() = when {
            baseUrl.startsWith("https://") -> "wss://" + baseUrl.removePrefix("https://")
            else -> "ws://" + baseUrl.removePrefix("http://")
        } + "/api/websocket"

    // Keeps the token out of logs and crash reports
    override fun toString(): String = "HaConfig(baseUrl=$baseUrl, token=***)"
}

data class RoomConfig(
    val name: String,
    val lights: List<LightConfig>,
    val scenes: List<SceneConfig>,
    val climate: ClimateConfig?,
    val temperatureEntity: String?,
    val humidityEntity: String?,
    val tvPower: ServiceCall?,
    /** What «Позвать администратора» runs in Home Assistant, e.g. a script that announces the call. */
    val callStaff: ServiceCall?,
)

/** A light or an on/off switch that drives one. */
data class LightConfig(val entityId: String, val name: String, val icon: String)

data class SceneConfig(val entityId: String, val name: String, val icon: String)

data class ClimateConfig(val entityId: String, val name: String)

data class WeatherConfig(val entityId: String)

data class ServiceCall(val domain: String, val service: String, val entityId: String?)

class ConfigException(message: String) : IllegalArgumentException(message)

/** Parses and validates config.json. Every failure message names the field to fix. */
fun parseConfig(json: String): Result<TitanConfig> = runCatching {
    // The parser's own message quotes the input, token included, so it is not shown
    val root = try {
        JSONObject(json)
    } catch (_: JSONException) {
        fail("не удалось прочитать JSON — проверьте скобки, кавычки и запятые")
    }
    TitanConfig(
        homeAssistant = root.optJSONObject("homeAssistant")?.let(::parseHomeAssistant),
        room = root.optJSONObject("room")?.let(::parseRoom),
        weather = root.optJSONObject("weather")?.let(::parseWeather),
        pinnedApps = root.optJSONArray("pinnedApps")?.strings() ?: DEFAULT_PINNED_APPS,
        cinemaApps = root.optJSONArray("cinemaApps")?.strings() ?: DEFAULT_CINEMA_APPS,
    )
}

private fun fail(message: String): Nothing = throw ConfigException("config.json: $message")

private fun parseHomeAssistant(obj: JSONObject): HaConfig {
    val url = obj.text("url").trimEnd('/')
    val parsed = url.toHttpUrlOrNull()
    if (parsed == null || (!url.startsWith("http://") && !url.startsWith("https://"))) {
        fail("homeAssistant.url должен быть адресом вида http://192.168.1.10:8123")
    }
    if (!parsed.isHttps && !isLocalHost(parsed.host)) {
        fail("homeAssistant.url: для адреса в интернете нужен https://, иначе токен уйдёт открытым текстом")
    }
    val token = obj.text("token")
    if (token.isEmpty()) fail("homeAssistant.token пустой — создайте долгосрочный токен в профиле Home Assistant")
    return HaConfig(url, token)
}

private fun parseRoom(obj: JSONObject): RoomConfig = RoomConfig(
    name = obj.text("name").ifEmpty { DEFAULT_ROOM_NAME },
    lights = obj.optJSONArray("lights").objects().map(::parseLight),
    scenes = obj.optJSONArray("scenes").objects().map(::parseScene),
    climate = obj.optJSONObject("climate")?.let(::parseClimate),
    temperatureEntity = obj.text("temperature").ifEmpty { null },
    humidityEntity = obj.text("humidity").ifEmpty { null },
    tvPower = obj.optJSONObject("tvPower")?.let { parseServiceCall(it, "room.tvPower") },
    callStaff = obj.optJSONObject("callStaff")?.let { parseServiceCall(it, "room.callStaff") },
)

private fun parseLight(obj: JSONObject): LightConfig {
    val entity = obj.text("entity")
    if (LIGHT_DOMAINS.none { entity.startsWith(it) }) {
        fail("room.lights: «$entity» должен быть сущностью light.* или switch.*")
    }
    return LightConfig(
        entityId = entity,
        name = obj.text("name").ifEmpty { entity },
        icon = obj.text("icon").takeIf { it in LIGHT_ICONS } ?: FALLBACK_ICON,
    )
}

private fun parseScene(obj: JSONObject): SceneConfig {
    val entity = obj.text("entity")
    if (!entity.startsWith("scene.") && !entity.startsWith("script.")) {
        fail("room.scenes: «$entity» должен быть сущностью scene.* или script.*")
    }
    return SceneConfig(
        entityId = entity,
        name = obj.text("name").ifEmpty { entity },
        icon = obj.text("icon").takeIf { it in SCENE_ICONS } ?: FALLBACK_ICON,
    )
}

private fun parseClimate(obj: JSONObject): ClimateConfig {
    val entity = obj.text("entity")
    if (!entity.startsWith("climate.")) fail("room.climate: «$entity» должен быть сущностью climate.*")
    return ClimateConfig(entityId = entity, name = obj.text("name").ifEmpty { DEFAULT_CLIMATE_NAME })
}

private fun parseServiceCall(obj: JSONObject, field: String): ServiceCall {
    val parts = obj.text("service").split(".")
    if (parts.size != 2 || parts.any { it.isBlank() }) {
        fail("$field.service должен иметь вид домен.сервис, например script.turn_on")
    }
    return ServiceCall(domain = parts[0], service = parts[1], entityId = obj.text("entity").ifEmpty { null })
}

private fun parseWeather(obj: JSONObject): WeatherConfig {
    val entity = obj.text("entity")
    if (!entity.startsWith("weather.")) fail("weather.entity должен быть сущностью weather.*")
    return WeatherConfig(entityId = entity)
}

/** Private IPv4 ranges and local names; plain HTTP is only acceptable there. */
private fun isLocalHost(host: String): Boolean {
    if (host == "localhost" || LOCAL_SUFFIXES.any { host.endsWith(it) }) return true
    val octets = host.split(".").mapNotNull { it.toIntOrNull() }.takeIf { it.size == 4 } ?: return false
    val (a, b) = octets
    return a == 10 || a == 127 || (a == 192 && b == 168) || (a == 172 && b in 16..31) || (a == 169 && b == 254)
}

/** Missing keys and JSON null both read as an empty string. */
private fun JSONObject.text(key: String): String = if (isNull(key)) "" else optString(key).trim()

private fun JSONArray?.objects(): List<JSONObject> =
    if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }

private fun JSONArray.strings(): List<String> =
    (0 until length()).mapNotNull { index -> optString(index).trim().takeIf { it.isNotEmpty() } }
