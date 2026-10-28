package ru.titan.tv.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import ru.titan.tv.ui.Stage

object Ink {
    val Primary = Color(0xFFF6F7FA)
    val Secondary = Color(0xBDF6F7FA)
    val Tertiary = Color(0x80F6F7FA)
    val Lamp = Color(0xFFFFC98A)
    val Sun = Color(0xFFFFE0A3)
    val Ok = Color(0xFF7EE2A8)
    val Pending = Color(0xFFFFC46B)
    val Error = Color(0xFFFF8A80)
    val OnLight = Color(0xFF15161A)
    val OnLamp = Color(0xFF1B1307)

    /** TITAN violet: the one accent, for what is on, chosen or calling. */
    val Accent = Color(0xFF8B5CF6)
    val AccentSoft = Color(0xFFC6B4FF)
    val AccentDeep = Color(0xFF2A1B5C)
    val Logo = Color(0xFF7C5AF0)
}

/** Type roles; sizes are design pixels on the 1920 canvas. */
object Type {
    // No text shadows: on Android 9 a blurred shadow under big text is redrawn on the CPU every animated frame

    fun display(s: Stage) = TextStyle(
        color = Ink.Primary,
        fontSize = s.sp(92),
        fontWeight = FontWeight.Bold,
        letterSpacing = (-0.035).em,
        lineHeight = s.sp(98),
    )

    fun eyebrow(s: Stage) = TextStyle(
        color = Ink.Secondary,
        fontSize = s.sp(21),
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.08.em,
    )

    fun meta(s: Stage) = TextStyle(color = Ink.Secondary, fontSize = s.sp(27), fontWeight = FontWeight.Medium)

    fun title(s: Stage) = TextStyle(
        color = Ink.Primary,
        fontSize = s.sp(44),
        fontWeight = FontWeight.Bold,
        letterSpacing = (-0.03).em,
    )

    fun pill(s: Stage) = TextStyle(color = Ink.Primary, fontSize = s.sp(24), fontWeight = FontWeight.SemiBold)

    fun pillSecondary(s: Stage) = pill(s).copy(color = Ink.Secondary, fontWeight = FontWeight.Medium)

    fun caption(s: Stage) = TextStyle(color = Ink.Secondary, fontSize = s.sp(18), fontWeight = FontWeight.Medium)

    fun label(s: Stage) = TextStyle(
        color = Ink.Tertiary,
        fontSize = s.sp(17),
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.09.em,
    )

    fun number(s: Stage, size: Int) = TextStyle(
        color = Ink.Primary,
        fontSize = s.sp(size),
        fontWeight = FontWeight.SemiBold,
        letterSpacing = (-0.02).em,
        fontFeatureSettings = "tnum",
    )
}
