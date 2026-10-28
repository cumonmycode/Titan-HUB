package ru.titan.tv.ui.brand

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.unit.Dp
import ru.titan.tv.ui.theme.Ink

/** The club's winged T is 368 × 339 units: two wing stripes and the letter. */
private const val LOGO_W = 368f
private const val LOGO_H = 339f
const val LOGO_ASPECT = LOGO_W / LOGO_H

private val OUTLINES: List<List<Pair<Float, Float>>> = listOf(
    listOf(0f to 0f, 186f to 0f, 163f to 37f, 24f to 37f),
    listOf(36f to 58f, 150f to 58f, 126f to 95f, 60f to 95f),
    listOf(210f to 0f, 368f to 0f, 305f to 95f, 230f to 95f, 230f to 339f, 136f to 275f, 136f to 114f),
)

private fun logoPath(): Path = Path().apply {
    OUTLINES.forEach { outline ->
        val (x0, y0) = outline.first()
        moveTo(x0, y0)
        outline.drop(1).forEach { (x, y) -> lineTo(x, y) }
        close()
    }
}

/**
 * The club logo, drawn from its outline so it is sharp on a 4K panel. [glow] 0..1 lights a soft violet
 * halo behind it; the caller animates it in the draw phase.
 */
@Composable
fun TitanLogo(height: Dp, modifier: Modifier = Modifier, color: Color = Ink.Logo, glow: () -> Float = { 0f }) {
    val path = remember { logoPath() }
    Canvas(modifier.size(height * LOGO_ASPECT, height)) {
        val g = glow()
        if (g > 0.01f) {
            drawCircle(
                brush = Brush.radialGradient(
                    listOf(Ink.Accent.copy(alpha = 0.45f * g), Color.Transparent),
                    center = Offset(size.width / 2f, size.height / 2f),
                    radius = size.height * 1.1f,
                ),
                radius = size.height * 1.1f,
                center = Offset(size.width / 2f, size.height / 2f),
            )
        }
        scale(size.width / LOGO_W, size.height / LOGO_H, pivot = Offset.Zero) {
            drawPath(path, color)
        }
    }
}
