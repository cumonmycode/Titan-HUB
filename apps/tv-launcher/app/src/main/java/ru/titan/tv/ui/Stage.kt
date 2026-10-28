package ru.titan.tv.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** The design is drawn on a 1920×1080 canvas, like the mockup. */
private const val DESIGN_WIDTH_PX = 1920f

/** Maps design pixels to this screen, so the layout is identical on any TV density. */
@Immutable
class Stage(private val dpPerPx: Float, private val fontScale: Float) {
    fun dp(px: Number): Dp = (px.toFloat() * dpPerPx).dp
    fun sp(px: Number): TextUnit = (px.toFloat() * dpPerPx / fontScale).sp
}

val LocalStage = staticCompositionLocalOf { Stage(dpPerPx = 0.5f, fontScale = 1f) }

@Composable
fun ProvideStage(content: @Composable () -> Unit) {
    val widthDp = LocalConfiguration.current.screenWidthDp
    val fontScale = LocalDensity.current.fontScale
    val stage = remember(widthDp, fontScale) { Stage(widthDp / DESIGN_WIDTH_PX, fontScale) }
    CompositionLocalProvider(LocalStage provides stage, content = content)
}
