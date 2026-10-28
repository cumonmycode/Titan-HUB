package ru.titan.tv.apps

import org.junit.Assert.assertEquals
import org.junit.Test

class HomeTilesTest {

    private val installed = listOf(
        AppEntry("a.wink", "Wink"),
        AppEntry("b.youtube", "YouTube"),
        AppEntry(SETTINGS_PACKAGE, "Настройки"),
    )

    @Test
    fun `home row keeps the pinned order and skips apps that are gone`() {
        val row = homeTiles(installed, listOf("b.youtube", "gone.app", "a.wink"))

        assertEquals(listOf("b.youtube", "a.wink"), row.map { it.packageName })
    }
}
