package ru.titan.tv.room

import ru.titan.tv.config.LightConfig
import ru.titan.tv.ha.EntityState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ColorPresetsTest {

    @Test
    fun `an rgbw strip gets its own white channel for cold white and the full palette`() {
        val presets = colorPresets(setOf("rgbw"), minKelvin = null, maxKelvin = null)

        assertEquals(mapOf("rgbw_color" to listOf(0, 0, 0, 255)), presets.first { it.name == "Холодный" }.data)
        assertEquals(mapOf("hs_color" to listOf(0, 100)), presets.first { it.name == "Красный" }.data)
        assertEquals(10, presets.size)
    }

    @Test
    fun `a light with a separate white mode keeps its brightness in white`() {
        // Home Assistant reads "white" as a 0-255 brightness, so true would mean almost off
        val lit = colorPresets(setOf("hs", "white"), minKelvin = null, maxKelvin = null, brightness = 128)
        val dark = colorPresets(setOf("hs", "white"), minKelvin = null, maxKelvin = null, brightness = null)

        assertEquals(mapOf("white" to 128), lit.first { it.name == "Холодный" }.data)
        assertEquals(mapOf("white" to 255), dark.first { it.name == "Холодный" }.data)
    }

    @Test
    fun `a tunable white bulb gets warm and cold from its own range only`() {
        val presets = colorPresets(setOf("color_temp"), minKelvin = 2200, maxKelvin = 6500)

        assertEquals(listOf("Тёплый", "Холодный"), presets.map { it.name })
        assertEquals(mapOf("color_temp_kelvin" to 2700), presets[0].data)
        assertEquals(mapOf("color_temp_kelvin" to 6500), presets[1].data)
    }

    @Test
    fun `plain dimmable and on-off lights get no colours`() {
        assertTrue(colorPresets(setOf("brightness"), minKelvin = null, maxKelvin = null).isEmpty())
        assertTrue(colorPresets(setOf("onoff"), minKelvin = null, maxKelvin = null).isEmpty())
    }

    @Test
    fun `a light offers its colours even while it is off`() {
        val state = EntityState("light.krovat", "off", mapOf("supported_color_modes" to listOf("rgbw")))

        val light = lightUi(LightConfig("light.krovat", "Кровать", "strip"), state)

        assertEquals(10, light.presets.size)
    }
}
