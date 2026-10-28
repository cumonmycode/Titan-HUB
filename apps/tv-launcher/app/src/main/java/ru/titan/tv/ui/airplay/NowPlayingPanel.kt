package ru.titan.tv.ui.airplay

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import ru.titan.tv.airplay.AirPlayCommand
import ru.titan.tv.airplay.AirPlayState
import ru.titan.tv.airplay.NowPlaying
import ru.titan.tv.ui.LocalStage
import ru.titan.tv.ui.icons.TitanIcon
import ru.titan.tv.ui.motion.SOFT_SPRING
import ru.titan.tv.ui.motion.spec
import ru.titan.tv.ui.sheets.focusPop
import ru.titan.tv.ui.sheets.rememberFocusLift
import ru.titan.tv.ui.theme.Ink
import ru.titan.tv.ui.theme.Type

private const val COVER = 360
private const val COVER_CORNER = 28
private const val PAUSED_SCALE = 0.92f
private const val BUTTON = 76
private const val ENTER_SCALE = 0.92f
private val BUTTON_FILL = Color.White.copy(alpha = 0.12f)
private val PLACEHOLDER = Brush.linearGradient(listOf(Color.White.copy(alpha = 0.16f), Color.White.copy(alpha = 0.04f)))

/**
 * What an iPhone plays here over AirPlay, built into the right side of the home screen under the corner
 * chips: a large cover, the title and artist, and buttons that go back to the sender as remote commands.
 */
@Composable
fun NowPlayingPanel(
    state: AirPlayState,
    enabled: Boolean,
    onCommand: (AirPlayCommand) -> Unit,
    modifier: Modifier = Modifier,
) {
    // The panel keeps showing the last track and its cover while it fades out
    val last = remember { arrayOfNulls<NowPlaying>(1) }
    val lastCover = remember { arrayOfNulls<ImageBitmap>(1) }
    state.nowPlaying?.let {
        last[0] = it
        lastCover[0] = state.cover
    }
    AnimatedVisibility(
        visible = state.nowPlaying != null,
        modifier = modifier,
        enter = fadeIn(tween(450)) + scaleIn(tween(450), initialScale = ENTER_SCALE),
        exit = fadeOut(tween(300)),
    ) {
        val playing = state.nowPlaying ?: last[0] ?: return@AnimatedVisibility
        Panel(playing, if (state.nowPlaying != null) state.cover else lastCover[0], enabled, onCommand)
    }
}

@Composable
private fun Panel(playing: NowPlaying, cover: ImageBitmap?, enabled: Boolean, onCommand: (AirPlayCommand) -> Unit) {
    val s = LocalStage.current
    Column(Modifier.width(s.dp(COVER)), horizontalAlignment = Alignment.CenterHorizontally) {
        Cover(cover, playing.isPlaying)
        BasicText(
            playing.title.ifEmpty { "Играет по AirPlay" },
            style = Type.pill(s).copy(fontSize = s.sp(32), fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = s.dp(22)),
        )
        if (playing.artist.isNotEmpty()) {
            BasicText(
                playing.artist,
                style = Type.meta(s).copy(fontSize = s.sp(24), textAlign = TextAlign.Center),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = s.dp(4)),
            )
        }
        Row(Modifier.padding(top = s.dp(18)), horizontalArrangement = Arrangement.spacedBy(s.dp(28))) {
            ControlButton("rewind", enabled) { onCommand(AirPlayCommand.PREVIOUS) }
            ControlButton(if (playing.isPlaying) "pause" else "play", enabled) { onCommand(AirPlayCommand.PLAY_PAUSE) }
            ControlButton("forward", enabled) { onCommand(AirPlayCommand.NEXT) }
        }
    }
}

@Composable
private fun Cover(cover: ImageBitmap?, isPlaying: Boolean) {
    val s = LocalStage.current
    // Like Apple Music: the cover settles back a little while paused
    val scale by animateFloatAsState(if (isPlaying) 1f else PAUSED_SCALE, SOFT_SPRING.spec(), label = "cover")
    val shape = RoundedCornerShape(s.dp(COVER_CORNER))
    Box(
        Modifier
            .size(s.dp(COVER))
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
                shadowElevation = s.dp(36).toPx()
                this.shape = shape
                clip = true
            }
            .background(PLACEHOLDER),
        contentAlignment = Alignment.Center,
    ) {
        if (cover != null) {
            Image(cover, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        } else {
            TitanIcon("music", s.dp(110), Ink.Tertiary)
        }
    }
}

@Composable
private fun ControlButton(icon: String, enabled: Boolean, onClick: () -> Unit) {
    val s = LocalStage.current
    var focused by remember { mutableStateOf(false) }
    val lift by rememberFocusLift(focused)
    Box(
        Modifier
            .size(s.dp(BUTTON))
            .focusPop({ lift }, scale = 1.15f, corner = s.dp(BUTTON / 2))
            .clip(CircleShape)
            .background(BUTTON_FILL)
            .onFocusChanged { focused = it.isFocused }
            .clickable(remember { MutableInteractionSource() }, indication = null, enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        TitanIcon(icon, s.dp(34), Ink.Primary)
    }
}
