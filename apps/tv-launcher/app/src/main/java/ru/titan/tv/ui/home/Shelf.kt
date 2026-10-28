package ru.titan.tv.ui.home

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import ru.titan.tv.apps.LauncherApp
import ru.titan.tv.ui.LocalStage
import ru.titan.tv.ui.theme.Type

/** Name and description of the focused app, grown upward from a fixed baseline above the dock. */
@Composable
fun Shelf(app: LauncherApp?, modifier: Modifier = Modifier) {
    val s = LocalStage.current
    AnimatedContent(
        targetState = app,
        modifier = modifier.widthIn(max = s.dp(1100)),
        contentAlignment = Alignment.BottomStart,
        contentKey = { it?.packageName },
        transitionSpec = {
            (fadeIn(tween(260, delayMillis = 80)) + slideInVertically(tween(260)) { it / 24 }) togetherWith
                fadeOut(tween(140))
        },
        label = "shelf",
    ) { current ->
        if (current != null) {
            Column(verticalArrangement = Arrangement.spacedBy(s.dp(14))) {
                BasicText(current.eyebrow.uppercase(), style = Type.eyebrow(s))
                BasicText(current.label, style = Type.display(s), maxLines = 2, overflow = TextOverflow.Ellipsis)
                BasicText(current.tagline, style = Type.meta(s))
            }
        }
    }
}
