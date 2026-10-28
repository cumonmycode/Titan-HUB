package ru.titan.tv.airplay

import org.json.JSONObject
import java.io.DataInputStream
import java.io.IOException

/**
 * The link between the Steklo AirPlay add-on in Home Assistant and the TV. The TV opens a TCP connection,
 * sends one hello line naming its room, and the add-on answers with frames: one type byte, a big-endian
 * length and the payload. Audio is 44.1 kHz 16-bit stereo PCM, events are JSON, covers are JPEG or PNG.
 */
const val PROTOCOL_VERSION = 1
const val SERVICE_TYPE = "_steklo-airplay._tcp"

private const val TYPE_AUDIO = 1
private const val TYPE_EVENT = 2
private const val TYPE_COVER = 3
// The add-on sends 16 KB of audio at a time; anything far past these limits is a broken stream
private const val MAX_AUDIO_BYTES = 256 * 1024
private const val MAX_EVENT_BYTES = 64 * 1024
private const val MAX_COVER_BYTES = 8 * 1024 * 1024
private const val BYTES_PER_FRAME = 4
private const val MS_PER_SECOND = 1_000.0

sealed interface Frame {
    class Audio(val pcm: ByteArray) : Frame
    class Event(val json: JSONObject) : Frame
    /** An empty image means the track has no cover. */
    class Cover(val image: ByteArray) : Frame
    /** Keep-alives, unknown frame types and unreadable events. */
    data object Ping : Frame
}

fun helloLine(roomName: String): String =
    JSONObject().put("v", PROTOCOL_VERSION).put("name", roomName).toString() + "\n"

/** Buttons on the TV that the add-on passes on to the sending iPhone through its AirPlay remote control. */
enum class AirPlayCommand(val wire: String) {
    PREVIOUS("previous"),
    PLAY_PAUSE("playpause"),
    NEXT("next"),
}

/** After the hello line the TV may send these, one JSON line per button press. */
fun commandLine(command: AirPlayCommand): String = JSONObject().put("cmd", command.wire).toString() + "\n"

/** Tells the sender the TV's volume changed, from 0 to 1, so its slider follows the remote control. */
fun volumeLine(level: Double): String = JSONObject().put("cmd", "volume").put("level", level).toString() + "\n"

private fun maxBytes(type: Int): Int = when (type) {
    TYPE_AUDIO -> MAX_AUDIO_BYTES
    TYPE_COVER -> MAX_COVER_BYTES
    else -> MAX_EVENT_BYTES
}

fun readFrame(input: DataInputStream): Frame {
    val type = input.readUnsignedByte()
    val length = input.readInt()
    if (length !in 0..maxBytes(type)) throw IOException("AirPlay frame of type $type and $length bytes")
    val payload = ByteArray(length).also(input::readFully)
    return when (type) {
        // A torn stereo frame would swap left and right for the rest of the stream
        TYPE_AUDIO -> if (length % BYTES_PER_FRAME == 0) Frame.Audio(payload) else Frame.Ping
        TYPE_EVENT -> runCatching { JSONObject(String(payload, Charsets.UTF_8)) }.getOrNull()?.let(Frame::Event) ?: Frame.Ping
        TYPE_COVER -> Frame.Cover(payload)
        else -> Frame.Ping
    }
}

/** What an AirPlay sender is playing on this TV. */
data class NowPlaying(
    val title: String = "",
    val artist: String = "",
    val album: String = "",
    /** The sending device, such as "iPhone Кая". */
    val client: String = "",
    val isPlaying: Boolean = false,
    val positionSec: Double = 0.0,
    val durationSec: Double = 0.0,
    /** When [positionSec] was true, in elapsed-realtime milliseconds; the position runs on from there while playing. */
    val positionAtMs: Long = 0,
) {
    fun positionAt(nowMs: Long): Double {
        if (!isPlaying) return positionSec
        val position = positionSec + (nowMs - positionAtMs) / MS_PER_SECOND
        return if (durationSec > 0) position.coerceAtMost(durationSec) else position
    }
}

/** The sender's session is over: the player leaves the screen and the audio stops. */
fun isSessionEnd(event: JSONObject): Boolean = event.optString("type") == "state" && event.optString("state") == "stopped"

/** Applies one event from the add-on; null means nothing is playing. Events it does not know leave [state] alone. */
fun reduceNowPlaying(state: NowPlaying?, event: JSONObject, nowMs: Long): NowPlaying? = when (event.optString("type")) {
    "session" -> (state ?: NowPlaying()).copy(client = event.optString("client"))
    "track" -> NowPlaying(
        title = event.optString("title"),
        artist = event.optString("artist"),
        album = event.optString("album"),
        client = state?.client.orEmpty(),
        isPlaying = state?.isPlaying ?: false,
        positionAtMs = nowMs,
    )
    // A late position after the session ended must not bring an empty player back
    "progress" -> state?.copy(
        positionSec = event.optDouble("position", 0.0),
        durationSec = event.optDouble("duration", 0.0),
        positionAtMs = nowMs,
    )
    "state" -> when (event.optString("state")) {
        "stopped" -> null
        // Freezing the position here makes a resumed track continue from where it paused
        else -> (state ?: NowPlaying()).let { current ->
            current.copy(isPlaying = event.optString("state") == "playing", positionSec = current.positionAt(nowMs), positionAtMs = nowMs)
        }
    }
    else -> state
}
