package ru.titan.tv.ui.glass

import android.graphics.RuntimeShader
import android.graphics.Shader
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlurEffect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.RenderEffect
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.asComposeRenderEffect
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import ru.titan.tv.ui.LocalStage

/** How strongly a glass surface bends and blurs what is behind it, in pixels. */
data class Lens(val bezel: Float, val strength: Float, val blur: Float) {
    companion object {
        @Composable
        fun chip(): Lens = lens(bezel = 18, strength = 34, blur = 9)

        @Composable
        fun sheet(): Lens = lens(bezel = 44, strength = 90, blur = 18)

        @Composable
        private fun lens(bezel: Int, strength: Int, blur: Int): Lens {
            val s = LocalStage.current
            return with(LocalDensity.current) { Lens(s.dp(bezel).toPx(), s.dp(strength).toPx(), s.dp(blur).toPx()) }
        }
    }
}

private val GLASS_TINT = Color(0x38141620)
// No blur before Android 12. The surface still paints the soft backdrop art under itself, so a lighter
// violet-black tint keeps the glass look on old TVs without anything sharp showing through
private val OPAQUE_TINT = Color(0x9E120E1C)
private val SHEEN = Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.17f), Color.White.copy(alpha = 0.05f)))
private val SPECULAR = Brush.linearGradient(
    0f to Color.White.copy(alpha = 0.22f),
    0.45f to Color.Transparent,
    start = Offset.Zero,
    end = Offset.Infinite,
)
private val RIM = Brush.linearGradient(
    0f to Color.White.copy(alpha = 0.75f),
    0.32f to Color.White.copy(alpha = 0.12f),
    0.58f to Color.White.copy(alpha = 0.02f),
    1f to Color.White.copy(alpha = 0.38f),
    start = Offset.Zero,
    end = Offset.Infinite,
)
private val RIM_WIDTH = 1.5.dp

// Samples the blurred backdrop further inside near the rim, so the edge reads as a thick lens
private const val REFRACTION_SHADER = """
uniform shader content;
uniform float2 size;
uniform float radius;
uniform float bezel;
uniform float strength;

half4 main(float2 p) {
    float2 h = size * 0.5;
    float2 q = abs(p - h) - (h - radius);
    float inside = radius - (length(max(q, 0.0)) + min(max(q.x, q.y), 0.0));
    float t = clamp(1.0 - inside / bezel, 0.0, 1.0);
    float2 n = (q.x > 0.0 && q.y > 0.0) ? normalize(q) : (q.x > q.y ? float2(1.0, 0.0) : float2(0.0, 1.0));
    n *= sign(p - h);
    return content.eval(p - n * pow(t, 2.2) * strength);
}
"""

/**
 * Liquid Glass: the backdrop under this surface, blurred and bent at the rim (Android 13+),
 * blurred only on Android 12, and a frosted tint below that.
 */
@Composable
fun Glass(
    backdrop: Backdrop,
    cornerRadius: Dp,
    lens: Lens,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    val shape = RoundedCornerShape(cornerRadius)
    val cornerPx = with(LocalDensity.current) { cornerRadius.toPx() }
    var origin by remember { mutableStateOf(Offset.Zero) }
    var size by remember { mutableStateOf(IntSize.Zero) }
    val effect = remember(size, cornerPx, lens) { glassEffect(size, cornerPx, lens) }
    Box(
        modifier
            .onGloballyPositioned {
                origin = it.positionInRoot()
                size = it.size
            }
            .clip(shape),
    ) {
        // The surface is kept as a texture, so focus moving over it costs a copy instead of every gradient again
        Box(Modifier.matchParentSize().graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }) {
            Canvas(Modifier.matchParentSize().graphicsLayer { renderEffect = effect }) {
                translate(-origin.x, -origin.y) { with(backdrop) { drawArt() } }
            }
            Box(Modifier.matchParentSize().background(if (effect == null) OPAQUE_TINT else GLASS_TINT).background(SHEEN))
            Box(Modifier.matchParentSize().background(SPECULAR))
            Box(Modifier.matchParentSize().border(RIM_WIDTH, RIM, shape))
        }
        content()
    }
}

private fun glassEffect(size: IntSize, cornerPx: Float, lens: Lens): RenderEffect? = when {
    size.width == 0 || size.height == 0 -> null
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU -> refraction(size, cornerPx, lens)
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> BlurEffect(lens.blur, lens.blur, TileMode.Clamp)
    else -> null
}

@RequiresApi(Build.VERSION_CODES.TIRAMISU)
private fun refraction(size: IntSize, cornerPx: Float, lens: Lens): RenderEffect {
    val shader = RuntimeShader(REFRACTION_SHADER).apply {
        setFloatUniform("size", size.width.toFloat(), size.height.toFloat())
        setFloatUniform("radius", cornerPx)
        setFloatUniform("bezel", lens.bezel)
        setFloatUniform("strength", lens.strength)
    }
    val blur = android.graphics.RenderEffect.createBlurEffect(lens.blur, lens.blur, Shader.TileMode.CLAMP)
    val bend = android.graphics.RenderEffect.createRuntimeShaderEffect(shader, "content")
    return android.graphics.RenderEffect.createChainEffect(bend, blur).asComposeRenderEffect()
}
