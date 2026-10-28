package ru.titan.tv.home

import android.os.SystemClock
import ru.titan.tv.config.ConfigRepository
import ru.titan.tv.config.ConfigState
import ru.titan.tv.config.EMPTY_CONFIG
import ru.titan.tv.config.TitanConfig
import ru.titan.tv.ha.EntityState
import ru.titan.tv.ha.HaClient
import ru.titan.tv.ha.HaStatus
import ru.titan.tv.room.RoomUi
import ru.titan.tv.room.buildRoomUi
import ru.titan.tv.room.resumeMode
import ru.titan.tv.room.steppedBrightness
import ru.titan.tv.room.steppedTarget
import ru.titan.tv.weather.WeatherNow
import ru.titan.tv.weather.parseWeatherNow
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/** What pressing «Позвать администратора» did. */
enum class StaffCall { SENT, ALREADY_CALLED, UNAVAILABLE }

/**
 * The room and weather as the UI sees them, plus the actions that change them.
 * Lives for the whole app so the launcher and the room overlay share one connection.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SmartHome(private val configRepository: ConfigRepository, private val scope: CoroutineScope) {

    private val http = OkHttpClient.Builder()
        .connectTimeout(CONNECT_TIMEOUT_S, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS) // a web socket idles for hours; pings detect a dead link
        .pingInterval(PING_INTERVAL_S, TimeUnit.SECONDS)
        .build()

    private val _config = MutableStateFlow(ConfigState(EMPTY_CONFIG, problem = null))
    val config: StateFlow<ConfigState> = _config.asStateFlow()

    private val client = MutableStateFlow<HaClient?>(null)
    private val pendingPercent = MutableStateFlow<Map<String, Int>>(emptyMap())
    private val pendingTarget = MutableStateFlow<Map<String, Int>>(emptyMap())
    private val debounced = mutableMapOf<String, Job>()
    private var lastStaffCallAt = 0L

    private val states: Flow<Map<String, EntityState>> = client.flatMapLatest { it?.states ?: flowOf(emptyMap()) }
    private val status: Flow<HaStatus> = client.flatMapLatest { it?.status ?: flowOf(HaStatus.NotConfigured) }

    val room: StateFlow<RoomUi> = combine(_config, states, status, pendingPercent, pendingTarget) { config, states, status, percent, target ->
        buildRoomUi(config.config.room, states, status, percent, target, config.problem)
    }.stateIn(scope, SharingStarted.Eagerly, buildRoomUi(null, emptyMap(), HaStatus.NotConfigured, emptyMap(), emptyMap(), null))

    /** The weather right now, shown under the clock; null without a weather entity or while it is unavailable. */
    val weather: StateFlow<WeatherNow?> = combine(_config, states) { config, states ->
        config.config.weather?.let { parseWeatherNow(states[it.entityId]) }
    }.stateIn(scope, SharingStarted.Eagerly, null)

    /** Picks up a config.json pushed over adb and reconnects when the Home Assistant part changed. */
    fun reload() {
        scope.launch {
            val loaded = withContext(Dispatchers.IO) { configRepository.load() }
            apply(loaded)
        }
    }

    private fun apply(result: ConfigState) {
        val previous = _config.value.config
        // A storage hiccup must not disconnect a working setup
        val loaded = if (result.config === EMPTY_CONFIG && result.problem != null) result.copy(config = previous) else result
        _config.value = loaded
        val changed = loaded.config.homeAssistant != previous.homeAssistant ||
            watchedEntities(loaded.config) != watchedEntities(previous)
        if (changed || client.value == null) connect(loaded.config) else client.value?.start()
    }

    /** Lights and the switches that drive them both answer to their own domain's toggle. */
    fun toggleLight(entityId: String) {
        call(entityId.substringBefore('.'), "toggle", entityId)
    }

    /** Shows the new brightness at once and sends it after the remote goes quiet. */
    fun stepLight(entityId: String, delta: Int) {
        val light = room.value.lights.firstOrNull { it.entityId == entityId } ?: return
        if (!light.isAvailable) return
        if (!light.isDimmable) {
            call(entityId.substringBefore('.'), if (delta > 0) "turn_on" else "turn_off", entityId)
            return
        }
        val percent = steppedBrightness(light.isOn, light.percent, delta)
        pendingPercent.update { it + (entityId to percent) }
        debounce(entityId, BRIGHTNESS_DEBOUNCE_MS) {
            val ha = client.value
            if (percent == 0) {
                ha?.callService("light", "turn_off", entityId)
            } else {
                ha?.callService("light", "turn_on", entityId, mapOf("brightness_pct" to percent))
            }
            delay(PENDING_HOLD_MS)
            pendingPercent.update { it - entityId }
        }
    }

    fun setLightColor(entityId: String, data: Map<String, Any>) {
        call("light", "turn_on", entityId, data)
    }

    fun activateScene(entityId: String) {
        call(entityId.substringBefore('.'), "turn_on", entityId)
    }

    fun toggleClimate() {
        val climate = room.value.climate?.takeIf { it.isAvailable } ?: return
        if (climate.isOn) {
            call("climate", "turn_off", climate.entityId)
        } else {
            // IR units forget nothing but cannot report the last mode themselves; Home Assistant remembers it
            scope.launch {
                val state = client.value?.states?.value?.get(climate.entityId)
                client.value?.callService("climate", "set_hvac_mode", climate.entityId, mapOf("hvac_mode" to resumeMode(state)))
            }
        }
    }

    /** Shows the new temperature at once and sends it after the remote goes quiet, like brightness. */
    fun stepClimate(direction: Int) {
        val climate = room.value.climate?.takeIf { it.isAvailable } ?: return
        val target = steppedTarget(climate, direction)
        pendingTarget.update { it + (climate.entityId to target) }
        debounce(climate.entityId, CLIMATE_DEBOUNCE_MS) {
            client.value?.callService("climate", "set_temperature", climate.entityId, mapOf("temperature" to target))
            delay(PENDING_HOLD_MS)
            pendingTarget.update { it - climate.entityId }
        }
    }

    fun setClimateMode(mode: String) {
        val climate = room.value.climate ?: return
        call("climate", "set_hvac_mode", climate.entityId, mapOf("hvac_mode" to mode))
    }

    fun setFanMode(mode: String) {
        val climate = room.value.climate ?: return
        call("climate", "set_fan_mode", climate.entityId, mapOf("fan_mode" to mode))
    }

    /** Runs the room's call-staff action; a second press within a minute only reassures the guest. */
    fun callStaff(): StaffCall {
        val action = _config.value.config.room?.callStaff ?: return StaffCall.UNAVAILABLE
        if (room.value.status != HaStatus.Connected) return StaffCall.UNAVAILABLE
        val now = SystemClock.elapsedRealtime()
        if (lastStaffCallAt != 0L && now - lastStaffCallAt < STAFF_CALL_COOLDOWN_MS) return StaffCall.ALREADY_CALLED
        lastStaffCallAt = now
        call(action.domain, action.service, action.entityId)
        return StaffCall.SENT
    }

    fun tvPower() {
        val action = _config.value.config.room?.tvPower ?: return
        call(action.domain, action.service, action.entityId)
    }

    private fun call(domain: String, service: String, entityId: String?, data: Map<String, Any> = emptyMap()) {
        scope.launch { client.value?.callService(domain, service, entityId, data) }
    }

    // A held remote key sends one command for where it stopped, not one per step
    private fun debounce(key: String, delayMs: Long, block: suspend () -> Unit) {
        debounced.remove(key)?.cancel()
        debounced[key] = scope.launch {
            delay(delayMs)
            block()
        }
    }

    private fun connect(config: TitanConfig) {
        client.value?.stop()
        val ha = config.homeAssistant
        val next = ha?.let { HaClient(it, watchedEntities(config), http, scope) }
        client.value = next
        next?.start()
    }

    private fun watchedEntities(config: TitanConfig): Set<String> = buildSet {
        config.room?.let { room ->
            room.lights.forEach { add(it.entityId) }
            room.scenes.forEach { add(it.entityId) }
            room.climate?.let { add(it.entityId) }
            room.temperatureEntity?.let(::add)
            room.humidityEntity?.let(::add)
        }
        config.weather?.let { add(it.entityId) }
    }

    private companion object {
        const val CONNECT_TIMEOUT_S = 10L
        const val PING_INTERVAL_S = 30L
        const val BRIGHTNESS_DEBOUNCE_MS = 250L
        // An IR unit beeps for every command; one per settled choice is enough
        const val CLIMATE_DEBOUNCE_MS = 700L
        const val PENDING_HOLD_MS = 1_500L
        const val STAFF_CALL_COOLDOWN_MS = 60_000L
    }
}
