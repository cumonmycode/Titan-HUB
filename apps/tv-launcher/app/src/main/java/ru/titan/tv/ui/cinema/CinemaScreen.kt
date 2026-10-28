package ru.titan.tv.ui.cinema

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.toSize
import ru.titan.tv.apps.DEFAULT_ART_COLORS
import ru.titan.tv.apps.LauncherApp
import ru.titan.tv.ui.LocalStage
import ru.titan.tv.ui.brand.TitanLogo
import ru.titan.tv.ui.glass.Backdrop
import ru.titan.tv.ui.glass.BackdropArt
import ru.titan.tv.ui.icons.TitanIcon
import ru.titan.tv.ui.sheets.rememberFocusLift
import ru.titan.tv.ui.sheets.requestSafely
import ru.titan.tv.ui.theme.Ink
import ru.titan.tv.ui.theme.Type
import kotlinx.coroutines.delay

// Design pixels on the 1920 canvas. TV banners are 16:9, so every picture here keeps 16:9 and is never cropped
private const val PLATE_W = 640
private const val PLATE_H = 360
private const val CARD_W = 300
private const val CARD_H = 169
private const val CARD_GAP = 36
private const val CARD_FOCUS_SCALE = 1.14f

private const val ARRIVE_MS = 320
private const val STAGGER_MS = 50L
private const val SWEEP_MS = 800
private const val PALETTE_SETTLE_MS = 120L

// The plate is drawn 1:1 from a 640×360 banner, so it stays sharp on the TV
private const val BANNER_W = PLATE_W
private const val BANNER_H = PLATE_H

private val SCRIMS = listOf(
    Brush.verticalGradient(0f to Color.Black.copy(alpha = 0.55f), 0.45f to Color.Black.copy(alpha = 0.25f), 1f to Color.Black.copy(alpha = 0.8f)),
)

/**
 * «Фильмы и сериалы»: the chosen cinema large at the top — its name, what it offers and its banner on a
 * glowing plate — and every cinema as a 16:9 card below. Moving along the cards slides the hero over, sweeps
 * a light across the plate and turns the room and the projector beam to the cinema's colours.
 */
@Composable
fun CinemaScreen(
    apps: List<LauncherApp>,
    banner: suspend (String) -> ImageBitmap?,
    onOpen: (LauncherApp) -> Unit,
    onClose: () -> Unit,
) {
    val s = LocalStage.current
    val backdrop = remember { Backdrop(DEFAULT_ART_COLORS) }
    var focused by rememberSaveable { mutableIntStateOf(0) }
    var direction by remember { mutableIntStateOf(1) }
    val firstFocus = remember { FocusRequester() }
    val current = apps.getOrNull(focused)
    BackHandler(onBack = onClose)
    LaunchedEffect(current?.colors) {
        delay(PALETTE_SETTLE_MS)
        current?.let { backdrop.showColors(it.colors) }
    }
    LaunchedEffect(apps.isNotEmpty()) {
        withFrameNanos { }
        firstFocus.requestSafely()
    }
    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .onSizeChanged { backdrop.screenSize = it.toSize() },
    ) {
        BackdropArt(backdrop, Modifier.fillMaxSize(), scrims = SCRIMS)
        ProjectorLight(Color(current?.colors?.glow ?: DEFAULT_ART_COLORS.glow))
        Header(Modifier.padding(start = s.dp(96), top = s.dp(60)))
        AnimatedContent(
            targetState = current,
            modifier = Modifier.padding(start = s.dp(96), end = s.dp(96), top = s.dp(210)),
            contentKey = { it?.packageName },
            transitionSpec = {
                (fadeIn(tween(240, delayMillis = 60)) + slideInHorizontally(tween(280, easing = FastOutSlowInEasing)) { direction * it / 14 }) togetherWith
                    fadeOut(tween(140))
            },
            label = "hero",
        ) { app ->
            if (app != null) Hero(app, banner)
        }
        LazyRow(
            modifier = Modifier.align(Alignment.BottomStart).fillMaxWidth().padding(bottom = s.dp(84)),
            contentPadding = PaddingValues(horizontal = s.dp(96), vertical = s.dp(24)),
            horizontalArrangement = Arrangement.spacedBy(s.dp(CARD_GAP)),
        ) {
            itemsIndexed(apps, key = { _, app -> app.packageName }) { index, app ->
                CinemaCard(
                    app = app,
                    index = index,
                    onFocused = {
                        direction = if (index >= focused) 1 else -1
                        focused = index
                    },
                    onClick = { onOpen(app) },
                    modifier = if (index == focused) Modifier.focusRequester(firstFocus) else Modifier,
                )
            }
        }
    }
}

