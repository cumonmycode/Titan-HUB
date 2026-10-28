package ru.titan.tv.apps

import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Four colours for the top-shelf art, taken from an app's banner: dark base to light glow. */
data class ArtColors(val base: Int, val deep: Int, val vibrant: Int, val glow: Int)

/** TITAN's own palette: near-black aubergine with the club's violet glowing through. */
val DEFAULT_ART_COLORS = ArtColors(
    base = 0xFF0A0710.toInt(),
    deep = 0xFF1B1238.toInt(),
    vibrant = 0xFF4E33B0.toInt(),
    glow = 0xFF7A5CE6.toInt(),
)

private const val MIN_ALPHA = 128
private const val MIN_SATURATION = 0.25f
private const val VIBRANT_SHARE = 0.25
private const val BASE_DARKEN = 0.82f
private const val DEEP_DARKEN = 0.45f
// Kept low: a glow washed out towards white reads as haze on a dark TV screen
private const val GLOW_LIGHTEN = 0.22f
private const val BLACK = 0xFF000000.toInt()
private const val WHITE = 0xFFFFFFFF.toInt()

/** [pixels] are ARGB ints; a downscaled banner of a few hundred pixels is plenty. */
fun extractArtColors(pixels: IntArray): ArtColors {
    val opaque = pixels.filter { (it ushr 24) >= MIN_ALPHA }
    val saturated = opaque.filter { saturation(it) >= MIN_SATURATION }
    if (saturated.isEmpty()) return DEFAULT_ART_COLORS
    val topCount = max(1, (saturated.size * VIBRANT_SHARE).toInt())
    val vibrant = average(saturated.sortedByDescending(::vividness).take(topCount))
    val dominant = average(opaque)
    return ArtColors(
        base = mix(dominant, BLACK, BASE_DARKEN),
        deep = mix(vibrant, BLACK, DEEP_DARKEN),
        vibrant = vibrant,
        glow = mix(vibrant, WHITE, GLOW_LIGHTEN),
    )
}

/** The palette [t] of the way from [from] to [to]; 0 is [from], 1 is [to]. */
fun mixArtColors(from: ArtColors, to: ArtColors, t: Float): ArtColors = ArtColors(
    base = mix(from.base, to.base, t),
    deep = mix(from.deep, to.deep, t),
    vibrant = mix(from.vibrant, to.vibrant, t),
    glow = mix(from.glow, to.glow, t),
)

private fun channels(c: Int) = Triple((c shr 16) and 0xFF, (c shr 8) and 0xFF, c and 0xFF)

private fun saturation(c: Int): Float {
    val (r, g, b) = channels(c)
    val hi = max(r, max(g, b))
    val lo = min(r, min(g, b))
    return if (hi == 0) 0f else (hi - lo).toFloat() / hi
}

private fun vividness(c: Int): Float {
    val (r, g, b) = channels(c)
    return saturation(c) * max(r, max(g, b)) / 255f
}

private fun average(colors: List<Int>): Int {
    val sums = colors.fold(Triple(0L, 0L, 0L)) { (r, g, b), c ->
        val (cr, cg, cb) = channels(c)
        Triple(r + cr, g + cg, b + cb)
    }
    val n = colors.size
    return rgb((sums.first / n).toInt(), (sums.second / n).toInt(), (sums.third / n).toInt())
}

private fun mix(a: Int, b: Int, t: Float): Int {
    val (ar, ag, ab) = channels(a)
    val (br, bg, bb) = channels(b)
    return rgb(
        (ar + (br - ar) * t).roundToInt(),
        (ag + (bg - ag) * t).roundToInt(),
        (ab + (bb - ab) * t).roundToInt(),
    )
}

private fun rgb(r: Int, g: Int, b: Int): Int = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
