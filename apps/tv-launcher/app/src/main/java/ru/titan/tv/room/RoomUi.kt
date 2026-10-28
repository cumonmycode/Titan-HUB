package ru.titan.tv.room

import ru.titan.tv.config.RoomConfig
import ru.titan.tv.ha.EntityState
import ru.titan.tv.ha.HaStatus
import java.util.Locale
import kotlin.math.roundToInt

data class SceneUi(val entityId: String, val name: String, val icon: String)

data class RoomUi(
    val name: String,
    val status: HaStatus,
    val lights: List<LightUi>,
    val scenes: List<SceneUi>,
    val activeSceneId: String?,
    val climate: ClimateUi?,
    /** Room temperature and humidity from sensors, when the config names any. */
    val climateLine: String?,
    val hasTvPower: Boolean,
    val canCallStaff: Boolean,
    val problem: String?,
) {
    val lightsOn: Int get() = lights.count { it.isOn }
}

private const val DEFAULT_ROOM_NAME = "Кабинка"
private val RUSSIAN = Locale.forLanguageTag("ru")

/**
 * [pendingPercent] and [pendingTarget] hold brightness and temperatures the remote just set,
 * shown until Home Assistant confirms them.
 */
fun buildRoomUi(
    room: RoomConfig?,
    states: Map<String, EntityState>,
    status: HaStatus,
    pendingPercent: Map<String, Int>,
    pendingTarget: Map<String, Int>,
    problem: String?,
): RoomUi = RoomUi(
    name = room?.name ?: DEFAULT_ROOM_NAME,
    status = status,
    lights = room?.lights.orEmpty().map { light ->
        val ui = lightUi(light, states[light.entityId])
        pendingPercent[light.entityId]?.let { ui.copy(isOn = it > 0, percent = it) } ?: ui
    },
    scenes = room?.scenes.orEmpty().map { SceneUi(it.entityId, it.name, it.icon) },
    activeSceneId = room?.let { activeSceneId(it.scenes, states) },
    climate = room?.climate?.let { climateUi(it, states[it.entityId], pendingTarget[it.entityId]) },
    climateLine = room?.let {
        climateLine(it.temperatureEntity?.let(states::get), it.humidityEntity?.let(states::get))
    },
    hasTvPower = room?.tvPower != null,
    canCallStaff = room?.callStaff != null,
    problem = problem,
)

private fun climateLine(temperature: EntityState?, humidity: EntityState?): String? = listOfNotNull(
    temperature?.state?.toDoubleOrNull()?.let { String.format(RUSSIAN, "%.1f°", it) },
    humidity?.state?.toDoubleOrNull()?.let { "влажность ${it.roundToInt()}%" },
).joinToString(" · ").ifEmpty { null }
