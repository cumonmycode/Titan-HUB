package ru.titan.tv.room

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import ru.titan.tv.config.ClimateConfig
import ru.titan.tv.config.LightConfig
import ru.titan.tv.ha.EntityState

class ClimateModelTest {

    private val config = ClimateConfig("climate.booth_ac", "Кондиционер")

    // What a Broadlink SmartIR air conditioner reports: no room temperature, the last sent target
    private fun irUnit(state: String = "off", target: Number = 20, lastOn: String? = "cool") = EntityState(
        "climate.booth_ac",
        state,
        mapOf(
            "hvac_modes" to listOf("off", "auto", "cool", "dry", "heat", "fan_only"),
            "min_temp" to 17,
            "max_temp" to 30,
            "target_temp_step" to 1,
            "fan_modes" to listOf("auto", "low", "medium", "high"),
            "current_temperature" to null,
            "temperature" to target,
            "fan_mode" to "high",
            "last_on_operation" to lastOn,
        ),
    )

    @Test
    fun `an IR unit reads as off with its modes and fan speeds`() {
        val climate = climateUi(config, irUnit(), pendingTarget = null)

        assertTrue(climate.isAvailable)
        assertFalse(climate.isOn)
        assertEquals(20, climate.target)
        assertNull(climate.current)
        assertEquals(listOf("auto", "cool", "dry", "heat", "fan_only"), climate.modes)
        assertEquals(listOf("auto", "low", "medium", "high"), climate.fanModes)
    }

    @Test
    fun `a running unit is on and a pending target wins over the reported one`() {
        val climate = climateUi(config, irUnit(state = "cool"), pendingTarget = 23)

        assertTrue(climate.isOn)
        assertEquals(23, climate.target)
    }

    @Test
    fun `a missing or unavailable unit cannot be used`() {
        assertFalse(climateUi(config, null, null).isAvailable)
        assertFalse(climateUi(config, irUnit(state = "unavailable"), null).isAvailable)
    }

    @Test
    fun `steps stay inside the unit's range`() {
        val climate = climateUi(config, irUnit(target = 30), null)

        assertEquals(30, steppedTarget(climate, 1))
        assertEquals(29, steppedTarget(climate, -1))
        assertEquals(17, steppedTarget(climateUi(config, irUnit(target = 17), null), -1))
    }

    @Test
    fun `switching on resumes the last mode or cools`() {
        assertEquals("heat", resumeMode(irUnit(lastOn = "heat")))
        assertEquals("cool", resumeMode(irUnit(lastOn = null)))
        assertEquals("cool", resumeMode(null))
    }

    @Test
    fun `a switch only turns its light on and off`() {
        val light = lightUi(LightConfig("switch.booth_l1", "Чилл", "sconce"), EntityState("switch.booth_l1", "on", emptyMap()))

        assertTrue(light.isOn)
        assertFalse(light.isDimmable)
        assertTrue(light.presets.isEmpty())
    }
}
