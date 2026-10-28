package ru.titan.tv.ui.home

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import ru.titan.tv.apps.ArtColors
import ru.titan.tv.apps.DEFAULT_ART_COLORS
import ru.titan.tv.apps.LauncherApp
import ru.titan.tv.apps.SETTINGS_PACKAGE
import ru.titan.tv.ui.LocalStage
import ru.titan.tv.ui.icons.TitanIcon
import ru.titan.tv.ui.sheets.rememberFocusLift
import ru.titan.tv.ui.theme.Type

private const val FOCUS_SCALE = 1.15f
private const val BANNER_OVERSCAN = 1.08f
private val SHINE = Brush.linearGradient(
    0f to Color.White.copy(alpha = 0.35f),
    0.5f to Color.Transparent,
    start = Offset.Zero,
    end = Offset.Infinite,
)

const val ALL_APPS_KEY = "titan:all-apps"

/** The last tile of the home row; it opens the grid of every installed app. */
internal val ALL_APPS_TILE = LauncherApp(
    packageName = ALL_APPS_KEY,
    label = "Все приложения",
    banner = null,
    icon = null,
    colors = ArtColors(
        base = 0xFF0D0F14.toInt(),
        deep = 0xFF262B36.toInt(),
        vibrant = 0xFF3A4150.toInt(),
        glow = 0xFFC9D4EA.toInt(),
    ),
    eyebrow = "Меню",
    tagline = "Удерживайте OK на приложении, чтобы добавить его сюда",
)

const val CINEMA_KEY = "titan:cinema"

/** The first tile of the home row; it opens every online cinema on one screen. */
internal fun cinemaTile(cinemas: List<LauncherApp>) = LauncherApp(
    packageName = CINEMA_KEY,
    label = "Фильмы и сериалы",
    banner = null,
    icon = null,
    colors = DEFAULT_ART_COLORS,
    eyebrow = "Кинозал",
    tagline = cinemas.joinToString(", ") { it.label }.ifEmpty { "Онлайн-кинотеатры" },
)

/**
 * The home row: «Фильмы и сериалы» first, then the apps from config.json, and at the end the way to all
 * apps. The row is fixed, so the next guests find it the same.
 */
@Composable
fun Dock(
    apps: List<LauncherApp>,
    cinema: LauncherApp?,
    enabled: Boolean,
    firstFocus: FocusRequester,
    onFocused: (LauncherApp) -> Unit,
    onOpen: (LauncherApp) -> Unit,
    onOpenCinema: () -> Unit,
    onOpenAll: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val s = LocalStage.current
    LazyRow(
        modifier = modifier.fillMaxWidth(),
        contentPadding = PaddingValues(horizontal = s.dp(96), vertical = s.dp(40)),
        horizontalArrangement = Arrangement.spacedBy(s.dp(40)),
    ) {
        if (cinema != null) {
            item(key = CINEMA_KEY) {
                AppTile(
                    app = cinema,
                    enabled = enabled,
                    onFocused = { onFocused(cinema) },
                    onClick = onOpenCinema,
                    modifier = Modifier.focusRequester(firstFocus),
                )
            }
        }
        itemsIndexed(apps, key = { _, app -> app.packageName }) { index, app ->
            AppTile(
                app = app,
                enabled = enabled,
                onFocused = { onFocused(app) },
                onClick = { onOpen(app) },
                modifier = if (index == 0 && cinema == null) Modifier.focusRequester(firstFocus) else Modifier,
            )
        }
        item(key = ALL_APPS_KEY) {
            AppTile(
                app = ALL_APPS_TILE,
                enabled = enabled,
                onFocused = { onFocused(ALL_APPS_TILE) },
                onClick = onOpenAll,
                // The row ends here: right must not jump up to the chips in the corner
                modifier = Modifier
                    .focusProperties { right = FocusRequester.Cancel }
                    .then(if (apps.isEmpty() && cinema == null) Modifier.focusRequester(firstFocus) else Modifier),
            )
        }
    }
}

/** One app tile with the focus pop: it grows, rises and takes a ring. Shadows and 3D lean cost too much on the TV. */
@Composable
internal fun AppTile(
    app: LauncherApp,
    enabled: Boolean,
    onFocused: () -> Unit,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val s = LocalStage.current
    var focused by remember { mutableStateOf(false) }
    val lift by rememberFocusLift(focused)
    val shape = RoundedCornerShape(s.dp(30))
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            modifier
                .size(s.dp(248), s.dp(148))
                .graphicsLayer {
                    val k = 1f + (FOCUS_SCALE - 1f) * lift
                    scaleX = k
                    scaleY = k
                    translationY = -s.dp(16).toPx() * lift
                    this.shape = shape
                    clip = true
                }
                .onFocusChanged {
                    focused = it.isFocused
                    if (it.isFocused) onFocused()
                }
                .clickable(remember { MutableInteractionSource() }, indication = null, enabled = enabled, onClick = onClick)
                .drawWithContent {
                    drawContent()
                    drawRoundRect(
                        color = Color.White.copy(alpha = 0.18f + 0.6f * lift),
                        cornerRadius = CornerRadius(s.dp(30).toPx()),
                        style = Stroke(1.5.dp.toPx()),
                    )
                },
        ) {
            TileFace(app)
            Box(Modifier.fillMaxSize().graphicsLayer { alpha = lift }.background(SHINE))
        }
        BasicText(
            app.label,
            style = Type.pill(s).copy(fontSize = s.sp(25)),
            maxLines = 1,
            modifier = Modifier
                .padding(top = s.dp(26))
                .graphicsLayer {
                    alpha = lift
                    translationY = s.dp(12).toPx() * lift - s.dp(8).toPx()
                },
        )
    }
}

/** The cinema tile's own face: the film strip over the club's violet, with a small «Кинозал» caption. */
@Composable
private fun CinemaFace() {
    val s = LocalStage.current
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        TitanIcon("film", s.dp(66), Color.White)
        BasicText(
            "КИНОЗАЛ",
            style = Type.label(s).copy(color = Color.White.copy(alpha = 0.85f)),
            modifier = Modifier.padding(top = s.dp(10)),
        )
    }
}

@Composable
private fun TileFace(app: LauncherApp) {
    val s = LocalStage.current
    val banner = app.banner
    if (banner != null) {
        Image(
            bitmap = banner,
            contentDescription = app.label,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize().graphicsLayer {
                scaleX = BANNER_OVERSCAN
                scaleY = BANNER_OVERSCAN
            },
        )
        return
    }
    Box(
        Modifier
            .fillMaxSize()
            .background(Brush.linearGradient(listOf(Color(app.colors.vibrant), Color(app.colors.deep)))),
        contentAlignment = Alignment.Center,
    ) {
        val icon = app.icon
        when {
            app.packageName == ALL_APPS_KEY -> TitanIcon("grid", s.dp(64), Color.White)
            app.packageName == CINEMA_KEY -> CinemaFace()
            app.packageName == SETTINGS_PACKAGE -> TitanIcon("gear", s.dp(78), Color.White)
            icon != null -> Image(bitmap = icon, contentDescription = app.label, modifier = Modifier.size(s.dp(96)))
        }
    }
}
