package ru.titan.tv.ha

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class HaProtocolTest {

    @Test
    fun `auth message carries the token`() {
        val message = JSONObject(HaProtocol.auth("secret"))

        assertEquals("auth", message.getString("type"))
        assertEquals("secret", message.getString("access_token"))
    }

    @Test
    fun `call service builds data and target`() {
        val message = JSONObject(
            HaProtocol.callService(
                id = 5,
                domain = "light",
                service = "turn_on",
                entityId = "light.ceiling",
                data = mapOf("brightness_pct" to 40),
            ),
        )

        assertEquals(5, message.getInt("id"))
        assertEquals("call_service", message.getString("type"))
        assertEquals("light", message.getString("domain"))
        assertEquals("turn_on", message.getString("service"))
        assertEquals(40, message.getJSONObject("service_data").getInt("brightness_pct"))
        assertEquals("light.ceiling", message.getJSONObject("target").getString("entity_id"))
        assertFalse(message.has("return_response"))
    }

    @Test
    fun `list values in service data become json arrays`() {
        val json = JSONObject(
            HaProtocol.callService(7, "light", "turn_on", "light.krovat", mapOf("rgbw_color" to listOf(0, 0, 0, 255))),
        )

        assertEquals(255, json.getJSONObject("service_data").getJSONArray("rgbw_color").getInt(3))
    }

    @Test
    fun `a bare command carries only its id and type`() {
        val json = JSONObject(HaProtocol.command(3, "config/device_registry/list"))

        assertEquals(3, json.getInt("id"))
        assertEquals("config/device_registry/list", json.getString("type"))
        assertEquals(2, json.length())
    }

    @Test
    fun `a camera stream request names the camera and the format`() {
        val json = JSONObject(HaProtocol.command(4, "camera/stream", mapOf("entity_id" to "camera.vorota", "format" to "hls")))

        assertEquals("camera.vorota", json.getString("entity_id"))
        assertEquals("hls", json.getString("format"))
    }

    @Test
    fun `call service can ask for a response`() {
        val message = JSONObject(
            HaProtocol.callService(
                id = 7,
                domain = "weather",
                service = "get_forecasts",
                entityId = "weather.home",
                data = mapOf("type" to "hourly"),
                returnResponse = true,
            ),
        )

        assertEquals(true, message.getBoolean("return_response"))
    }

    @Test
    fun `subscribe asks for state changes only`() {
        val message = JSONObject(HaProtocol.subscribeStateChanges(3))

        assertEquals("subscribe_events", message.getString("type"))
        assertEquals("state_changed", message.getString("event_type"))
    }

    @Test
    fun `parses the auth handshake`() {
        assertEquals(HaMessage.AuthRequired, HaProtocol.parse("""{"type":"auth_required","ha_version":"2026.10.1"}"""))
        assertEquals(HaMessage.AuthOk, HaProtocol.parse("""{"type":"auth_ok"}"""))
        assertEquals(
            HaMessage.AuthInvalid("Invalid access token"),
            HaProtocol.parse("""{"type":"auth_invalid","message":"Invalid access token"}"""),
        )
    }

    @Test
    fun `parses a failed result with its error message`() {
        val parsed = HaProtocol.parse(
            """{"id":9,"type":"result","success":false,"error":{"code":"not_found","message":"Service not found"}}""",
        )

        assertEquals(HaMessage.Result(id = 9, success = false, result = null, error = "Service not found"), parsed)
    }

    @Test
    fun `parses a state change into an entity state`() {
        val parsed = HaProtocol.parse(
            """
            {"id":3,"type":"event","event":{"event_type":"state_changed","data":{
              "entity_id":"light.ceiling",
              "new_state":{"entity_id":"light.ceiling","state":"on","attributes":{"brightness":128,"rgb_color":[255,200,150]}}
            }}}
            """.trimIndent(),
        )

        val expected = HaMessage.StateChanged(
            entityId = "light.ceiling",
            newState = EntityState(
                entityId = "light.ceiling",
                state = "on",
                attributes = mapOf("brightness" to 128, "rgb_color" to listOf(255, 200, 150)),
            ),
        )
        assertEquals(expected, parsed)
    }

    @Test
    fun `state change without a new state means the entity was removed`() {
        val parsed = HaProtocol.parse(
            """{"id":3,"type":"event","event":{"event_type":"state_changed","data":{"entity_id":"light.old","new_state":null}}}""",
        ) as HaMessage.StateChanged

        assertNull(parsed.newState)
    }

    @Test
    fun `get states result becomes a map keyed by entity`() {
        val parsed = HaProtocol.parse(
            """{"id":2,"type":"result","success":true,"result":[
                {"entity_id":"light.a","state":"off","attributes":{}},
                {"entity_id":"weather.home","state":"rainy","attributes":{"temperature":7.4}}
            ]}""",
        ) as HaMessage.Result

        val states = HaProtocol.statesFrom(parsed.result)

        assertEquals(setOf("light.a", "weather.home"), states.keys)
        assertEquals(7.4, states.getValue("weather.home").attributes["temperature"])
    }

    @Test
    fun `state changes of unwatched entities are skipped`() {
        val parsed = HaProtocol.parse(
            """{"id":3,"type":"event","event":{"event_type":"state_changed","data":{"entity_id":"sensor.other","new_state":{"entity_id":"sensor.other","state":"1","attributes":{}}}}}""",
        ) { it.startsWith("light.") }

        assertEquals(HaMessage.Ignored, parsed)
    }

    @Test
    fun `unknown messages are ignored`() {
        assertEquals(HaMessage.Ignored, HaProtocol.parse("""{"type":"pong","id":4}"""))
        assertEquals(HaMessage.Ignored, HaProtocol.parse("not json"))
    }
}
