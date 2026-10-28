package ru.titan.tv.apps

import org.junit.Assert.assertEquals
import org.junit.Test

class AppOrderTest {

    private val installed = listOf(
        AppEntry("com.spotify.tv.android", "Spotify"),
        AppEntry("ru.titan.tv", "Стекло"),
        AppEntry("com.google.android.youtube.tv", "YouTube"),
        AppEntry("top.rootu.lampa", "Lampa"),
        AppEntry("org.example.zoo", "apple tv+"),
        AppEntry(SETTINGS_PACKAGE, "Настройки"),
    )

    @Test
    fun `pinned apps come first in pinned order`() {
        val ordered = orderApps(installed, pinned = listOf("com.google.android.youtube.tv", "top.rootu.lampa"), selfPackage = "ru.titan.tv")

        assertEquals(listOf("com.google.android.youtube.tv", "top.rootu.lampa"), ordered.take(2).map { it.packageName })
    }

    @Test
    fun `remaining apps are sorted by label ignoring case and settings stays last`() {
        val ordered = orderApps(installed, pinned = emptyList(), selfPackage = "ru.titan.tv")

        assertEquals(listOf("apple tv+", "Lampa", "Spotify", "YouTube", "Настройки"), ordered.map { it.label })
    }

    @Test
    fun `pinned settings can move ahead`() {
        val ordered = orderApps(installed, pinned = listOf(SETTINGS_PACKAGE), selfPackage = "ru.titan.tv")

        assertEquals(SETTINGS_PACKAGE, ordered.first().packageName)
    }

    @Test
    fun `system settings app becomes the settings tile`() {
        assertEquals(SETTINGS_PACKAGE, settingsKey(SYSTEM_SETTINGS_PACKAGE))
        assertEquals("com.google.android.youtube.tv", settingsKey("com.google.android.youtube.tv"))
    }

    @Test
    fun `unknown pinned packages are skipped and the launcher hides itself`() {
        val ordered = orderApps(installed, pinned = listOf("not.installed"), selfPackage = "ru.titan.tv")

        assertEquals(5, ordered.size)
        assertEquals(false, ordered.any { it.packageName == "ru.titan.tv" })
    }
}
