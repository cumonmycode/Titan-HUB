package ru.titan.tv.ui.sheets

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.toSize
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ru.titan.tv.apps.DEFAULT_ART_COLORS
import ru.titan.tv.ha.HaStatus
import ru.titan.tv.home.SmartHome
import ru.titan.tv.home.TvControls
import ru.titan.tv.home.TvKey
import ru.titan.tv.room.ClimateUi
import ru.titan.tv.room.ColorPreset
import ru.titan.tv.room.LightUi
import ru.titan.tv.room.RoomUi
import ru.titan.tv.room.SceneUi
import ru.titan.tv.room.fanModeLabel
import ru.titan.tv.room.hvacModeIcon
import ru.titan.tv.room.hvacModeLabel
import ru.titan.tv.ui.LocalStage
import ru.titan.tv.ui.glass.Backdrop
import ru.titan.tv.ui.glass.Glass
import ru.titan.tv.ui.glass.Lens
import ru.titan.tv.ui.icons.TitanIcon
import ru.titan.tv.ui.theme.Ink
import ru.titan.tv.ui.theme.Type

private const val LEVEL_STEP = 10
private val IDLE_FILL = Color.White.copy(alpha = 0.08f)
private val ACTIVE_FILL = Color.White.copy(alpha = 0.93f)
private val ROW_FILL = Color.White.copy(alpha = 0.07f)
private val CLIMATE_ON = Brush.horizontalGradient(listOf(Ink.Accent.copy(alpha = 0.28f), Ink.Accent.copy(alpha = 0.6f)))

private const val SWATCH = 46

private enum class Hint(val text: String) {
    SCENE("OK — включить сцену"),
    LIGHT("← → яркость · OK — включить или выключить"),
    SWITCH("OK — включить или выключить"),
    COLOR_LIGHT("← → яркость · OK — вкл/выкл · ↓ цвет"),
    CLIMATE("← → температура · OK — включить или выключить"),
    TV("OK — нажать"),
}

private data class TvButton(val key: TvKey, val label: String, val icon: String)

private val TV_BUTTONS = listOf(
    TvButton(TvKey.VOLUME_DOWN, "Тише", "minus"),
    TvButton(TvKey.VOLUME_UP, "Громче", "plus"),
    TvButton(TvKey.MUTE, "Без звука", "mute"),
    TvButton(TvKey.POWER, "Выключить", "power"),
)

fun roomActions(home: SmartHome, tv: TvControls) = RoomActions(
    toggleLight = home::toggleLight,
    stepLight = home::stepLight,
    setColor = home::setLightColor,
    activateScene = home::activateScene,
    toggleClimate = home::toggleClimate,
    stepClimate = home::stepClimate,
    setClimateMode = home::setClimateMode,
    setFanMode = home::setFanMode,
    pressTv = { key -> if (key == TvKey.POWER) home.tvPower() else tv.press(key) },
)

