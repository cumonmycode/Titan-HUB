package ru.titan.tv.room

import ru.titan.tv.config.ClimateConfig
import ru.titan.tv.ha.EntityState
import kotlin.math.roundToInt

private const val OFF = "off"
private const val DEFAULT_ON_MODE = "cool"
private const val DEFAULT_MIN = 16
private const val DEFAULT_MAX = 30

/** An air conditioner as the room sheet shows it. IR-driven units report what was last sent, not a measurement. */
data class ClimateUi(
    val entityId: String,
    val name: String,
    val isAvailable: Boolean,
    val mode: String,
    val target: Int?,
    val current: Double?,
    val minTemp: Int,
    val maxTemp: Int,
    val step: Int,
    /** Operating modes other than off, in Home Assistant's order. */
    val modes: List<String>,
    val fanMode: String?,
    val fanModes: List<String>,
) {
    val isOn: Boolean get() = isAvailable && mode != OFF
}

/** [pendingTarget] is a temperature the remote just set, shown until Home Assistant echoes it. */
fun climateUi(config: ClimateConfig, state: EntityState?, pendingTarget: Int?): ClimateUi {
    val attributes = state?.attributes.orEmpty()
    val step = (attributes["target_temp_step"] as? Number)?.toInt()?.coerceAtLeast(1) ?: 1
    return ClimateUi(
        entityId = config.entityId,
        name = config.name,
        isAvailable = state != null && state.state != "unavailable" && state.state != "unknown",
        mode = state?.state ?: OFF,
        target = pendingTarget ?: (attributes["temperature"] as? Number)?.toDouble()?.roundToInt(),
        current = (attributes["current_temperature"] as? Number)?.toDouble(),
        minTemp = (attributes["min_temp"] as? Number)?.toDouble()?.roundToInt() ?: DEFAULT_MIN,
        maxTemp = (attributes["max_temp"] as? Number)?.toDouble()?.roundToInt() ?: DEFAULT_MAX,
        step = step,
        modes = (attributes["hvac_modes"] as? List<*>).orEmpty().filterIsInstance<String>().filter { it != OFF },
        fanMode = attributes["fan_mode"] as? String,
        fanModes = (attributes["fan_modes"] as? List<*>).orEmpty().filterIsInstance<String>(),
    )
}

/** The mode to switch on with: the last one used, or cooling. */
fun resumeMode(state: EntityState?): String =
    (state?.attributes?.get("last_on_operation") as? String)?.takeIf { it != OFF } ?: DEFAULT_ON_MODE

/** New target after a left/right press, kept inside the unit's range. */
fun steppedTarget(climate: ClimateUi, direction: Int): Int {
    val from = climate.target ?: ((climate.minTemp + climate.maxTemp) / 2)
    return (from + direction * climate.step).coerceIn(climate.minTemp, climate.maxTemp)
}

fun hvacModeLabel(mode: String): String = when (mode) {
    "cool" -> "Холод"
    "heat" -> "Тепло"
    "auto", "heat_cool" -> "Авто"
    "dry" -> "Осушение"
    "fan_only" -> "Обдув"
    OFF -> "Выключен"
    else -> mode
}

fun hvacModeIcon(mode: String): String = when (mode) {
    "cool" -> "snow"
    "heat" -> "sun"
    "dry" -> "drop"
    "fan_only" -> "wind"
    else -> "auto"
}

fun fanModeLabel(mode: String): String = when (mode) {
    "auto" -> "Авто"
    "low", "quiet", "silent" -> "Тихо"
    "medium", "middle" -> "Средне"
    "high", "strong", "turbo" -> "Сильно"
    else -> mode
}
