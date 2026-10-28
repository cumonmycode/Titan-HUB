package ru.titan.tv.ui.saver

import org.junit.Assert.assertEquals
import org.junit.Test
import ru.titan.tv.airplay.NowPlaying

class SaverPlayerTest {

    @Test
    fun `track time reads as minutes and seconds`() {
        assertEquals("0:00", trackTime(0.0))
        assertEquals("0:07", trackTime(7.9))
        assertEquals("3:45", trackTime(225.0))
    }

    @Test
    fun `track time adds hours for long mixes`() {
        assertEquals("1:02:03", trackTime(3723.0))
    }

    @Test
    fun `track time never goes negative`() {
        assertEquals("0:00", trackTime(-4.0))
    }

    @Test
    fun `source names the sender and whether it plays`() {
        assertEquals("Играет по AirPlay · iPhone Кая", playerSource(NowPlaying(client = "iPhone Кая", isPlaying = true)))
        assertEquals("На паузе · iPhone Кая", playerSource(NowPlaying(client = "iPhone Кая", isPlaying = false)))
        assertEquals("Играет по AirPlay", playerSource(NowPlaying(isPlaying = true)))
    }

    @Test
    fun `subtitle joins artist and album that are known`() {
        assertEquals("Земфира · Вендетта", trackSubtitle(NowPlaying(artist = "Земфира", album = "Вендетта")))
        assertEquals("Земфира", trackSubtitle(NowPlaying(artist = "Земфира")))
        assertEquals("", trackSubtitle(NowPlaying()))
    }
}
