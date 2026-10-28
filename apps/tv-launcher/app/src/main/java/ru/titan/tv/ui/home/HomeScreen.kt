package ru.titan.tv.ui.home

import android.view.KeyEvent
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.toSize
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.currentStateAsState
import ru.titan.tv.HomeViewModel
import ru.titan.tv.apps.DEFAULT_ART_COLORS
import ru.titan.tv.home.StaffCall
import ru.titan.tv.ui.LocalStage
import ru.titan.tv.ui.airplay.NowPlayingPanel
import ru.titan.tv.ui.cinema.CinemaScreen
import ru.titan.tv.ui.cinema.rememberBannerCache
import ru.titan.tv.ui.glass.Backdrop
import ru.titan.tv.ui.glass.BackdropArt
import ru.titan.tv.ui.glass.Glass
import ru.titan.tv.ui.glass.Lens
import ru.titan.tv.ui.saver.SaverHint
import ru.titan.tv.ui.saver.Screensaver
import ru.titan.tv.ui.sheets.AppsSheet
import ru.titan.tv.ui.sheets.RoomSheet
import ru.titan.tv.ui.sheets.SheetFrame
import ru.titan.tv.ui.sheets.SourcesSheet
import ru.titan.tv.ui.sheets.requestSafely
import ru.titan.tv.ui.sheets.roomActions
import ru.titan.tv.ui.theme.Type
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.onStart

private enum class Sheet { NONE, ROOM, APPS, SOURCES }

private const val SHEET_DIM = 0.45f
private const val CROSSFADE_SETTLE_MS = 150L
private const val NOTE_MS = 3_000L

// The screensaver comes up after this long without a key on the home screen
private const val IDLE_MS = 120_000L

// How long the call chip says «Администратор идёт» after a call
private const val STAFF_CALLED_MS = 60_000L

// The remote's Assistant button and its relatives open the room controls
private val ROOM_KEYS = setOf(KeyEvent.KEYCODE_ASSIST, KeyEvent.KEYCODE_VOICE_ASSIST, KeyEvent.KEYCODE_SEARCH)

private val SHADE = Brush.horizontalGradient(
    0f to Color.Black.copy(alpha = 0.55f),
    0.55f to Color.Black.copy(alpha = 0.12f),
    0.75f to Color.Transparent,
)
private val SHADE_BOTTOM = Brush.verticalGradient(
    0.52f to Color.Transparent,
    1f to Color.Black.copy(alpha = 0.62f),
)

// Painted into the backdrop's cached texture
private val SCRIMS = listOf(SHADE, SHADE_BOTTOM)

// The soft art loses nothing visible at half resolution, and the TV GPU paints a quarter of the pixels
private const val SCENERY_RESOLUTION = 0.5f

/**
 * The backdrop rendered into one half-resolution texture stretched to the screen, so every frame the weak
 * TV GPU copies a quarter of the pixels.
 */
@Composable
private fun Scenery(backdrop: Backdrop) {
    Box(
        Modifier
            .fillMaxSize(SCENERY_RESOLUTION)
            .graphicsLayer {
                scaleX = 1f / SCENERY_RESOLUTION
                scaleY = 1f / SCENERY_RESOLUTION
                transformOrigin = TransformOrigin(0f, 0f)
                compositingStrategy = CompositingStrategy.Offscreen
            },
    ) {
        BackdropArt(backdrop, Modifier.fillMaxSize(), scrims = SCRIMS)
    }
}

/** A short confirmation at the bottom of the screen; [id] makes a repeated text show again. */
private data class Note(val text: String, val id: Long)

