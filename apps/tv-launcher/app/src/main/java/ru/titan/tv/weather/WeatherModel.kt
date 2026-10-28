package ru.titan.tv.weather

import ru.titan.tv.ha.EntityState
import kotlin.math.roundToInt

data class Condition(val icon: String, val label: String)

data class WeatherNow(
    val condition: Condition,
    val temperature: Int,
    val feelsLike: Int,
    val windMs: Int,
    val humidity: Int?,
)

private const val KMH_PER_MS = 3.6
private const val MS_PER_MPH = 0.44704
private const val MS_PER_KNOT = 0.514444
private const val MS_PER_FTS = 0.3048

// Home Assistant's standard weather conditions
private val CONDITIONS = mapOf(
    "sunny" to Condition("sun", "Ясно"),
    "clear-night" to Condition("moon", "Ясно"),
    "partlycloudy" to Condition("cloudSun", "Облачно с прояснениями"),
    "cloudy" to Condition("cloud", "Облачно"),
    "fog" to Condition("cloud", "Туман"),
    "rainy" to Condition("rain", "Дождь"),
    "pouring" to Condition("rain", "Ливень"),
    "lightning" to Condition("rain", "Гроза"),
    "lightning-rainy" to Condition("rain", "Гроза с дождём"),
    "hail" to Condition("rain", "Град"),
    "snowy" to Condition("snow", "Снег"),
    "snowy-rainy" to Condition("snow", "Мокрый снег"),
    "windy" to Condition("wind", "Ветрено"),
    "windy-variant" to Condition("wind", "Ветрено"),
    "exceptional" to Condition("cloud", "Необычная погода"),
)

fun conditionOf(raw: String): Condition = CONDITIONS[raw] ?: Condition("cloud", raw)

fun parseWeatherNow(state: EntityState?): WeatherNow? {
    if (state == null || state.state == "unavailable" || state.state == "unknown") return null
    val attributes = state.attributes
    val temperature = attributes.number("temperature") ?: return null
    val wind = attributes.number("wind_speed") ?: 0.0
    val windUnit = attributes["wind_speed_unit"] as? String ?: "km/h"
    return WeatherNow(
        condition = conditionOf(state.state),
        temperature = temperature.roundToInt(),
        feelsLike = (attributes.number("apparent_temperature") ?: temperature).roundToInt(),
        windMs = metresPerSecond(wind, windUnit).roundToInt(),
        humidity = attributes.number("humidity")?.roundToInt(),
    )
}

fun formatTemperature(degrees: Int): String = when {
    degrees > 0 -> "+$degrees°"
    degrees < 0 -> "−${-degrees}°"
    else -> "0°"
}

private fun metresPerSecond(value: Double, unit: String): Double = when (unit) {
    "m/s" -> value
    "mph" -> value * MS_PER_MPH
    "kn" -> value * MS_PER_KNOT
    "ft/s" -> value * MS_PER_FTS
    else -> value / KMH_PER_MS
}

private fun Map<String, Any?>.number(key: String): Double? = (this[key] as? Number)?.toDouble()