/** «Свет и климат»: the booth's lights, its air conditioner and the TV's volume. */
@Composable
fun RoomSheet(room: RoomUi, backdrop: Backdrop, actions: RoomActions, modifier: Modifier = Modifier) {
    val s = LocalStage.current
    val firstFocus = remember { FocusRequester() }
    var hint by remember { mutableStateOf(Hint.SWITCH.text) }
    val firstLight = room.lights.indexOfFirst { it.isAvailable }
    val climateFirst = firstLight < 0 && room.climate?.isAvailable == true
    LaunchedEffect(Unit) {
        withFrameNanos { }
        firstFocus.requestSafely()
    }
    Glass(backdrop, s.dp(46), Lens.sheet(), modifier.size(s.dp(660), s.dp(900))) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(start = s.dp(32), end = s.dp(32), top = s.dp(32), bottom = s.dp(88)),
            verticalArrangement = Arrangement.spacedBy(s.dp(26)),
        ) {
            RoomHeader(room)
            if (room.scenes.isNotEmpty()) {
                Column {
                    SectionLabel("Сцены")
                    SceneRow(room, actions, if (firstLight < 0 && !climateFirst) firstFocus else null) { hint = Hint.SCENE.text }
                }
            }
            if (room.lights.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(s.dp(12))) {
                    SectionLabel("Свет", "${room.lightsOn} из ${room.lights.size} включено")
                    room.lights.forEachIndexed { index, light ->
                        LightRow(
                            light = light,
                            focusRequester = if (index == firstLight) firstFocus else null,
                            onToggle = { actions.toggleLight(light.entityId) },
                            onStep = { delta -> actions.stepLight(light.entityId, delta) },
                            onFocused = {
                                hint = when {
                                    !light.isDimmable -> Hint.SWITCH
                                    light.presets.isEmpty() -> Hint.LIGHT
                                    else -> Hint.COLOR_LIGHT
                                }.text
                            },
                        )
                        if (light.isAvailable && light.presets.isNotEmpty()) {
                            ColorStrip(
                                presets = light.presets,
                                onPick = { preset -> actions.setColor(light.entityId, preset.data) },
                                onFocused = { preset -> hint = "← → цвет · OK — «${preset.name}»" },
                            )
                        }
                    }
                }
            }
            room.climate?.let { climate ->
                ClimateBlock(climate, actions, if (climateFirst) firstFocus else null) { hint = it }
            }
            Column {
                SectionLabel("Телевизор")
                val tvFocus = if (firstLight < 0 && !climateFirst && room.scenes.isEmpty()) firstFocus else null
                TvRow(room.hasTvPower, actions, tvFocus) { hint = Hint.TV.text }
            }
        }
        BasicText(
            hint,
            style = Type.caption(s).copy(color = Ink.Tertiary, textAlign = TextAlign.Center),
            modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(bottom = s.dp(28)),
        )
    }
}

@Composable
private fun RoomHeader(room: RoomUi) {
    val s = LocalStage.current
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(s.dp(16))) {
        Column(Modifier.weight(1f)) {
            BasicText(room.name, style = Type.title(s))
            BasicText(
                subline(room),
                style = Type.caption(s).copy(fontSize = s.sp(21)),
                modifier = Modifier.padding(top = s.dp(10)),
            )
        }
        Box(Modifier.padding(top = s.dp(20)).size(s.dp(12)).clip(CircleShape).background(statusColor(room.status)))
    }
}

private fun subline(room: RoomUi): String {
    room.problem?.let { return it }
    val status = when (val st = room.status) {
        HaStatus.NotConfigured -> "Умный дом не настроен"
        HaStatus.Connecting -> "Подключаюсь к умному дому…"
        is HaStatus.Offline -> "Нет связи с умным домом"
        is HaStatus.AuthFailed -> "Умный дом не принял ключ: ${st.reason}"
        HaStatus.Connected -> null
    }
    if (status != null) return status
    val scene = room.scenes.firstOrNull { it.entityId == room.activeSceneId }?.let { "Сцена «${it.name}»" }
    return listOfNotNull(scene, room.climateLine).joinToString(" · ").ifEmpty { "Свет и климат в кабинке" }
}

private fun statusColor(status: HaStatus): Color = when (status) {
    HaStatus.Connected -> Ink.Ok
    HaStatus.Connecting, is HaStatus.Offline -> Ink.Pending
    is HaStatus.AuthFailed -> Ink.Error
    HaStatus.NotConfigured -> Ink.Tertiary
}

