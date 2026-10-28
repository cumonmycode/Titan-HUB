package ru.titan.tv.home

import org.junit.Assert.assertEquals
import org.junit.Test

class WifiWatchTest {

    @Test
    fun `retries start at ten seconds and double up to a minute`() {
        assertEquals(listOf(10_000L, 20_000L, 40_000L, 60_000L, 60_000L), (0..4).map(::retryDelayMs))
    }

    @Test
    fun `a very long outage keeps retrying once a minute`() {
        assertEquals(60_000L, retryDelayMs(1_000))
    }
}
