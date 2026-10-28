package ru.titan.tv.weather

import ru.titan.tv.ha.EntityState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WeatherModelTest {

    private fun weather(condition: String, attributes: Map<String, Any?>) =
        EntityState("weather.home", condition, attributes)

    @Test
    fun `home assistant conditions map to icon and label`() {
        assertEquals(Condition("cloudSun", "Облачно с прояснениями"), conditionOf("partlycloudy"))
        assertEquals(Condition("rain", "Ливень"), conditionOf("pouring"))
        assertEquals(Condition("snow", "Снег"), conditionOf("snowy"))
        assertEquals(Condition("sun", "Ясно"), conditionOf("sunny"))
        assertEquals(Condition("moon", "Ясно"), conditionOf("clear-night"))
        assertEquals(Condition("cloud", "Туман"), conditionOf("fog"))
    }

    @Test
    fun `unknown condition keeps its raw name`() {
        assertEquals(Condition("cloud", "volcanic-ash"), conditionOf("volcanic-ash"))
    }

    @Test
    fun `current weather is rounded and wind converted from kilometres per hour`() {
        val now = parseWeatherNow(
            weather(
                "rainy",
                mapOf(
                    "temperature" to 7.4,
                    "apparent_temperature" to 4.6,
                    "humidity" to 72,
                    "wind_speed" to 18.0,
                    "wind_speed_unit" to "km/h",
                ),
            ),
        )

        assertEquals(WeatherNow(conditionOf("rainy"), temperature = 7, feelsLike = 5, windMs = 5, humidity = 72), now)
    }

    @Test
    fun `wind already in metres per second is kept`() {
        val now = parseWeatherNow(weather("sunny", mapOf("temperature" to 14, "wind_speed" to 3, "wind_speed_unit" to "m/s")))

        assertEquals(3, now?.windMs)
        assertEquals(14, now?.feelsLike)
    }

    @Test
    fun `unavailable weather entity gives no weather`() {
        assertNull(parseWeatherNow(null))
        assertNull(parseWeatherNow(weather("unavailable", emptyMap())))
    }

    @Test
    fun `temperature is shown with a sign`() {
        assertEquals("+9°", formatTemperature(9))
        assertEquals("−2°", formatTemperature(-2))
        assertEquals("0°", formatTemperature(0))
    }
}
