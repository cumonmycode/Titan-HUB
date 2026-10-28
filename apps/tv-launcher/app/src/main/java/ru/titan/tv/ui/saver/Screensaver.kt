package ru.titan.tv.ui.saver

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.toSize
import ru.titan.tv.airplay.AirPlayState
import ru.titan.tv.apps.DEFAULT_ART_COLORS
import ru.titan.tv.ui.LocalStage
import ru.titan.tv.ui.brand.TitanLogo
import ru.titan.tv.ui.glass.Backdrop
import ru.titan.tv.ui.glass.BackdropArt
import ru.titan.tv.ui.home.clockStyle
import ru.titan.tv.ui.home.rememberMinuteClock
import ru.titan.tv.ui.icons.TitanIcon
import ru.titan.tv.ui.theme.Ink
import ru.titan.tv.ui.theme.Type
import kotlinx.coroutines.delay
import java.time.format.DateTimeFormatter

/** One quiet line in the corner: what the guest can do from the TV. */
data class SaverHint(val icon: String, val title: String, val detail: String)

private const val HINT_MS = 8_000L
// Still: on this TV every full-screen frame is expensive, so only the hint and the player's progress change
private const val LOGO_GLOW = 0.8f
private const val LOGO = 230
private val TIME_FORMAT = DateTimeFormatter.ofPattern("HH:mm")
private val HINT_FILL = Color.White.copy(alpha = 0.08f)

/**
 * After two idle minutes on the home screen: the club's logo glowing on its own colours, the time in a
 * corner, what plays over AirPlay in the other top corner and, below it, one hint at a time about the
 * booth. Any key brings the home screen back.
 */
@Composable
fun Screensaver(roomName: String?, hints: List<SaverHint>, airplay: AirPlayState) {
    val s = LocalStage.current
    val backdrop = remember { Backdrop(DEFAULT_ART_COLORS) }
    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .onSizeChanged { backdrop.screenSize = it.toSize() },
    ) {
        BackdropArt(backdrop, Modifier.fillMaxSize())
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.35f)))
        Column(
            Modifier.align(Alignment.Center),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            TitanLogo(s.dp(LOGO), glow = { LOGO_GLOW })
            BasicText(
                "TITAN",
                style = Type.title(s).copy(fontSize = s.sp(64), fontWeight = FontWeight.Bold, letterSpacing = 0.5.em),
                modifier = Modifier.padding(top = s.dp(40)),
            )
            if (roomName != null) BasicText(roomName, style = Type.meta(s).copy(fontSize = s.sp(30)), modifier = Modifier.padding(top = s.dp(10)))
        }
        val now = rememberMinuteClock()
        BasicText(
            now.format(TIME_FORMAT),
            style = clockStyle(s, 96),
            modifier = Modifier.align(Alignment.TopEnd).padding(top = s.dp(56), end = s.dp(96)),
        )
        SaverPlayer(airplay, Modifier.align(Alignment.TopStart).padding(start = s.dp(96), top = s.dp(64)))
        if (hints.isNotEmpty()) {
            HintCorner(hints, Modifier.align(Alignment.BottomStart).padding(start = s.dp(96), bottom = s.dp(80)))
        }
    }
}

@Composable
private fun HintCorner(hints: List<SaverHint>, modifier: Modifier) {
    val s = LocalStage.current
    var index by remember { mutableIntStateOf(0) }
    LaunchedEffect(hints) {
        while (true) {
            delay(HINT_MS)
            index = (index + 1) % hints.size
        }
    }
    AnimatedContent(
        targetState = hints[index % hints.size],
        modifier = modifier,
        transitionSpec = {
            (fadeIn(tween(500, delayMillis = 200)) + slideInVertically(tween(500, delayMillis = 200)) { it / 4 }) togetherWith
                fadeOut(tween(300))
        },
        label = "hint",
    ) { hint ->
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(s.dp(22))) {
            Box(Modifier.size(s.dp(72)).clip(CircleShape).background(HINT_FILL), contentAlignment = Alignment.Center) {
                TitanIcon(hint.icon, s.dp(36), Ink.AccentSoft)
            }
            Column {
                BasicText(hint.title, style = Type.pill(s).copy(fontSize = s.sp(30)))
                BasicText(hint.detail, style = Type.caption(s).copy(fontSize = s.sp(23)), modifier = Modifier.padding(top = s.dp(6)))
            }
        }
    }
}