@Composable
private fun Header(modifier: Modifier) {
    val s = LocalStage.current
    Column(modifier) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(s.dp(14))) {
            TitanLogo(s.dp(28))
            BasicText("КИНОЗАЛ TITAN", style = Type.eyebrow(s).copy(color = Ink.AccentSoft, letterSpacing = 0.24.em))
        }
        BasicText(
            "Фильмы и сериалы",
            style = Type.title(s).copy(fontSize = s.sp(48), fontWeight = FontWeight.SemiBold),
            modifier = Modifier.padding(top = s.dp(10)),
        )
    }
}

/** A wide beam of the cinema's own colour across the top, like a projector in a dark hall. It moves only with the colour. */
@Composable
private fun ProjectorLight(color: Color) {
    Canvas(Modifier.fillMaxSize()) {
        val center = Offset(size.width * 0.62f, size.height * 0.3f)
        val radius = size.width * 0.5f
        drawCircle(Brush.radialGradient(listOf(color.copy(alpha = 0.32f), Color.Transparent), center, radius), radius, center)
    }
}

@Composable
private fun Hero(app: LauncherApp, banner: suspend (String) -> ImageBitmap?) {
    val s = LocalStage.current
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.width(s.dp(860))) {
            BasicText(app.eyebrow.uppercase(), style = Type.eyebrow(s).copy(color = Ink.AccentSoft))
            BasicText(
                app.label,
                style = Type.display(s).copy(fontSize = s.sp(84)),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = s.dp(10)),
            )
            BasicText(
                app.tagline,
                style = Type.meta(s).copy(fontSize = s.sp(32)),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = s.dp(12)),
            )
            Row(
                Modifier.padding(top = s.dp(36)),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(s.dp(20)),
            ) {
                Row(
                    Modifier
                        .height(s.dp(68))
                        .clip(RoundedCornerShape(s.dp(34)))
                        .background(Ink.Accent)
                        .padding(horizontal = s.dp(32)),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(s.dp(12)),
                ) {
                    TitanIcon("play", s.dp(26), Ink.Primary)
                    BasicText("Смотреть", style = Type.pill(s).copy(fontSize = s.sp(26)))
                }
                BasicText("OK на пульте", style = Type.caption(s).copy(fontSize = s.sp(22), color = Ink.Tertiary))
            }
        }
        Spacer(Modifier.weight(1f))
        BannerPlate(app, banner)
    }
}

