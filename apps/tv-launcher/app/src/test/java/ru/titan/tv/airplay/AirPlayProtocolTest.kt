package ru.titan.tv.airplay

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.IOException

class AirPlayProtocolTest {

    private fun frames(vararg frames: Pair<Int, ByteArray>): DataInputStream {
        val bytes = ByteArrayOutputStream()
        DataOutputStream(bytes).use { out ->
            frames.forEach { (type, payload) ->
                out.writeByte(type)
                out.writeInt(payload.size)
                out.write(payload)
            }
        }
        return DataInputStream(ByteArrayInputStream(bytes.toByteArray()))
    }

    @Test
    fun `audio, event and cover frames are read in order`() {
        val pcm = byteArrayOf(1, 0, 2, 0)
        val event = """{"type":"state","state":"playing"}""".toByteArray()
        val cover = byteArrayOf(0xFF.toByte(), 0xD8.toByte())
        val input = frames(1 to pcm, 2 to event, 3 to cover)

        assertArrayEquals(pcm, (readFrame(input) as Frame.Audio).pcm)
        assertEquals("playing", (readFrame(input) as Frame.Event).json.getString("state"))
        assertArrayEquals(cover, (readFrame(input) as Frame.Cover).image)
    }

    @Test
    fun `an empty cover frame means the track has no cover`() {
        val frame = readFrame(frames(3 to ByteArray(0)))

        assertEquals(0, (frame as Frame.Cover).image.size)
    }

    @Test(expected = IOException::class)
    fun `an absurdly large frame is refused instead of allocated`() {
        val bytes = ByteArrayOutputStream()
        DataOutputStream(bytes).use { it.writeByte(1); it.writeInt(512 * 1024 * 1024) }
        readFrame(DataInputStream(ByteArrayInputStream(bytes.toByteArray())))
    }

    @Test
    fun `unknown frame types are skipped as keep-alives`() {
        val frame = readFrame(frames(9 to byteArrayOf(1, 2, 3)))

        assertEquals(Frame.Ping, frame)
    }

    @Test
    fun `the hello line names the room and the protocol version`() {
        val hello = JSONObject(helloLine("Кухня").trimEnd('\n'))

        assertEquals("Кухня", hello.getString("name"))
        assertEquals(PROTOCOL_VERSION, hello.getInt("v"))
        assertTrue(helloLine("Кухня").endsWith("\n"))
    }

    @Test
    fun `remote buttons become one command line each`() {
        assertEquals("""{"cmd":"playpause"}""" + "\n", commandLine(AirPlayCommand.PLAY_PAUSE))
        assertEquals("next", JSONObject(commandLine(AirPlayCommand.NEXT)).getString("cmd"))
        assertEquals("previous", JSONObject(commandLine(AirPlayCommand.PREVIOUS)).getString("cmd"))
    }

    @Test
    fun `a new track replaces the old one from zero and keeps playing`() {
        val before = NowPlaying(title = "Old", artist = "A", positionSec = 80.0, durationSec = 200.0, isPlaying = true)

        val after = reduceNowPlaying(before, JSONObject("""{"type":"track","title":"Новая","artist":"Б","album":"В"}"""), nowMs = 1_000)

        assertEquals(NowPlaying(title = "Новая", artist = "Б", album = "В", isPlaying = true, positionAtMs = 1_000), after)
    }

    @Test
    fun `progress and play state update the current track`() {
        val playing = reduceNowPlaying(NowPlaying(title = "T"), JSONObject("""{"type":"state","state":"playing"}"""), nowMs = 5)
        val moved = reduceNowPlaying(playing, JSONObject("""{"type":"progress","position":12.5,"duration":215}"""), nowMs = 2_000)
        val paused = reduceNowPlaying(moved, JSONObject("""{"type":"state","state":"paused"}"""), nowMs = 3_000)

        assertTrue(playing!!.isPlaying)
        assertEquals(12.5, moved!!.positionSec, 0.001)
        assertEquals(215.0, moved.durationSec, 0.001)
        assertEquals(2_000L, moved.positionAtMs)
        assertFalse(paused!!.isPlaying)
    }

    @Test
    fun `stopping clears what is playing`() {
        val stopped = JSONObject("""{"type":"state","state":"stopped"}""")

        assertTrue(isSessionEnd(stopped))
        assertNull(reduceNowPlaying(NowPlaying(title = "T"), stopped, nowMs = 0))
    }

    @Test
    fun `events the TV does not know leave the player as it is`() {
        val volume = JSONObject("""{"type":"volume","level":0.4}""")
        val track = NowPlaying(title = "T")

        assertFalse(isSessionEnd(volume))
        assertFalse(isSessionEnd(JSONObject("""{"type":"state","state":"paused"}""")))
        assertEquals(track, reduceNowPlaying(track, volume, nowMs = 0))
        assertNull(reduceNowPlaying(null, volume, nowMs = 0))
    }

    @Test
    fun `a late position after the session ended does not bring the player back`() {
        assertNull(reduceNowPlaying(null, JSONObject("""{"type":"progress","position":3,"duration":200}"""), nowMs = 0))
    }

    @Test(expected = IOException::class)
    fun `an audio frame far bigger than the add-on sends is refused`() {
        val bytes = ByteArrayOutputStream()
        DataOutputStream(bytes).use { it.writeByte(1); it.writeInt(1024 * 1024) }
        readFrame(DataInputStream(ByteArrayInputStream(bytes.toByteArray())))
    }

    @Test
    fun `a torn stereo frame is dropped so left and right stay in place`() {
        assertEquals(Frame.Ping, readFrame(frames(1 to byteArrayOf(1, 0, 2))))
    }

    @Test
    fun `a TV volume change becomes one command line`() {
        val line = volumeLine(0.25)

        assertEquals("volume", JSONObject(line).getString("cmd"))
        assertEquals(0.25, JSONObject(line).getDouble("level"), 0.0001)
        assertTrue(line.endsWith("\n"))
    }

    @Test
    fun `the client name is kept across tracks`() {
        val session = reduceNowPlaying(null, JSONObject("""{"type":"session","client":"iPhone Кая"}"""), nowMs = 0)
        val track = reduceNowPlaying(session, JSONObject("""{"type":"track","title":"T"}"""), nowMs = 0)

        assertEquals("iPhone Кая", track!!.client)
    }

    @Test
    fun `position runs on while playing and holds while paused`() {
        val playing = NowPlaying(title = "T", isPlaying = true, positionSec = 10.0, durationSec = 100.0, positionAtMs = 1_000)

        assertEquals(15.0, playing.positionAt(6_000), 0.001)
        assertEquals(100.0, playing.positionAt(1_000_000), 0.001)
        assertEquals(10.0, playing.copy(isPlaying = false).positionAt(6_000), 0.001)
    }
}
