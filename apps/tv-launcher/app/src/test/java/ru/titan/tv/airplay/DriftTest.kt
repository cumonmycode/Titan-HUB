package ru.titan.tv.airplay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

private const val MS = 1_000_000L

class DriftTest {

    @Test
    fun `audio far behind time is dropped from the head of the chunk`() {
        assertEquals(nsToFrames(100 * MS).toInt(), jump(errorNs = 100 * MS, chunkFrames = 8_192))
    }

    @Test
    fun `a chunk is dropped at most whole`() {
        assertEquals(1_024, jump(errorNs = 900 * MS, chunkFrames = 1_024))
    }

    @Test
    fun `audio far ahead of time waits behind silence, never more than half a second`() {
        assertEquals(-nsToFrames(80 * MS).toInt(), jump(errorNs = -80 * MS, chunkFrames = 4_096))
        assertEquals(-MAX_PAD_FRAMES, jump(errorNs = -5_000 * MS, chunkFrames = 4_096))
    }

    @Test
    fun `small errors are worked off by playing a touch faster or slower instead of jumping`() {
        assertEquals(0, jump(errorNs = 20 * MS, chunkFrames = 4_096))
        assertEquals(18, stretch(errorNs = 2 * MS, chunkFrames = 4_096))
        assertEquals(0, stretch(errorNs = MS / 2, chunkFrames = 4_096))
    }

    @Test
    fun `the speed never changes by more than half a percent`() {
        assertEquals(20, stretch(errorNs = 20 * MS, chunkFrames = 4_096))
        assertEquals(-20, stretch(errorNs = -20 * MS, chunkFrames = 4_096))
        assertEquals(1, stretch(errorNs = 20 * MS, chunkFrames = 64))
    }

    @Test
    fun `a stretched chunk keeps its ends and fills between them smoothly`() {
        val left = shortArrayOf(0, 100, 200, 300)
        val right = shortArrayOf(0, -100, -200, -300)

        val out = samples(resample(pcm(left, right), frames = 7))

        assertEquals(listOf<Short>(0, 50, 100, 150, 200, 250, 300), out.filterIndexed { i, _ -> i % 2 == 0 })
        assertEquals(listOf<Short>(0, -50, -100, -150, -200, -250, -300), out.filterIndexed { i, _ -> i % 2 == 1 })
    }

    @Test
    fun `a chunk at its own length is left as it is`() {
        val original = pcm(shortArrayOf(1, 2), shortArrayOf(3, 4))

        assertSame(original, resample(original, frames = 2))
    }

    private fun pcm(left: ShortArray, right: ShortArray): ByteArray {
        val buffer = ByteBuffer.allocate(left.size * 4).order(ByteOrder.LITTLE_ENDIAN)
        left.indices.forEach { buffer.putShort(left[it]).putShort(right[it]) }
        return buffer.array()
    }

    private fun samples(pcm: ByteArray): List<Short> {
        val shorts = ByteBuffer.wrap(pcm).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
        return List(shorts.remaining()) { shorts.get(it) }
    }
}

class StreamClockTest {
    private val chunk = 1_024L

    @Test
    fun `the earliest arrival sets the stream start and later Wi-Fi delays do not move it`() {
        val clock = StreamClock()

        assertEquals(1_000 * MS, clock.add(arrivalNs = 1_000 * MS, firstFrame = 0))
        // The next chunk is 30 ms late on the air; the start stays where the prompt chunks put it
        assertEquals(1_000 * MS, clock.add(arrivalNs = 1_000 * MS + framesToNs(chunk) + 30 * MS, firstFrame = chunk))
    }

    @Test
    fun `an earlier arrival than seen so far moves the start back`() {
        val clock = StreamClock()
        clock.add(arrivalNs = 1_010 * MS, firstFrame = 0)

        assertEquals(1_000 * MS, clock.add(arrivalNs = 1_000 * MS + framesToNs(chunk), firstFrame = chunk))
    }

    @Test
    fun `a sender that stays late starts a new timeline, a short stall does not`() {
        val clock = StreamClock()
        clock.add(arrivalNs = 0, firstFrame = 0)
        val late = 200 * MS

        // Late, but not for long enough yet
        assertEquals(0L, clock.add(arrivalNs = framesToNs(chunk) + late, firstFrame = chunk))
        // Still late well past the hold: the sender really paused or skipped
        val frame = chunk * 40
        val arrival = framesToNs(frame) + late

        assertEquals(arrival - framesToNs(frame), clock.add(arrivalNs = arrival, firstFrame = frame))
    }

    @Test
    fun `old arrivals leave the window so the start follows a drifting clock`() {
        val clock = StreamClock()
        clock.add(arrivalNs = 0, firstFrame = 0)
        val frame = nsToFrames(CLOCK_WINDOW_NS + 1_000 * MS)
        // The TV clock ran 5 ms ahead of the stream over that time: within the gap limit, so not a new timeline
        val arrival = framesToNs(frame) + 5 * MS

        assertEquals(5 * MS, clock.add(arrivalNs = arrival, firstFrame = frame))
    }
}
