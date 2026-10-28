package ru.titan.tv.ha

import org.json.JSONArray
import org.json.JSONObject

/** One Home Assistant entity; attributes are plain Kotlin maps, lists and numbers. */
data class EntityState(
    val entityId: String,
    val state: String,
    val attributes: Map<String, Any?>,
)

sealed interface HaMessage {
    data object AuthRequired : HaMessage
    data object AuthOk : HaMessage
    data class AuthInvalid(val reason: String) : HaMessage
    data class Result(val id: Int, val success: Boolean, val result: Any?, val error: String?) : HaMessage
    data class StateChanged(val entityId: String, val newState: EntityState?) : HaMessage
    data object Ignored : HaMessage
}

/** Builds and parses messages of the Home Assistant WebSocket API. */
object HaProtocol {

    fun auth(token: String): String =
        JSONObject().put("type", "auth").put("access_token", token).toString()

    fun getStates(id: Int): String =
        JSONObject().put("id", id).put("type", "get_states").toString()

    fun subscribeStateChanges(id: Int): String =
        JSONObject().put("id", id).put("type", "subscribe_events").put("event_type", "state_changed").toString()

    fun ping(id: Int): String = command(id, "ping")

    /** A command such as reading a registry or asking for a camera stream; [fields] go next to the type. */
    fun command(id: Int, type: String, fields: Map<String, Any> = emptyMap()): String {
        val message = JSONObject().put("id", id).put("type", type)
        fields.forEach { (key, value) -> message.put(key, JSONObject.wrap(value)) }
        return message.toString()
    }

    fun callService(
        id: Int,
        domain: String,
        service: String,
        entityId: String?,
        data: Map<String, Any> = emptyMap(),
        returnResponse: Boolean = false,
    ): String {
        val serviceData = JSONObject()
        // Android's JSONObject writes a bare List as its toString(); wrap turns it into a JSON array
        data.forEach { (key, value) -> serviceData.put(key, JSONObject.wrap(value)) }
        val message = JSONObject()
            .put("id", id)
            .put("type", "call_service")
            .put("domain", domain)
            .put("service", service)
            .put("service_data", serviceData)
        if (entityId != null) message.put("target", JSONObject().put("entity_id", entityId))
        if (returnResponse) message.put("return_response", true)
        return message.toString()
    }

    /** [isWatched] drops state changes of other entities before their attributes are converted. */
    fun parse(text: String, isWatched: (String) -> Boolean = { true }): HaMessage {
        val json = runCatching { JSONObject(text) }.getOrNull() ?: return HaMessage.Ignored
        return when (json.optString("type")) {
            "auth_required" -> HaMessage.AuthRequired
            "auth_ok" -> HaMessage.AuthOk
            "auth_invalid" -> HaMessage.AuthInvalid(json.optString("message"))
            "result" -> HaMessage.Result(
                id = json.optInt("id"),
                success = json.optBoolean("success"),
                result = toKotlin(json.opt("result")),
                error = json.optJSONObject("error")?.optString("message"),
            )
            "event" -> parseEvent(json, isWatched)
            else -> HaMessage.Ignored
        }
    }

    /** Turns a get_states result into entities keyed by id. */
    fun statesFrom(result: Any?): Map<String, EntityState> =
        (result as? List<*>).orEmpty()
            .mapNotNull { (it as? Map<*, *>)?.let(::entityFrom) }
            .associateBy { it.entityId }

    private fun parseEvent(json: JSONObject, isWatched: (String) -> Boolean): HaMessage {
        val event = json.optJSONObject("event") ?: return HaMessage.Ignored
        if (event.optString("event_type") != "state_changed") return HaMessage.Ignored
        val data = event.optJSONObject("data") ?: return HaMessage.Ignored
        val entityId = data.optString("entity_id")
        if (entityId.isEmpty() || !isWatched(entityId)) return HaMessage.Ignored
        val newState = (toKotlin(data.opt("new_state")) as? Map<*, *>)?.let(::entityFrom)
        return HaMessage.StateChanged(entityId, newState)
    }

    private fun entityFrom(map: Map<*, *>): EntityState? {
        val entityId = map["entity_id"] as? String ?: return null
        val attributes = (map["attributes"] as? Map<*, *>).orEmpty()
            .mapNotNull { (key, value) -> (key as? String)?.let { it to value } }
            .toMap()
        return EntityState(entityId, map["state"] as? String ?: "", attributes)
    }

    private fun toKotlin(value: Any?): Any? = when {
        value == null || value == JSONObject.NULL -> null
        value is JSONObject -> value.keys().asSequence().associateWith { toKotlin(value.opt(it)) }
        value is JSONArray -> (0 until value.length()).map { toKotlin(value.opt(it)) }
        else -> value
    }
}
