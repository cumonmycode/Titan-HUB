package ru.titan.tv.ui.glass

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.graphicsLayer
import ru.titan.tv.apps.ArtColors
import ru.titan.tv.apps.mixArtColors

// Short: on a weak TV GPU every frame of a full-screen fade is expensive, so it is over quickly
private const val CROSSFADE_MS = 300

/**
 * The art behind the screens. It stands still: on the booth TV a full-screen frame costs more than a tenth
 * of a second, so anything moving forever would slow down the whole TV. It changes only when the palette
 * does, keeping two cached textures, the old palette and the new one fading in over it.
 */
@Stable
class Backdrop(initial: ArtColors) {
    /** The palette being faded out. */
    var from by mutableStateOf(initial)
        private set

    /** The palette fading in over [from]. */
    var to by mutableStateOf(initial)
        private set

    /** 0..1, how much of [to] shows. */
    val reveal = Animatable(1f)

    var screenSize by mutableStateOf(Size.Zero)

    suspend fun showColors(colors: ArtColors) {
        if (colors != to) {
            // An interrupted fade starts again from whatever is on screen right now
            from = mixArtColors(from, to, reveal.value)
            to = colors
            reveal.snapTo(0f)
        }
        // Also finishes a fade that was cancelled halfway when focus bounced back to the same palette
        reveal.animateTo(1f, tween(CROSSFADE_MS))
    }

    /** The art as it looks right now, for glass that redraws the part under itself. */
    fun DrawScope.drawArt() {
        paintArt(mixArtColors(from, to, reveal.value), screenSize)
    }
}

/**
 * Full-screen art with [scrims] painted over it. Each palette is rendered once into a texture, so a settled
 * screen is a single copy for the GPU.
 */
@Composable
fun BackdropArt(backdrop: Backdrop, modifier: Modifier = Modifier, scrims: List<Brush> = emptyList()) {
    Box(modifier) {
        // Hidden once the new palette covers it completely, which HWUI then skips
        ArtTexture(backdrop.from, scrims) { if (backdrop.reveal.value < 1f) 1f else 0f }
        ArtTexture(backdrop.to, scrims) { backdrop.reveal.value }
    }
}

/** One palette drawn into its own texture; only a new palette draws it again. */
@Composable
private fun ArtTexture(colors: ArtColors, scrims: List<Brush>, alpha: () -> Float) {
    Canvas(
        Modifier
            .fillMaxSize()
            .graphicsLayer {
                // Offscreen keeps the texture and applies alpha when copying it, without a second layer
                compositingStrategy = CompositingStrategy.Offscreen
                this.alpha = alpha()
            },
    ) {
        paintArt(colors, Size.Zero)
        scrims.forEach { drawRect(it) }
    }
}

private fun DrawScope.paintArt(colors: ArtColors, screen: Size) {
    val w = screen.width.takeIf { it > 0f } ?: size.width
    val h = screen.height.takeIf { it > 0f } ?: size.height
    val deep = Color(colors.deep)
    drawRect(
        brush = Brush.verticalGradient(0f to deep, 0.68f to Color(colors.base), startY = 0f, endY = h),
        size = Size(w, h),
    )
    blob(Offset(0.22f * w, 0.06f * h), 0.70f * w, 0.8f, deep)
    blob(Offset(0.63f * w, 0.48f * h), 0.50f * w, 0.75f, Color(colors.vibrant).copy(alpha = 0.72f))
    blob(Offset(0.80f * w, 0.24f * h), 0.36f * w, 0.75f, Color(colors.glow).copy(alpha = 0.85f))
}

private fun DrawScope.blob(center: Offset, radius: Float, squash: Float, color: Color) {
    scale(scaleX = 1f, scaleY = squash, pivot = center) {
        drawCircle(
            brush = Brush.radialGradient(listOf(color, color.copy(alpha = 0f)), center = center, radius = radius),
            radius = radius,
            center = center,
        )
    }
}
