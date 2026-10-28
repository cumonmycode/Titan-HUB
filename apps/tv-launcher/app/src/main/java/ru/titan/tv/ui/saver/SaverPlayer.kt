package ru.titan.tv.ui.saver

import android.os.SystemClock
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import ru.titan.tv.airplay.AirPlayState
import ru.titan.tv.airplay.NowPlaying
import ru.titan.tv.ui.LocalStage
import ru.titan.tv.ui.icons.TitanIcon
import ru.titan.tv.ui.theme.Ink
import ru.titan.tv.ui.theme.Type
import kotlinx.coroutines.delay
import java.util.Locale

private const val COVER = 136
private const val COVER_CORNER = 24
private const val TEXT_WIDTH = 640
private const val BAR_WIDTH = 360
private const val BAR_HEIGHT = 6
private const val MS_PER_SECOND = 1_000L
private const val SECONDS_PER_MINUTE = 60L
private const val SECONDS_PER_HOUR = 3_600L
private val BAR_TRACK = Color.White.copy(alpha = 0.16f)
private val PLACEHOLDER = Brush.linearGradient(listOf(Color.White.copy(alpha = 0.16f), Color.White.copy(alpha = 0.04f)))

/**
 * What plays over AirPlay, as one line in the screensaver's top corner: the cover, then the sender, the
 * title, the artist and album and the progress. The bar moves once a second; nothing else animates.
 */
@Composable
fun SaverPlayer(state: AirPlayState, modifier: Modifier = Modifier) {
    // The line keeps showing the last track and its cover while it fades out
    val last = remember { arrayOfNulls<NowPlaying>(1) }
    val lastCover = remember { arrayOfNulls<ImageBitmap>(1) }
    state.nowPlaying?.let {
        last[0] = it
        lastCover[0] = state.cover
    }
    AnimatedVisibility(
        visible = state.nowPlaying != null,
        modifier = modifier,
        enter = fadeIn(tween(500)),
        exit = fadeOut(tween(300)),
    ) {
        val playing = state.nowPlaying ?: last[0] ?: return@AnimatedVisibility
        PlayerLine(playing, if (state.nowPlaying != null) state.cover else lastCover[0])
    }
}

@Composable
private fun PlayerLine(playing: NowPlaying, cover: ImageBitmap?) {
    val s = LocalStage.current
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(s.dp(28))) {
        // The cover is decoded after the track's details arrive, so it fades in on its own
        Crossfade(cover, animationSpec = tween(400), label = "cover") { CoverSquare(it) }
        Column(Modifier.widthIn(max = s.dp(TEXT_WIDTH))) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(s.dp(10))) {
                TitanIcon(if (playing.isPlaying) "airplay" else "pause", s.dp(24), Ink.AccentSoft)
                BasicText(
                    playerSource(playing),
                    style = Type.eyebrow(s).copy(color = Ink.AccentSoft),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            AnimatedContent(
                targetState = playing.title to trackSubtitle(playing),
                transitionSpec = { fadeIn(tween(400, delayMillis = 150)) togetherWith fadeOut(tween(200)) },
                label = "track",
            ) { (title, subtitle) ->
                Column {
                    BasicText(
                        title.ifEmpty { "Без названия" },
                        style = Type.pill(s).copy(fontSize = s.sp(34), fontWeight = FontWeight.Bold),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(top = s.dp(10)),
                    )
                    if (subtitle.isNotEmpty()) {
                        BasicText(
                            subtitle,
                            style = Type.meta(s).copy(fontSize = s.sp(24)),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.padding(top = s.dp(4)),
                        )
                    }
                }
            }
            if (playing.durationSec > 0) TrackProgress(playing, Modifier.padding(top = s.dp(16)))
        }
    }
}

@Composable
private fun CoverSquare(cover: ImageBitmap?) {
    val s = LocalStage.current
    Box(
        Modifier
            .size(s.dp(COVER))
            .clip(RoundedCornerShape(s.dp(COVER_CORNER)))
            .background(PLACEHOLDER),
        contentAlignment = Alignment.Center,
    ) {
        if (cover != null) {
            Image(cover, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        } else {
            TitanIcon("music", s.dp(52), Ink.Tertiary)
        }
    }
}

@Composable
private fun TrackProgress(playing: NowPlaying, modifier: Modifier) {
    val s = LocalStage.current
    var nowMs by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    // Ticks as the played second turns over, so the time on screen steps evenly
    LaunchedEffect(playing.isPlaying, playing.positionAtMs) {
        nowMs = SystemClock.elapsedRealtime()
        while (playing.isPlaying) {
            val playedMs = (playing.positionAt(nowMs) * MS_PER_SECOND).toLong()
            delay(MS_PER_SECOND - playedMs % MS_PER_SECOND)
            nowMs = SystemClock.elapsedRealtime()
        }
    }
    val position = playing.positionAt(nowMs)
    val fraction = (position / playing.durationSec).toFloat().coerceIn(0f, 1f)
    val timeStyle = Type.number(s, 20).copy(color = Ink.Secondary)
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(s.dp(16))) {
        BasicText(trackTime(position), style = timeStyle)
        Box(Modifier.width(s.dp(BAR_WIDTH)).height(s.dp(BAR_HEIGHT)).clip(CircleShape).background(BAR_TRACK)) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(fraction).background(Ink.AccentSoft))
        }
        BasicText(trackTime(playing.durationSec), style = timeStyle)
    }
}

/** Where the music comes from: "Играет по AirPlay · iPhone Кая", or "На паузе · …" while paused. */
internal fun playerSource(playing: NowPlaying): String {
    val status = if (playing.isPlaying) "Играет по AirPlay" else "На паузе"
    return listOf(status, playing.client).filter { it.isNotEmpty() }.joinToString(" · ")
}

/** The artist and album, whichever the sender knows. */
internal fun trackSubtitle(playing: NowPlaying): String =
    listOf(playing.artist, playing.album).filter { it.isNotEmpty() }.joinToString(" · ")

/** 3:45, or 1:02:03 for a long mix. */
internal fun trackTime(seconds: Double): String {
    val total = seconds.toLong().coerceAtLeast(0)
    val hours = total / SECONDS_PER_HOUR
    val minutes = total % SECONDS_PER_HOUR / SECONDS_PER_MINUTE
    val rest = total % SECONDS_PER_MINUTE
    return if (hours > 0) {
        String.format(Locale.ROOT, "%d:%02d:%02d", hours, minutes, rest)
    } else {
        String.format(Locale.ROOT, "%d:%02d", minutes, rest)
    }
}
