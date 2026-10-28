package ru.titan.tv.hub

import org.json.JSONArray
import org.json.JSONObject

/** This TV paired to a screen in Titan HUB: the club's address, the TV's own token and the screen. */
data class HubPairing(val host: String, val token: String, val screenId: String, val screenName: String)

/** What Titan HUB staff can do to this TV from «Экраны». */
sealed interface HubCommand {
    /** Back to the home screen, closing the panels and whatever app the guest left open in front. */
    data object Home : HubCommand

    data object Screensaver : HubCommand

    /** After the guests: home screen, apps closed, the usual volume. */
    data object Reset : HubCommand

    /** A line from the staff over whatever is on the TV. */
    data class Message(val text: String, val seconds: Int) : HubCommand

    data class Volume(val percent: Int) : HubCommand

    data class Mute(val muted: Boolean) : HubCommand
}

/** One event from the HUB stream. */
sealed interface HubSignal {
    data class Command(val command: HubCommand) : HubSignal

    /** The ads changed in HUB; fetch them again now rather than at the next heartbeat. */
    data object ContentChanged : HubSignal
}

/** A QR code as rows of modules, `bits[y * size + x] == '1'` for a dark one. */
data class QrMatrix(val size: Int, val bits: String) {
    fun isDark(x: Int, y: Int): Boolean = bits[y * size + x] == '1'
}

/** One ad from the club's ad band: a picture, or a card with a title, a line and a QR. */
data class Ad(
    val imageUrl: String?,
    val title: String?,
    val body: String?,
    val qr: QrMatrix?,
    val durationSec: Int,
    val fillsFrame: Boolean,
) {
    val isImage: Boolean get() = imageUrl != null
}

data class AdsContent(val ads: List<Ad>, val version: String)

private const val MIN_AD_SEC = 3
private const val DEFAULT_AD_SEC = 10
private const val MAX_MESSAGE_SEC = 120
private const val MIN_MESSAGE_SEC = 5
private const val DEFAULT_MESSAGE_SEC = 20

fun pairingJson(pairing: HubPairing): String = JSONObject()
    .put("host", pairing.host)
    .put("token", pairing.token)
    .put("screenId", pairing.screenId)
    .put("screenName", pairing.screenName)
    .toString()

fun parsePairing(text: String): HubPairing? = runCatching {
    val json = JSONObject(text)
    HubPairing(json.getString("host"), json.getString("token"), json.getString("screenId"), json.optString("screenName"))
}.getOrNull()?.takeIf { it.host.isNotBlank() && it.token.isNotBlank() && it.screenId.isNotBlank() }

/** One `data:` line of the stream; null for pings, the greeting and anything this version does not know. */
fun parseSignal(data: String): HubSignal? {
    val json = runCatching { JSONObject(data) }.getOrNull() ?: return null
    return when (json.optString("type")) {
        "content" -> HubSignal.ContentChanged
        "command" -> json.optJSONObject("command")?.let(::parseCommand)?.let(HubSignal::Command)
        else -> null
    }
}

private fun parseCommand(json: JSONObject): HubCommand? = when (json.optString("action")) {
    "home" -> HubCommand.Home
    "screensaver" -> HubCommand.Screensaver
    "reset" -> HubCommand.Reset
    "message" -> json.optString("text").trim().takeIf { it.isNotEmpty() }?.let { text ->
        HubCommand.Message(text, json.optInt("seconds", DEFAULT_MESSAGE_SEC).coerceIn(MIN_MESSAGE_SEC, MAX_MESSAGE_SEC))
    }
    "volume" -> if (json.has("percent")) HubCommand.Volume(json.optInt("percent").coerceIn(0, 100)) else null
    "mute" -> if (json.has("muted")) HubCommand.Mute(json.optBoolean("muted")) else null
    else -> null
}

fun parseAds(text: String): AdsContent? = runCatching {
    val json = JSONObject(text)
    val list = json.optJSONArray("ads") ?: JSONArray()
    val ads = (0 until list.length()).mapNotNull { list.optJSONObject(it)?.let(::parseAd) }
    AdsContent(ads, json.optString("adsVersion"))
}.getOrNull()

private fun parseAd(json: JSONObject): Ad? {
    val image = json.optNullableString("imageUrl")?.takeIf { json.optString("kind") == "image" }
    val title = json.optNullableString("title")
    val body = json.optNullableString("body")
    val qr = json.optJSONObject("qr")?.let(::parseQr)
    if (image == null && title == null && body == null && qr == null) return null
    return Ad(
        imageUrl = image,
        title = title,
        body = body,
        qr = qr,
        durationSec = json.optInt("durationSec", DEFAULT_AD_SEC).coerceAtLeast(MIN_AD_SEC),
        fillsFrame = json.optString("fit") == "cover",
    )
}

private fun parseQr(json: JSONObject): QrMatrix? {
    val size = json.optInt("size")
    val bits = json.optString("bits")
    return QrMatrix(size, bits).takeIf { size > 0 && bits.length == size * size }
}

private fun JSONObject.optNullableString(key: String): String? =
    if (!has(key) || isNull(key)) null else optString(key).trim().takeIf { it.isNotEmpty() }
