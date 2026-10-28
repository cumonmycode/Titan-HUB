package ru.titan.tv.config

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ConfigParserTest {

    private val full = """
        {
          "homeAssistant": { "url": "http://192.168.1.10:8123/", "token": "abc" },
          "room": {
            "name": "Гостиная",
            "lights": [
              { "entity": "light.ceiling", "name": "Люстра", "icon": "ceiling" },
              { "entity": "light.strip", "name": "Подсветка за ТВ", "icon": "rainbow" }
            ],
            "scenes": [
              { "entity": "scene.movie", "name": "Кино", "icon": "film" },
              { "entity": "script.evening", "name": "Вечер", "icon": "sunset" }
            ],
            "temperature": "sensor.living_temperature",
            "humidity": "sensor.living_humidity",
            "tvPower": { "service": "media_player.turn_off", "entity": "media_player.tv" }
          },
          "weather": { "entity": "weather.home", "city": "Нальчик" },
          "pinnedApps": ["com.google.android.youtube.tv", "settings"]
        }
    """.trimIndent()

    private fun failureMessage(json: String): String =
        parseConfig(json).exceptionOrNull()?.message.orEmpty()

    @Test
    fun `parses a full config`() {
        val config = parseConfig(full).getOrThrow()

        assertEquals("http://192.168.1.10:8123", config.homeAssistant?.baseUrl)
        assertEquals("ws://192.168.1.10:8123/api/websocket", config.homeAssistant?.websocketUrl)
        assertEquals("Гостиная", config.room?.name)
        assertEquals(listOf("light.ceiling", "light.strip"), config.room?.lights?.map { it.entityId })
        assertEquals("script.evening", config.room?.scenes?.get(1)?.entityId)
        assertEquals("sensor.living_temperature", config.room?.temperatureEntity)
        assertEquals(ServiceCall("media_player", "turn_off", "media_player.tv"), config.room?.tvPower)
        assertEquals(WeatherConfig("weather.home"), config.weather)
        assertEquals(listOf("com.google.android.youtube.tv", "settings"), config.pinnedApps)
    }

    @Test
    fun `https url maps to secure websocket`() {
        val config = parseConfig("""{"homeAssistant": {"url": "https://ha.example.org", "token": "t"}}""").getOrThrow()

        assertEquals("wss://ha.example.org/api/websocket", config.homeAssistant?.websocketUrl)
    }

    @Test
    fun `empty config is valid and uses default pinned apps`() {
        val config = parseConfig("{}").getOrThrow()

        assertNull(config.homeAssistant)
        assertNull(config.room)
        assertEquals(DEFAULT_PINNED_APPS, config.pinnedApps)
    }

    @Test
    fun `unknown light icon falls back to a bulb`() {
        val config = parseConfig(full).getOrThrow()

        assertEquals("bulb", config.room?.lights?.get(1)?.icon)
    }

    @Test
    fun `rejects url without scheme`() {
        val message = failureMessage("""{"homeAssistant": {"url": "192.168.1.10:8123", "token": "t"}}""")

        assertTrue(message, message.contains("homeAssistant.url"))
    }

    @Test
    fun `rejects empty token`() {
        val message = failureMessage("""{"homeAssistant": {"url": "http://ha.local:8123", "token": " "}}""")

        assertTrue(message, message.contains("homeAssistant.token"))
    }

    @Test
    fun `rejects a light from another domain`() {
        val message = failureMessage(
            """{"room": {"name": "Кухня", "lights": [{"entity": "sensor.kettle", "name": "Чайник"}]}}""",
        )

        assertTrue(message, message.contains("sensor.kettle"))
    }

    @Test
    fun `a switch is accepted as a light`() {
        val room = parseConfig(
            """{"room": {"name": "Кабинка", "lights": [{"entity": "switch.booth_l1", "name": "Чилл"}]}}""",
        ).getOrThrow().room!!

        assertEquals("switch.booth_l1", room.lights.single().entityId)
    }

    @Test
    fun `reads the air conditioner and the call for staff`() {
        val room = parseConfig(
            """{"room": {"name": "Кабинка",
                "climate": {"entity": "climate.booth_ac"},
                "callStaff": {"service": "script.turn_on", "entity": "script.call_staff"}}}""",
        ).getOrThrow().room!!

        assertEquals(ClimateConfig("climate.booth_ac", "Кондиционер"), room.climate)
        assertEquals(ServiceCall("script", "turn_on", "script.call_staff"), room.callStaff)
    }

    @Test
    fun `rejects an air conditioner from another domain`() {
        val message = failureMessage("""{"room": {"name": "Кабинка", "climate": {"entity": "switch.ac"}}}""")

        assertTrue(message, message.contains("switch.ac"))
    }

    @Test
    fun `cinemas fall back to the defaults and can be overridden`() {
        assertEquals(DEFAULT_CINEMA_APPS, parseConfig("{}").getOrThrow().cinemaApps)
        assertEquals(listOf("ru.kinopoisk.tv"), parseConfig("""{"cinemaApps": ["ru.kinopoisk.tv"]}""").getOrThrow().cinemaApps)
    }

    @Test
    fun `rejects tv power service without a domain`() {
        val message = failureMessage(
            """{"room": {"name": "Кухня", "tvPower": {"service": "turn_off"}}}""",
        )

        assertTrue(message, message.contains("tvPower.service"))
    }

    @Test
    fun `malformed json fails with a readable message`() {
        val message = failureMessage("{ not json")

        assertTrue(message, message.startsWith("config.json"))
    }

    @Test
    fun `malformed json message does not echo the file`() {
        val message = failureMessage("""{ "homeAssistant": { "token": "secret-token" """)

        assertFalse(message, message.contains("secret-token"))
    }

    @Test
    fun `rejects url with an invalid port`() {
        val message = failureMessage("""{"homeAssistant": {"url": "http://192.168.1.10:99999", "token": "t"}}""")

        assertTrue(message, message.contains("homeAssistant.url"))
    }

    @Test
    fun `plain http is refused for internet hosts`() {
        val message = failureMessage("""{"homeAssistant": {"url": "http://my-home.duckdns.org", "token": "t"}}""")

        assertTrue(message, message.contains("https://"))
    }

    @Test
    fun `plain http is allowed on the local network`() {
        listOf("http://homeassistant.local:8123", "http://10.0.0.5:8123", "http://172.20.1.2", "http://localhost:8123")
            .forEach { url -> assertTrue(url, parseConfig("""{"homeAssistant": {"url": "$url", "token": "t"}}""").isSuccess) }
    }
}