/** The cinema's banner, whole and sharp, on a glowing plate; a light sweeps over it once on arrival. */
@Composable
private fun BannerPlate(app: LauncherApp, banner: suspend (String) -> ImageBitmap?) {
    val s = LocalStage.current
    val art by produceState(app.banner, app.packageName) { value = banner(app.packageName) ?: app.banner }
    val sweep = remember { Animatable(0f) }
    LaunchedEffect(Unit) { sweep.animateTo(1f, tween(SWEEP_MS, delayMillis = 200, easing = LinearEasing)) }
    val glow = Color(app.colors.vibrant)
    Box(contentAlignment = Alignment.Center) {
        // The glow is wider than the plate, so it is drawn by a larger box behind it
        Canvas(Modifier.size(s.dp(PLATE_W + 260), s.dp(PLATE_H + 260))) {
            drawCircle(Brush.radialGradient(listOf(glow.copy(alpha = 0.55f), Color.Transparent)), size.width / 2f)
        }
        Box(
            Modifier
                .size(s.dp(PLATE_W), s.dp(PLATE_H))
                .graphicsLayer {
                    shape = RoundedCornerShape(s.dp(32))
                    clip = true
                }
                .background(Brush.linearGradient(listOf(Color(app.colors.vibrant), Color(app.colors.deep))))
                .drawWithContent {
                    drawContent()
                    val p = sweep.value
                    if (p < 1f) {
                        val x = -size.width * 0.5f + p * size.width * 2f
                        drawRect(
                            Brush.linearGradient(
                                0f to Color.Transparent,
                                0.5f to Color.White.copy(alpha = 0.28f),
                                1f to Color.Transparent,
                                start = Offset(x, 0f),
                                end = Offset(x + size.width * 0.35f, size.height),
                            ),
                        )
                    }
                    drawRoundRect(
                        color = Color.White.copy(alpha = 0.22f),
                        cornerRadius = CornerRadius(s.dp(32).toPx()),
                        style = Stroke(1.5.dp.toPx()),
                    )
                },
            contentAlignment = Alignment.Center,
        ) {
            val bitmap = art
            if (bitmap != null) {
                Image(bitmap, app.label, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            } else {
                app.icon?.let { Image(it, app.label, Modifier.size(s.dp(160))) }
            }
        }
    }
}

/** A 16:9 card with the whole banner; the chosen one rises and takes a ring, the rest step back. */
@Composable
private fun CinemaCard(app: LauncherApp, index: Int, onFocused: () -> Unit, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val s = LocalStage.current
    var focused by remember { mutableStateOf(false) }
    val lift by rememberFocusLift(focused)
    val arrive = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        delay(index * STAGGER_MS)
        arrive.animateTo(1f, tween(ARRIVE_MS, easing = FastOutSlowInEasing))
    }
    val corner = s.dp(24)
    Box(
        modifier
            .size(s.dp(CARD_W), s.dp(CARD_H))
            .graphicsLayer {
                val k = 1f + (CARD_FOCUS_SCALE - 1f) * lift
                scaleX = k
                scaleY = k
                translationY = (1f - arrive.value) * s.dp(90).toPx() - s.dp(10).toPx() * lift
                alpha = arrive.value * (0.6f + 0.4f * lift)
                shape = RoundedCornerShape(corner)
                clip = true
            }
            .background(Brush.linearGradient(listOf(Color(app.colors.vibrant), Color(app.colors.deep))))
            .onFocusChanged {
                focused = it.isFocused
                if (it.isFocused) onFocused()
            }
            .clickable(remember { MutableInteractionSource() }, indication = null, onClick = onClick)
            .drawWithContent {
                drawContent()
                drawRoundRect(
                    color = Color.White.copy(alpha = 0.15f + 0.75f * lift),
                    cornerRadius = CornerRadius(corner.toPx()),
                    style = Stroke((1.5f + 1.5f * lift).dp.toPx()),
                )
            },
        contentAlignment = Alignment.Center,
    ) {
        val banner = app.banner
        if (banner != null) {
            Image(banner, app.label, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        } else {
            app.icon?.let { Image(it, app.label, Modifier.size(s.dp(96))) }
        }
    }
}

/** Remembers banner bitmaps for the life of the screen, so moving back and forth does not decode them again. */
@Composable
fun rememberBannerCache(load: suspend (String, Int, Int) -> ImageBitmap?): suspend (String) -> ImageBitmap? {
    val cache = remember { mutableMapOf<String, ImageBitmap?>() }
    return remember(load) {
        { packageName -> cache.getOrPut(packageName) { load(packageName, BANNER_W, BANNER_H) } }
    }
}
