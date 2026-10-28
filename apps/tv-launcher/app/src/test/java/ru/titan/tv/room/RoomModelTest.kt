package ru.titan.tv.room

import ru.titan.tv.config.LightConfig
import ru.titan.tv.config.SceneConfig
import ru.titan.tv.ha.EntityState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RoomModelTest {

    private val ceiling = LightConfig(entityId = "light.ceiling", name = "Люстра", icon = "ceiling")

    private fun argb(r: Int, g: Int, b: Int): Int = (0xFF shl 24) or (r shl 16) or (g shl 8) or b

    @Test
    fun `brightness is converted to percent`() {
        assertEquals(100, brightnessPercent(255))
        assertEquals(50, brightnessPercent(128))
        assertEquals(40, brightnessPercent(102))
        assertEquals(0, brightnessPercent(null))
    }

    @Test
    fun `light that is on shows brightness and colour temperature`() {
        val state = EntityState("light.ceiling", "on", mapOf("brightness" to 102, "color_temp_kelvin" to 2700))

        val light = lightUi(ceiling, state)

        assertTrue(light.isOn)
        assertTrue(light.isAvailable)
        assertEquals(40, light.percent)
        assertEquals("2700 K", light.detail)
        assertEquals(argb(255, 197, 138), light.colorArgb)
    }

    @Test
    fun `rgb light uses its own colour`() {
        val state = EntityState("light.ceiling", "on", mapOf("brightness" to 255, "rgb_color" to listOf(91, 108, 255)))

        val light = lightUi(ceiling, state)

        assertEquals(argb(91, 108, 255), light.colorArgb)
        assertEquals("Цветная", light.detail)
    }

    @Test
    fun `on-off only light is not dimmable`() {
        val onOff = lightUi(ceiling, EntityState("light.ceiling", "on", mapOf("supported_color_modes" to listOf("onoff"))))
        val strip = lightUi(ceiling, EntityState("light.ceiling", "on", mapOf("supported_color_modes" to listOf("color_temp", "xy"))))

        assertFalse(onOff.isDimmable)
        assertEquals(100, onOff.percent)
        assertTrue(strip.isDimmable)
    }

    @Test
    fun `light that is off says so`() {
        val light = lightUi(ceiling, EntityState("light.ceiling", "off", emptyMap()))

        assertFalse(light.isOn)
        assertEquals(0, light.percent)
        assertEquals("Выключен", light.detail)
    }

    @Test
    fun `missing or unavailable entity is shown as unavailable`() {
        assertFalse(lightUi(ceiling, null).isAvailable)
        val unavailable = lightUi(ceiling, EntityState("light.ceiling", "unavailable", emptyMap()))
        assertFalse(unavailable.isAvailable)
        assertEquals("Недоступен", unavailable.detail)
    }

    @Test
    fun `kelvin between table points is interpolated`() {
        assertEquals(argb(255, 189, 123), kelvinToArgb(2550))
        assertEquals(argb(255, 169, 87), kelvinToArgb(1800))
    }

    @Test
    fun `brightness step clamps and switches off at zero`() {
        assertEquals(50, steppedBrightness(isOn = true, percent = 40, delta = 10))
        assertEquals(100, steppedBrightness(isOn = true, percent = 95, delta = 10))
        assertEquals(0, steppedBrightness(isOn = true, percent = 10, delta = -10))
        assertEquals(10, steppedBrightness(isOn = false, percent = 70, delta = 10))
        assertEquals(0, steppedBrightness(isOn = false, percent = 70, delta = -10))
    }

    @Test
    fun `most recently activated scene is active`() {
        val scenes = listOf(
            SceneConfig("scene.movie", "Кино", "film"),
            SceneConfig("scene.evening", "Вечер", "sunset"),
            SceneConfig("scene.night", "Ночь", "moon"),
        )
        val states = mapOf(
            "scene.movie" to EntityState("scene.movie", "2026-10-20T21:00:00.000000+00:00", emptyMap()),
            "scene.evening" to EntityState("scene.evening", "2026-10-21T18:30:00.123456+00:00", emptyMap()),
            "scene.night" to EntityState("scene.night", "unknown", emptyMap()),
        )

        assertEquals("scene.evening", activeSceneId(scenes, states))
    }

    @Test
    fun `no scene is active when none was ever activated`() {
        val scenes = listOf(SceneConfig("scene.movie", "Кино", "film"))
        val states = mapOf("scene.movie" to EntityState("scene.movie", "unknown", emptyMap()))

        assertNull(activeSceneId(scenes, states))
    }
}
