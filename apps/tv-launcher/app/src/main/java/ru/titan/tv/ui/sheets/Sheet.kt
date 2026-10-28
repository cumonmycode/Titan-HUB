package ru.titan.tv.ui.sheets

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import ru.titan.tv.home.TvKey
import ru.titan.tv.ui.LocalStage
import ru.titan.tv.ui.motion.FOCUS_SPRING
import ru.titan.tv.ui.motion.PANEL_SPRING
import ru.titan.tv.ui.motion.spec
import ru.titan.tv.ui.theme.Type

/** What the room controls can do, independent of where they are shown. */
class RoomActions(
    val toggleLight: (String) -> Unit,
    val stepLight: (String, Int) -> Unit,
    val setColor: (String, Map<String, Any>) -> Unit,
    val activateScene: (String) -> Unit,
    val toggleClimate: () -> Unit,
    val stepClimate: (Int) -> Unit,
    val setClimateMode: (String) -> Unit,
    val setFanMode: (String) -> Unit,
    val pressTv: (TvKey) -> Unit,
)

private val SHEET_ORIGIN = TransformOrigin(0.82f, 0f)
private const val SHEET_ENTER_SCALE = 0.84f
private const val SHEET_EXIT_SCALE = 0.9f
private val RING_WIDTH = 2.dp

/** A sheet grows out of the top-right chips and shrinks back into them. */
@Composable
fun SheetFrame(
    visible: Boolean,
    modifier: Modifier = Modifier,
    origin: TransformOrigin = SHEET_ORIGIN,
    content: @Composable () -> Unit,
) {
    AnimatedVisibility(
        visible = visible,
        modifier = modifier,
        enter = scaleIn(PANEL_SPRING.spec(), initialScale = SHEET_ENTER_SCALE, transformOrigin = origin) +
            fadeIn(tween(240)),
        exit = scaleOut(tween(220), targetScale = SHEET_EXIT_SCALE, transformOrigin = origin) +
            fadeOut(tween(200)),
    ) {
        content()
    }
}

@Composable
fun SectionLabel(title: String, trailing: String? = null) {
    val s = LocalStage.current
    Row(Modifier.fillMaxWidth().padding(bottom = s.dp(12)), horizontalArrangement = Arrangement.SpaceBetween) {
        BasicText(title.uppercase(), style = Type.label(s))
        if (trailing != null) BasicText(trailing, style = Type.label(s).copy(letterSpacing = 0.02.em))
    }
}

/** 0 → 1 with the tvOS focus spring. */
@Composable
fun rememberFocusLift(focused: Boolean): State<Float> =
    animateFloatAsState(if (focused) 1f else 0f, FOCUS_SPRING.spec(), label = "focus")

/** Grows by [scale] and draws a white ring as [lift] goes to 1; both read in the draw phase only. */
fun Modifier.focusPop(lift: () -> Float, scale: Float, corner: Dp): Modifier = this
    .graphicsLayer {
        val k = 1f + (scale - 1f) * lift()
        scaleX = k
        scaleY = k
    }
    .drawWithContent {
        drawContent()
        val l = lift()
        if (l > 0.01f) {
            drawRoundRect(
                color = Color.White.copy(alpha = 0.9f * l),
                cornerRadius = CornerRadius(corner.toPx()),
                style = Stroke(RING_WIDTH.toPx()),
            )
        }
    }

fun FocusRequester.requestSafely() {
    runCatching { requestFocus() }
}
