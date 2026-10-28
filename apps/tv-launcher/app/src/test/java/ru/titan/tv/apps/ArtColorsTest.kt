package ru.titan.tv.apps

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ArtColorsTest {

    private fun argb(a: Int, r: Int, g: Int, b: Int): Int = (a shl 24) or (r shl 16) or (g shl 8) or b
    private fun red(c: Int) = (c shr 16) and 0xFF
    private fun green(c: Int) = (c shr 8) and 0xFF
    private fun blue(c: Int) = c and 0xFF
    private fun luminance(c: Int) = 0.2126 * red(c) + 0.7152 * green(c) + 0.0722 * blue(c)

    @Test
    fun `mixing palettes lands on either end and halfway between`() {
        val from = ArtColors(argb(255, 0, 0, 0), argb(255, 0, 100, 0), argb(255, 200, 0, 0), argb(255, 255, 255, 255))
        val to = ArtColors(argb(255, 100, 100, 100), argb(255, 0, 0, 200), argb(255, 0, 0, 0), argb(255, 55, 55, 55))

        assertEquals(from, mixArtColors(from, to, 0f))
        assertEquals(to, mixArtColors(from, to, 1f))
        val half = mixArtColors(from, to, 0.5f)
        assertEquals(argb(255, 50, 50, 50), half.base)
        assertEquals(argb(255, 0, 50, 100), half.deep)
        assertEquals(argb(255, 100, 0, 0), half.vibrant)
        assertEquals(argb(255, 155, 155, 155), half.glow)
    }

    @Test
    fun `vibrant colour comes from the most saturated pixels`() {
        val pixels = IntArray(100) { i -> if (i < 70) argb(255, 40, 40, 40) else argb(255, 230, 30, 40) }

        val colors = extractArtColors(pixels)

        assertTrue(red(colors.vibrant) > 200)
        assertTrue(green(colors.vibrant) < 60)
    }

    @Test
    fun `palette goes from dark base to light glow`() {
        val pixels = IntArray(64) { argb(255, 40, 90, 220) }

        val colors = extractArtColors(pixels)

        assertTrue(luminance(colors.base) < luminance(colors.deep))
        assertTrue(luminance(colors.deep) < luminance(colors.vibrant))
        assertTrue(luminance(colors.vibrant) < luminance(colors.glow))
    }

    @Test
    fun `grey banner falls back to the default palette`() {
        val pixels = IntArray(64) { argb(255, 128, 128, 128) }

        assertEquals(DEFAULT_ART_COLORS, extractArtColors(pixels))
    }

    @Test
    fun `transparent pixels are ignored`() {
        val pixels = IntArray(100) { i -> if (i < 80) argb(0, 255, 0, 0) else argb(255, 20, 60, 230) }

        val colors = extractArtColors(pixels)

        assertTrue(blue(colors.vibrant) > 200)
        assertTrue(red(colors.vibrant) < 60)
    }
}
