package ru.titan.tv.airplay

import org.junit.Assert.assertEquals
import org.junit.Test

class VolumeTest {

    @Test
    fun `the sender level becomes the matching TV volume index`() {
        assertEquals(0, volumeIndex(0.0, maxIndex = 15))
        assertEquals(8, volumeIndex(0.5, maxIndex = 15))
        assertEquals(15, volumeIndex(1.0, maxIndex = 15))
        assertEquals(60, volumeIndex(0.6, maxIndex = 100))
    }

    @Test
    fun `levels outside zero to one are held at the ends`() {
        assertEquals(0, volumeIndex(-0.2, maxIndex = 15))
        assertEquals(15, volumeIndex(1.3, maxIndex = 15))
    }

    @Test
    fun `one press of the phone's volume button is one step of the TV`() {
        val press = 1.0 / SENDER_VOLUME_STEPS

        assertEquals(1, volumeSteps(0.5, 0.5 + press))
        assertEquals(-1, volumeSteps(0.5, 0.5 - press))
        assertEquals(0, volumeSteps(0.5, 0.5 + press / 3))
    }

    @Test
    fun `a volume report right after the phone set the volume is its echo, not the remote`() {
        assertEquals(true, isEcho(nowMs = 10_500, changedAtMs = 10_000))
        assertEquals(false, isEcho(nowMs = 10_000 + ECHO_QUIET_MS, changedAtMs = 10_000))
        assertEquals(false, isEcho(nowMs = 500, changedAtMs = 0))
    }

    @Test
    fun `a big jump on the phone is capped so the TV is not flooded with steps`() {
        assertEquals(MAX_STEPS_PER_CHANGE, volumeSteps(0.0, 1.0))
        assertEquals(-MAX_STEPS_PER_CHANGE, volumeSteps(1.0, 0.0))
    }
}
