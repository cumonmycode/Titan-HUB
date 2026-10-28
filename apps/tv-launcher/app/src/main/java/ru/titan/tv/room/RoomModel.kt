package ru.titan.tv.room

import ru.titan.tv.config.LightConfig
import ru.titan.tv.config.SceneConfig
import ru.titan.tv.ha.EntityState
import java.time.Instant
import java.time.OffsetDateTime
import kotlin.math.roundToInt

data class LightUi(
    val entityId: String,
    val name: String,
    val icon: String,
    val isAvailable: Boolean,
    val isOn: Boolean,
    /** False for on/off-only lights: left and right switch them instead of dimming. */
    val isDimmable: Boolean,
    val percent: Int,
    val colorArgb: Int,
    val detail: String,
    /** Colours offered under the light; empty for lights that only dim or switch. */
    val presets: List<ColorPreset> = emptyList(),
)

private const val MAX_BRIGHTNESS = 255
private const val FULL_PERCENT = 100
private const val WARM_DEFAULT_KELVIN = 2700

// Incandescent-to-daylight white points, the same table the mockup used
private val KELVIN_TABLE: List<Pair<Int, Int>> = listOf(
    2200 to argb(255, 169, 87),
    2400 to argb(255, 180, 107),
    2700 to argb(255, 197, 138),
    3000 to argb(255, 208, 159),
    4000 to argb(255, 227, 196),
    5000 to argb(255, 236, 224),
    6500 to argb(255, 249, 253),
)

fun brightnessPercent(raw: Int?): Int =
    if (raw == null) 0 else (raw * 100.0 / MAX_BRIGHTNESS).roundToInt().coerceIn(0, FULL_PERCENT)

fun kelvinToArgb(kelvin: Int): Int {
    val upper = KELVIN_TABLE.indexOfFirst { (k, _) -> k >= kelvin }
    if (upper == 0) return KELVIN_TABLE.first().second
    if (upper < 0) return KELVIN_TABLE.last().second
    val (k0, c0) = KELVIN_TABLE[upper - 1]
    val (k1, c1) = KELVIN_TABLE[upper]
    val t = (kelvin - k0).toDouble() / (k1 - k0)
    return argb(lerp(red(c0), red(c1), t), lerp(green(c0), green(c1), t), lerp(blue(c0), blue(c1), t))
}

fun lightUi(config: LightConfig, state: EntityState?): LightUi {
    val isAvailable = state != null && state.state != "unavailable"
    val isOn = isAvailable && state?.state == "on"
    val attributes = state?.attributes.orEmpty()
    val rgb = (attributes["rgb_color"] as? List<*>)
        ?.mapNotNull { (it as? Number)?.toInt() }
        ?.takeIf { it.size == 3 }
    val kelvin = (attributes["color_temp_kelvin"] as? Number)?.toInt()
    val mode = attributes["color_mode"] as? String
    val modes = (attributes["supported_color_modes"] as? List<*>).orEmpty().filterIsInstance<String>()
    val isColorTemperature = kelvin != null && (mode == null || mode == "color_temp")
    val detail = when {
        !isAvailable -> "Недоступен"
        !isOn -> "Выключен"
        isColorTemperature -> "$kelvin K"
        rgb != null -> "Цветная"
        else -> "Включён"
    }
    val percent = when {
        !isOn -> 0
        attributes["brightness"] == null -> FULL_PERCENT
        else -> brightnessPercent((attributes["brightness"] as? Number)?.toInt())
    }
    return LightUi(
        entityId = config.entityId,
        name = config.name,
        icon = config.icon,
        isAvailable = isAvailable,
        isOn = isOn,
        // A switch only turns its light on and off, whatever attributes it reports
        isDimmable = config.entityId.startsWith("light.") && (modes.isEmpty() || modes.any { it != "onoff" }),
        percent = percent,
        colorArgb = rgb?.let { argb(it[0], it[1], it[2]) } ?: kelvinToArgb(kelvin ?: WARM_DEFAULT_KELVIN),
        detail = detail,
        presets = colorPresets(
            modes.toSet(),
            minKelvin = (attributes["min_color_temp_kelvin"] as? Number)?.toInt(),
            maxKelvin = (attributes["max_color_temp_kelvin"] as? Number)?.toInt(),
            brightness = (attributes["brightness"] as? Number)?.toInt(),
        ),
    )
}

/** New brightness after a left/right press; 0 means switch the light off. */
fun steppedBrightness(isOn: Boolean, percent: Int, delta: Int): Int = when {
    isOn -> (percent + delta).coerceIn(0, FULL_PERCENT)
    delta > 0 -> delta.coerceIn(0, FULL_PERCENT)
    else -> 0
}

/** A scene entity's state is the time it was last activated; the newest one counts as active. */
fun activeSceneId(scenes: List<SceneConfig>, states: Map<String, EntityState>): String? =
    scenes.mapNotNull { scene -> states[scene.entityId]?.state?.let(::parseInstant)?.let { scene.entityId to it } }
        .maxByOrNull { (_, activatedAt) -> activatedAt }
        ?.first

private fun parseInstant(text: String): Instant? =
    runCatching { OffsetDateTime.parse(text).toInstant() }.getOrNull()

private fun argb(r: Int, g: Int, b: Int): Int = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
private fun red(c: Int) = (c shr 16) and 0xFF
private fun green(c: Int) = (c shr 8) and 0xFF
private fun blue(c: Int) = c and 0xFF
private fun lerp(a: Int, b: Int, t: Double): Int = (a + (b - a) * t).roundToInt()