@Composable
private fun SceneRow(room: RoomUi, actions: RoomActions, firstFocus: FocusRequester?, onFocused: () -> Unit) {
    val s = LocalStage.current
    Row(horizontalArrangement = Arrangement.spacedBy(s.dp(16))) {
        room.scenes.forEachIndexed { index, scene ->
            SceneCapsule(
                scene = scene,
                active = scene.entityId == room.activeSceneId,
                focusRequester = if (index == 0) firstFocus else null,
                onFocused = onFocused,
                onClick = { actions.activateScene(scene.entityId) },
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun SceneCapsule(
    scene: SceneUi,
    active: Boolean,
    focusRequester: FocusRequester?,
    onFocused: () -> Unit,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val s = LocalStage.current
    var focused by remember { mutableStateOf(false) }
    val lift by rememberFocusLift(focused)
    val ink = if (active) Ink.OnLight else Ink.Primary
    Column(
        modifier
            .height(s.dp(100))
            .focusPop({ lift }, scale = 1.08f, corner = s.dp(26))
            .clip(RoundedCornerShape(s.dp(26)))
            .background(if (active) ACTIVE_FILL else IDLE_FILL)
            .then(focusRequester?.let { Modifier.focusRequester(it) } ?: Modifier)
            .onFocusChanged {
                focused = it.isFocused
                if (it.isFocused) onFocused()
            }
            .clickable(remember { MutableInteractionSource() }, indication = null, onClick = onClick),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        TitanIcon(scene.icon, s.dp(34), ink)
        BasicText(
            scene.name,
            style = Type.pill(s).copy(fontSize = s.sp(20), color = ink),
            modifier = Modifier.padding(top = s.dp(8)),
        )
    }
}

@Composable
private fun LightRow(
    light: LightUi,
    focusRequester: FocusRequester?,
    onToggle: () -> Unit,
    onStep: (Int) -> Unit,
    onFocused: () -> Unit,
) {
    val s = LocalStage.current
    var focused by remember { mutableStateOf(false) }
    val lift by rememberFocusLift(focused)
    val fill by animateFloatAsState(light.percent / 100f, tween(200), label = "brightness")
    val color = Color(light.colorArgb)
    Box(
        Modifier
            .fillMaxWidth()
            .height(s.dp(80))
            .focusPop({ lift }, scale = 1.035f, corner = s.dp(26))
            .clip(RoundedCornerShape(s.dp(26)))
            .background(ROW_FILL)
            .then(focusRequester?.let { Modifier.focusRequester(it) } ?: Modifier)
            .onFocusChanged {
                focused = it.isFocused
                if (it.isFocused) onFocused()
            }
            // Left and right change brightness instead of moving focus out of the row
            .onPreviewKeyEvent { event ->
                if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                when (event.key) {
                    Key.DirectionLeft -> onStep(-LEVEL_STEP).let { true }
                    Key.DirectionRight -> onStep(LEVEL_STEP).let { true }
                    else -> false
                }
            }
            .clickable(remember { MutableInteractionSource() }, indication = null, enabled = light.isAvailable, onClick = onToggle),
    ) {
        if (light.isOn) {
            Box(
                Modifier
                    .fillMaxHeight()
                    .fillMaxWidth(fill)
                    .background(Brush.horizontalGradient(listOf(color.copy(alpha = 0.22f), color.copy(alpha = 0.52f)))),
            )
        }
        Row(
            Modifier.fillMaxSize().padding(start = s.dp(14), end = s.dp(24)),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(s.dp(18)),
        ) {
            Box(
                Modifier.size(s.dp(52)).clip(CircleShape).background(if (light.isOn) color else IDLE_FILL.copy(alpha = 0.12f)),
                contentAlignment = Alignment.Center,
            ) {
                TitanIcon(light.icon, s.dp(28), if (light.isOn) Ink.OnLamp else Ink.Secondary)
            }
            Column(Modifier.weight(1f)) {
                BasicText(light.name, style = Type.pill(s))
                BasicText(light.detail, style = Type.caption(s), modifier = Modifier.padding(top = s.dp(5)))
            }
            BasicText(
                when {
                    !light.isOn -> "Выкл"
                    light.isDimmable -> "${light.percent}%"
                    else -> "Вкл"
                },
                style = Type.number(s, 32).copy(color = if (light.isOn) Ink.Primary else Ink.Tertiary),
            )
        }
    }
}

/** Colour swatches under a light that can change colour; down from the light reaches them. */
@Composable
private fun ColorStrip(presets: List<ColorPreset>, onPick: (ColorPreset) -> Unit, onFocused: (ColorPreset) -> Unit) {
    val s = LocalStage.current
    Row(
        Modifier.fillMaxWidth().padding(horizontal = s.dp(8)),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        presets.forEach { preset -> Swatch(preset, onClick = { onPick(preset) }, onFocused = { onFocused(preset) }) }
    }
}

@Composable
private fun Swatch(preset: ColorPreset, onClick: () -> Unit, onFocused: () -> Unit) {
    val s = LocalStage.current
    var focused by remember { mutableStateOf(false) }
    val lift by rememberFocusLift(focused)
    Box(
        Modifier
            .size(s.dp(SWATCH))
            .focusPop({ lift }, scale = 1.25f, corner = s.dp(SWATCH / 2))
            .clip(CircleShape)
            .background(Color(preset.swatchArgb))
            .onFocusChanged {
                focused = it.isFocused
                if (it.isFocused) onFocused()
            }
            .clickable(remember { MutableInteractionSource() }, indication = null, onClick = onClick),
    )
}

/** The air conditioner: a row for power and temperature, then its modes and fan speeds as capsules. */
@Composable
private fun ClimateBlock(climate: ClimateUi, actions: RoomActions, focusRequester: FocusRequester?, onHint: (String) -> Unit) {
    val s = LocalStage.current
    Column(verticalArrangement = Arrangement.spacedBy(s.dp(14))) {
        SectionLabel(climate.name, if (climate.isOn) hvacModeLabel(climate.mode) else "Выключен")
        ClimateRow(climate, actions, focusRequester) { onHint(Hint.CLIMATE.text) }
        if (climate.isAvailable && climate.modes.isNotEmpty()) {
            CapsuleStrip(
                options = climate.modes.map { it to hvacModeLabel(it) },
                selected = climate.mode.takeIf { climate.isOn },
                onPick = actions.setClimateMode,
                onFocused = { label -> onHint("OK — режим «$label»") },
            )
        }
        if (climate.isAvailable && climate.fanModes.isNotEmpty()) {
            CapsuleStrip(
                options = climate.fanModes.map { it to fanModeLabel(it) },
                selected = climate.fanMode,
                icon = "fan",
                onPick = actions.setFanMode,
                onFocused = { label -> onHint("OK — обдув «$label»") },
            )
        }
    }
}

@Composable
private fun ClimateRow(climate: ClimateUi, actions: RoomActions, focusRequester: FocusRequester?, onFocused: () -> Unit) {
    val s = LocalStage.current
    var focused by remember { mutableStateOf(false) }
    val lift by rememberFocusLift(focused)
    Box(
        Modifier
            .fillMaxWidth()
            .height(s.dp(96))
            .focusPop({ lift }, scale = 1.035f, corner = s.dp(28))
            .clip(RoundedCornerShape(s.dp(28)))
            .background(ROW_FILL)
            .then(if (climate.isOn) Modifier.background(CLIMATE_ON) else Modifier)
            .then(focusRequester?.let { Modifier.focusRequester(it) } ?: Modifier)
            .onFocusChanged {
                focused = it.isFocused
                if (it.isFocused) onFocused()
            }
            .onPreviewKeyEvent { event ->
                if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                when (event.key) {
                    Key.DirectionLeft -> actions.stepClimate(-1).let { true }
                    Key.DirectionRight -> actions.stepClimate(1).let { true }
                    else -> false
                }
            }
            .clickable(remember { MutableInteractionSource() }, indication = null, enabled = climate.isAvailable, onClick = actions.toggleClimate),
    ) {
        Row(
            Modifier.fillMaxSize().padding(start = s.dp(16), end = s.dp(26)),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(s.dp(18)),
        ) {
            Box(
                Modifier.size(s.dp(60)).clip(CircleShape).background(if (climate.isOn) Ink.Accent else IDLE_FILL.copy(alpha = 0.12f)),
                contentAlignment = Alignment.Center,
            ) {
                TitanIcon(if (climate.isOn) hvacModeIcon(climate.mode) else "power", s.dp(30), if (climate.isOn) Ink.Primary else Ink.Secondary)
            }
            Column(Modifier.weight(1f)) {
                BasicText(if (climate.isOn) "Работает" else "Выключен", style = Type.pill(s))
                BasicText(
                    when {
                        !climate.isAvailable -> "Недоступен"
                        climate.current != null -> "В кабинке ${climate.current.toInt()}°"
                        else -> "OK — ${if (climate.isOn) "выключить" else "включить"}"
                    },
                    style = Type.caption(s),
                    modifier = Modifier.padding(top = s.dp(5)),
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(s.dp(10))) {
                TitanIcon("back", s.dp(24), Ink.Tertiary)
                BasicText(
                    climate.target?.let { "$it°" } ?: "—",
                    style = Type.number(s, 44).copy(color = if (climate.isOn) Ink.Primary else Ink.Secondary),
                )
                TitanIcon("chev", s.dp(24), Ink.Tertiary)
            }
        }
    }
}

/** A row of small capsules where one is chosen; it is filled with the club's violet. */
@Composable
private fun CapsuleStrip(
    options: List<Pair<String, String>>,
    selected: String?,
    onPick: (String) -> Unit,
    onFocused: (String) -> Unit,
    icon: String? = null,
) {
    val s = LocalStage.current
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(s.dp(10)), verticalAlignment = Alignment.CenterVertically) {
        if (icon != null) TitanIcon(icon, s.dp(28), Ink.Tertiary, Modifier.padding(horizontal = s.dp(6)))
        options.forEach { (value, label) ->
            Capsule(label, value == selected, Modifier.weight(1f), onClick = { onPick(value) }, onFocused = { onFocused(label) })
        }
    }
}

@Composable
private fun Capsule(label: String, chosen: Boolean, modifier: Modifier, onClick: () -> Unit, onFocused: () -> Unit) {
    val s = LocalStage.current
    var focused by remember { mutableStateOf(false) }
    val lift by rememberFocusLift(focused)
    Box(
        modifier
            .height(s.dp(56))
            .focusPop({ lift }, scale = 1.08f, corner = s.dp(28))
            .clip(RoundedCornerShape(s.dp(28)))
            .background(if (chosen) Ink.Accent else IDLE_FILL)
            .onFocusChanged {
                focused = it.isFocused
                if (it.isFocused) onFocused()
            }
            .clickable(remember { MutableInteractionSource() }, indication = null, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        BasicText(label, style = Type.pill(s).copy(fontSize = s.sp(19), color = if (chosen) Ink.Primary else Ink.Secondary), maxLines = 1)
    }
}

@Composable
private fun TvRow(hasPower: Boolean, actions: RoomActions, firstFocus: FocusRequester?, onFocused: () -> Unit) {
    val s = LocalStage.current
    val buttons = TV_BUTTONS.filter { it.key != TvKey.POWER || hasPower }
    Row(
        Modifier.fillMaxWidth().padding(horizontal = s.dp(12)),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        buttons.forEachIndexed { index, button ->
            TvButtonView(button, if (index == 0) firstFocus else null, onFocused) { actions.pressTv(button.key) }
        }
    }
}

@Composable
private fun TvButtonView(button: TvButton, focusRequester: FocusRequester?, onFocused: () -> Unit, onClick: () -> Unit) {
    val s = LocalStage.current
    var focused by remember { mutableStateOf(false) }
    val lift by rememberFocusLift(focused)
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier
                .size(s.dp(92))
                .focusPop({ lift }, scale = 1.12f, corner = s.dp(46))
                .clip(CircleShape)
                .background(Color.White.copy(alpha = 0.1f))
                .then(focusRequester?.let { Modifier.focusRequester(it) } ?: Modifier)
                .onFocusChanged {
                    focused = it.isFocused
                    if (it.isFocused) onFocused()
                }
                .clickable(remember { MutableInteractionSource() }, indication = null, onClick = onClick),
            contentAlignment = Alignment.Center,
        ) {
            TitanIcon(button.icon, s.dp(36), if (button.key == TvKey.POWER) Ink.Error else Ink.Primary)
        }
        BasicText(button.label, style = Type.caption(s).copy(fontSize = s.sp(17)), modifier = Modifier.padding(top = s.dp(10)))
    }
}

/** The room sheet alone, over whatever app is playing. */
@Composable
fun RoomOverlay(home: SmartHome, tv: TvControls, onClose: () -> Unit) {
    val s = LocalStage.current
    val room by home.room.collectAsStateWithLifecycle()
    val backdrop = remember { Backdrop(DEFAULT_ART_COLORS) }
    val actions = remember(home, tv) { roomActions(home, tv) }
    BackHandler(onBack = onClose)
    Box(
        Modifier
            .fillMaxSize()
            .onSizeChanged { backdrop.screenSize = it.toSize() }
            .background(Brush.horizontalGradient(0.45f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.55f))),
    ) {
        RoomSheet(room, backdrop, actions, Modifier.align(Alignment.TopEnd).padding(top = s.dp(90), end = s.dp(96)))
    }
}