@Composable
fun HomeScreen(viewModel: HomeViewModel) {
    val s = LocalStage.current
    val homeApps by viewModel.homeApps.collectAsStateWithLifecycle()
    val allApps by viewModel.allApps.collectAsStateWithLifecycle()
    val cinemaApps by viewModel.cinemaApps.collectAsStateWithLifecycle()
    val room by viewModel.smartHome.room.collectAsStateWithLifecycle()
    val weather by viewModel.smartHome.weather.collectAsStateWithLifecycle()
    val config by viewModel.smartHome.config.collectAsStateWithLifecycle()
    val airplay by viewModel.airplay.collectAsStateWithLifecycle()
    val sources by viewModel.sources.collectAsStateWithLifecycle()
    val lifecycle by LocalLifecycleOwner.current.lifecycle.currentStateAsState()
    val resumed = lifecycle.isAtLeast(Lifecycle.State.RESUMED)

    var sheet by remember { mutableStateOf(Sheet.NONE) }
    var cinemaOpen by remember { mutableStateOf(false) }
    var saver by remember { mutableStateOf(false) }
    var focusedPackage by rememberSaveable { mutableStateOf<String?>(null) }
    var returnFocus by remember { mutableStateOf<FocusRequester?>(null) }
    var dockRefocus by remember { mutableIntStateOf(0) }
    var note by remember { mutableStateOf(Note("", 0L)) }
    var noteVisible by remember { mutableStateOf(false) }
    var playerHasFocus by remember { mutableStateOf(false) }
    var staffCalledAt by remember { mutableLongStateOf(0L) }
    var staffCalled by remember { mutableStateOf(false) }
    // A flow rather than a counter, so a burst of presses does not recompose the screen on every key
    val keyPresses = remember { MutableSharedFlow<Unit>(extraBufferCapacity = 1) }
    // The key that wakes the screensaver is swallowed up to its release, so it does not also press a button
    val swallowRelease = remember { BooleanArray(1) }
    val backdrop = remember { Backdrop(DEFAULT_ART_COLORS) }
    val dockFocus = remember { FocusRequester() }
    val topFocus = remember { TopBarFocus() }
    val actions = remember(viewModel) { roomActions(viewModel.smartHome, viewModel.tv) }
    val banners = rememberBannerCache(viewModel::largeBanner)
    val cinema = remember(cinemaApps) { cinemaApps.takeIf { it.isNotEmpty() }?.let(::cinemaTile) }
    val focusedApp = when (focusedPackage) {
        CINEMA_KEY -> cinema
        ALL_APPS_KEY -> ALL_APPS_TILE
        else -> homeApps.firstOrNull { it.packageName == focusedPackage }
    } ?: cinema ?: homeApps.firstOrNull()
    val hasRoom = config.config.room != null || config.problem != null
    val idle = sheet == Sheet.NONE && !cinemaOpen && !saver
    val airplayPlaying = airplay.nowPlaying?.isPlaying == true
    val dim by animateFloatAsState(if (sheet == Sheet.NONE) 0f else SHEET_DIM, tween(200), label = "dim")

    fun open(next: Sheet, from: FocusRequester) {
        returnFocus = from
        sheet = next
    }

    fun showNote(text: String) {
        note = Note(text, System.nanoTime())
    }

    fun callStaff() {
        when (viewModel.callStaff()) {
            StaffCall.SENT -> {
                staffCalledAt = System.nanoTime()
                showNote("Администратор скоро подойдёт")
            }
            StaffCall.ALREADY_CALLED -> showNote("Администратора уже позвали — он идёт")
            StaffCall.UNAVAILABLE -> showNote("Не получилось позвать: нет связи с умным домом")
        }
    }

    // Waits for the remote to settle so holding left/right does not restart a full-screen crossfade per tile
    LaunchedEffect(focusedApp?.colors) {
        delay(CROSSFADE_SETTLE_MS)
        focusedApp?.let { backdrop.showColors(it.colors) }
    }
    // Every key restarts the countdown; music over AirPlay or an open panel holds it off
    LaunchedEffect(resumed, idle, airplayPlaying) {
        if (!resumed || !idle || airplayPlaying) return@LaunchedEffect
        keyPresses.onStart { emit(Unit) }.collectLatest {
            delay(IDLE_MS)
            saver = true
        }
    }
    LaunchedEffect(staffCalledAt) {
        if (staffCalledAt == 0L) return@LaunchedEffect
        staffCalled = true
        delay(STAFF_CALLED_MS)
        staffCalled = false
    }
    LaunchedEffect(homeApps.isNotEmpty() || cinema != null, dockRefocus) {
        withFrameNanos { }
        dockFocus.requestSafely()
    }
    // Nobody touches the remote while music plays over AirPlay; the TV's sleep timer must not cut it off
    val view = LocalView.current
    DisposableEffect(airplayPlaying) {
        view.keepScreenOn = airplayPlaying
        onDispose { view.keepScreenOn = false }
    }
    // The player leaves when the music stops; focus on its buttons would be left nowhere
    LaunchedEffect(airplay.nowPlaying == null) {
        if (airplay.nowPlaying != null || !playerHasFocus) return@LaunchedEffect
        withFrameNanos { }
        dockFocus.requestSafely()
    }
    LaunchedEffect(sheet, cinemaOpen) {
        if (sheet != Sheet.NONE || cinemaOpen) return@LaunchedEffect
        val target = returnFocus ?: return@LaunchedEffect
        withFrameNanos { }
        target.requestSafely()
        returnFocus = null
    }
    LaunchedEffect(note.id) {
        if (note.id == 0L) return@LaunchedEffect
        noteVisible = true
        delay(NOTE_MS)
        noteVisible = false
    }
    LaunchedEffect(viewModel) {
        viewModel.wifiNotices.collect { showNote(it) }
    }
    LaunchedEffect(viewModel) {
        viewModel.homePresses.collect {
            saver = false
            cinemaOpen = false
            sheet = Sheet.NONE
            returnFocus = dockFocus
            keyPresses.tryEmit(Unit)
        }
    }
    BackHandler(enabled = sheet != Sheet.NONE) { sheet = Sheet.NONE }

    Box(
        Modifier
            // No background here: the backdrop covers every pixel and a fill under it would cost a full GPU pass
            .fillMaxSize()
            .onSizeChanged { backdrop.screenSize = it.toSize() }
            .onPreviewKeyEvent { event ->
                if (saver || swallowRelease[0]) {
                    when (event.type) {
                        KeyEventType.KeyDown -> {
                            saver = false
                            swallowRelease[0] = true
                            keyPresses.tryEmit(Unit)
                        }
                        KeyEventType.KeyUp -> swallowRelease[0] = false
                    }
                    return@onPreviewKeyEvent true
                }
                if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                keyPresses.tryEmit(Unit)
                val isRoomKey = event.nativeKeyEvent.keyCode in ROOM_KEYS
                if (isRoomKey && hasRoom && !cinemaOpen) {
                    if (sheet == Sheet.ROOM) sheet = Sheet.NONE else open(Sheet.ROOM, dockFocus)
                }
                isRoomKey
            },
    ) {
        Box(Modifier.fillMaxSize()) {
            Box(Modifier.fillMaxSize()) {
                Scenery(backdrop)
                HeroInfo(room.name.takeIf { hasRoom }, weather, Modifier.align(Alignment.TopStart).padding(start = s.dp(96), top = s.dp(52)))
                Shelf(focusedApp, Modifier.align(Alignment.BottomStart).padding(start = s.dp(96), bottom = s.dp(340)))
                Dock(
                    apps = homeApps,
                    cinema = cinema,
                    enabled = idle,
                    firstFocus = dockFocus,
                    // Focus can fall back onto a tile for a frame while a sheet opens; keep the shelf on the chosen app
                    onFocused = { if (sheet == Sheet.NONE) focusedPackage = it.packageName },
                    onOpen = viewModel::open,
                    onOpenCinema = {
                        returnFocus = dockFocus
                        cinemaOpen = true
                    },
                    onOpenAll = { open(Sheet.APPS, dockFocus) },
                    modifier = Modifier.align(Alignment.TopStart).offset(y = s.dp(772)),
                )
                TopBar(
                    backdrop = backdrop,
                    room = room.takeIf { hasRoom },
                    hasSources = sources.isNotEmpty(),
                    airplay = airplay,
                    staffCalled = staffCalled,
                    enabled = idle,
                    focus = topFocus,
                    onSources = { open(Sheet.SOURCES, topFocus.sources) },
                    onRoom = { open(Sheet.ROOM, topFocus.room) },
                    onCallStaff = ::callStaff,
                    modifier = Modifier.align(Alignment.TopEnd).padding(top = s.dp(54), end = s.dp(96)),
                )
                // Under the corner chips, in place of the AirPlay invitation
                NowPlayingPanel(
                    state = airplay,
                    enabled = idle,
                    onCommand = viewModel::sendAirPlay,
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(top = s.dp(142), end = s.dp(96))
                        .onFocusChanged { playerHasFocus = it.hasFocus },
                )
                Box(Modifier.fillMaxSize().graphicsLayer { alpha = dim }.background(Color.Black))
            }
            SheetFrame(sheet == Sheet.ROOM, Modifier.align(Alignment.TopEnd).padding(top = s.dp(132), end = s.dp(96))) {
                RoomSheet(room, backdrop, actions)
            }
            SheetFrame(sheet == Sheet.SOURCES, Modifier.align(Alignment.TopEnd).padding(top = s.dp(132), end = s.dp(96))) {
                SourcesSheet(
                    sources = sources,
                    backdrop = backdrop,
                    onOpen = { source ->
                        sheet = Sheet.NONE
                        viewModel.openSource(source)
                    },
                    onClose = { sheet = Sheet.NONE },
                )
            }
            SheetFrame(
                sheet == Sheet.APPS,
                Modifier.fillMaxSize().padding(horizontal = s.dp(64), vertical = s.dp(54)),
                origin = TransformOrigin(0.5f, 1f),
            ) {
                AppsSheet(
                    apps = allApps,
                    backdrop = backdrop,
                    onOpen = { app ->
                        sheet = Sheet.NONE
                        viewModel.open(app)
                    },
                )
            }
            AnimatedVisibility(
                visible = cinemaOpen,
                enter = fadeIn(tween(200)) + scaleIn(tween(240, easing = FastOutSlowInEasing), initialScale = 0.96f),
                exit = fadeOut(tween(180)),
            ) {
                CinemaScreen(
                    apps = cinemaApps,
                    banner = banners,
                    onOpen = { app ->
                        cinemaOpen = false
                        viewModel.open(app)
                    },
                    onClose = { cinemaOpen = false },
                )
            }
            AnimatedVisibility(
                visible = noteVisible,
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = s.dp(48)),
                enter = fadeIn(tween(200)) + slideInVertically(tween(200)) { it / 2 },
                exit = fadeOut(tween(180)),
            ) {
                Glass(backdrop, s.dp(32), Lens.chip(), Modifier.height(s.dp(64))) {
                    BasicText(note.text, style = Type.pill(s), modifier = Modifier.align(Alignment.Center).padding(horizontal = s.dp(30)))
                }
            }
            AnimatedVisibility(visible = saver, enter = fadeIn(tween(700)), exit = fadeOut(tween(250))) {
                Screensaver(room.name.takeIf { hasRoom }, saverHints(room.canCallStaff, room.climate != null, airplay.receiverName, cinemaApps.map { it.label }, sources.isNotEmpty()))
            }
        }
    }
}

/** What the screensaver suggests, one line at a time; only what this booth actually offers. */
private fun saverHints(
    canCallStaff: Boolean,
    hasClimate: Boolean,
    airplayName: String?,
    cinemas: List<String>,
    hasSources: Boolean,
): List<SaverHint> = listOfNotNull(
    SaverHint(
        icon = "bulb",
        title = if (hasClimate) "Свет и кондиционер — с телевизора" else "Свет — с телевизора",
        detail = "Кнопка «Свет и климат» вверху главного экрана",
    ),
    airplayName?.let { SaverHint("airplay", "Слушайте свою музыку через AirPlay", "На iPhone выберите «$it» в списке AirPlay") },
    cinemas.takeIf { it.isNotEmpty() }?.let { SaverHint("film", "Фильмы и сериалы", it.joinToString(", ") + " — на первой плитке") },
    SaverHint("bell", "Нужна помощь?", "Кнопка «Позвать администратора» — вверху экрана").takeIf { canCallStaff },
    SaverHint("input", "Подключили приставку?", "«Источники» — переключение на HDMI").takeIf { hasSources },
)
