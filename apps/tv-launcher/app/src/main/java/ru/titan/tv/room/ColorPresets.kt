package ru.titan.tv.room

/** One colour choice for a light, with the light.turn_on data that sets it. */
data class ColorPreset(val name: String, val swatchArgb: Int, val data: Map<String, Any>)

private val COLOR_MODES = setOf("hs", "xy", "rgb", "rgbw", "rgbww")
private const val WARM_KELVIN = 2700
private const val COLD_KELVIN = 6500
private const val FULL = 255
private const val WARM_SWATCH = 0xFFFFC587.toInt()
private const val COLD_SWATCH = 0xFFE6F0FF.toInt()
private val WARM_HS = listOf(30, 65)

private class Hue(val name: String, val swatch: Int, val hue: Int, val saturation: Int = 100)

private val HUES = listOf(
    Hue("Красный", 0xFFFF453A.toInt(), 0),
    Hue("Оранжевый", 0xFFFF9F0A.toInt(), 25),
    Hue("Жёлтый", 0xFFFFD60A.toInt(), 50),
    Hue("Зелёный", 0xFF30D158.toInt(), 120),
    Hue("Бирюзовый", 0xFF40E0D0.toInt(), 172),
    Hue("Синий", 0xFF0A84FF.toInt(), 225),
    Hue("Фиолетовый", 0xFFBF5AF2.toInt(), 275),
    Hue("Розовый", 0xFFFF375F.toInt(), 330, saturation = 75),
)

/**
 * The colours this light can really show. Cold white goes to the light's own white channel when it
 * has one: white mixed from red, green and blue looks bluish and dim on a strip. [brightness] is the
 * light's current 0-255 level, kept when switching to that white channel.
 */
fun colorPresets(modes: Set<String>, minKelvin: Int?, maxKelvin: Int?, brightness: Int? = null): List<ColorPreset> {
    val hasColor = modes.any { it in COLOR_MODES }
    val hasTemperature = "color_temp" in modes
    if (!hasColor && !hasTemperature) return emptyList()
    val warm: Map<String, Any> = when {
        hasTemperature -> mapOf("color_temp_kelvin" to maxOf(minKelvin ?: WARM_KELVIN, WARM_KELVIN))
        "rgbww" in modes -> mapOf("rgbww_color" to listOf(0, 0, 0, 0, FULL))
        else -> mapOf("hs_color" to WARM_HS)
    }
    val cold: Map<String, Any> = when {
        // Home Assistant reads "white" as a brightness, so it carries the current level rather than true
        "white" in modes -> mapOf("white" to (brightness?.takeIf { it > 0 } ?: FULL))
        "rgbww" in modes -> mapOf("rgbww_color" to listOf(0, 0, 0, FULL, 0))
        "rgbw" in modes -> mapOf("rgbw_color" to listOf(0, 0, 0, FULL))
        hasTemperature -> mapOf("color_temp_kelvin" to (maxKelvin ?: COLD_KELVIN))
        else -> mapOf("rgb_color" to listOf(FULL, FULL, FULL))
    }
    val whites = listOf(ColorPreset("Тёплый", WARM_SWATCH, warm), ColorPreset("Холодный", COLD_SWATCH, cold))
    if (!hasColor) return whites
    return whites + HUES.map { ColorPreset(it.name, it.swatch, mapOf("hs_color" to listOf(it.hue, it.saturation))) }
}
