package ru.titan.tv.ui.icons

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

private const val STROKE = 1.8f
private const val VIEWPORT = 24f
private const val FILLED = "F:"

// The mockup's 24×24 line icons; a "F:" prefix marks a filled path
private val PATHS: Map<String, List<String>> = mapOf(
    "bulb" to listOf("M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"),
    "chev" to listOf("M9 6l6 6l-6 6"),
    "film" to listOf(
        "M5.5 5h13a2.5 2.5 0 0 1 2.5 2.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5v-9A2.5 2.5 0 0 1 5.5 5z",
        "M7.5 5v14M16.5 5v14M3 9.5h4.5M3 14.5h4.5M16.5 9.5H21M16.5 14.5H21",
    ),
    "sunset" to listOf("M3 18h18M6.5 18a5.5 5.5 0 0 1 11 0M12 6.5V9M5.6 11.1l1.7 1.7M18.4 11.1l-1.7 1.7M8 21.5h8"),
    "sun" to listOf(
        "M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0",
        "M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8",
    ),
    "moon" to listOf("M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"),
    "ceiling" to listOf("M12 3v4.5M4.5 15a7.5 7.5 0 0 1 15 0zM10 18.5a2 2 0 0 0 4 0"),
    "floor" to listOf("M8 3h8l2.5 7h-13zM12 10v11M8.5 21h7"),
    "strip" to listOf(
        "M6 4.5h12a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 6 4.5z",
        "M3 19h.01M7 19h.01M11 19h.01M15 19h.01M19 19h.01M21 19h.01",
    ),
    "sconce" to listOf("M5 4v16M5 12h3.5M8.5 7.5h8L15 15h-5z"),
    "minus" to listOf("M6 12h12"),
    "grid" to listOf("M4.5 4.5h5v5h-5zM14.5 4.5h5v5h-5zM4.5 14.5h5v5h-5zM14.5 14.5h5v5h-5z"),
    "airplay" to listOf("M6.4 17.2a8 8 0 1 1 11.2 0", "M9 14.6a4.2 4.2 0 1 1 6 0", "F:M12 14.2l4.3 5.6H7.7z"),
    "music" to listOf("M9 18V6.5l10-2V16", "F:M9 18a2.6 2.6 0 1 1-5.2 0a2.6 2.6 0 1 1 5.2 0", "F:M19 16a2.6 2.6 0 1 1-5.2 0a2.6 2.6 0 1 1 5.2 0"),
    "play" to listOf("F:M8 5.5v13l10.5-6.5z"),
    "pause" to listOf("F:M7 5.5h3.6v13H7zM13.4 5.5H17v13h-3.6z"),
    "forward" to listOf("F:M4.5 6.5v11L12 12zM12 6.5v11l7.5-5.5z"),
    "rewind" to listOf("F:M19.5 6.5v11L12 12zM12 6.5v11L4.5 12z"),
    "check" to listOf("M5.5 12.5l4 4L18.5 7.5"),
    "bell" to listOf("M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z", "M10 20.5a2 2 0 0 0 4 0"),
    "input" to listOf(
        "M4 4.5h16A1.5 1.5 0 0 1 21.5 6v9a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 15V6A1.5 1.5 0 0 1 4 4.5z",
        "M8.5 20h7M7.5 10.5h8M13 8l2.5 2.5L13 13",
    ),
    "tv" to listOf(
        "M4 4.5h16A1.5 1.5 0 0 1 21.5 6v9a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 15V6A1.5 1.5 0 0 1 4 4.5z",
        "M8.5 20h7",
    ),
    "auto" to listOf("M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0", "M8.8 15.8L12 8l3.2 7.8M10 13.3h4"),
    "fan" to listOf(
        "M10.5 12a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0",
        "M12 10.5C10.8 6.5 12 3.8 14.6 4.4s1.6 4.8-2.6 6.1M13.5 12c4-1.2 6.7 0 6.1 2.6s-4.8 1.6-6.1-2.6",
        "M12 13.5c1.2 4-.0 6.7-2.6 6.1s-1.6-4.8 2.6-6.1M10.5 12c-4 1.2-6.7 0-6.1-2.6s4.8-1.6 6.1 2.6",
    ),
    "thermo" to listOf("M10 5a2 2 0 0 1 4 0v8.6a4 4 0 1 1-4 0z", "M12 9.5v6"),
    "back" to listOf("M15 6l-6 6l6 6"),
    "plus" to listOf("M12 6v12M6 12h12"),
    "mute" to listOf("M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9.5l4.5 4.5M20.5 9.5L16 14"),
    "speaker" to listOf("M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"),
    "power" to listOf("M12 3.5v8M7.05 6.3a7.5 7.5 0 1 0 9.9 0"),
    "cloud" to listOf("M7 18.5h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.1 9.6A4.5 4.5 0 0 0 7 18.5z"),
    "cloudSun" to listOf(
        "M8.5 3.5v1.3M3.6 5.6l.9.9M2 10.5h1.3M13.4 5.6l-.9.9M5.4 12.4a3.6 3.6 0 0 1 6.2-3.6",
        "M9.5 20.5H18a3.5 3.5 0 0 0 .5-6.96a4.8 4.8 0 0 0-9.2-.8a3.9 3.9 0 0 0 .2 7.76z",
    ),
    "rain" to listOf("M7 15h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.1 6.1A4.5 4.5 0 0 0 7 15zM8.5 18l-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5"),
    "wind" to listOf("M3 9h11a3 3 0 1 0-3-3M3 15h14a3 3 0 1 1-3 3M3 12h7"),
    "drop" to listOf("M12 3.5c3 3.6 5.5 6.6 5.5 10a5.5 5.5 0 0 1-11 0c0-3.4 2.5-6.4 5.5-10z"),
    "snow" to listOf("M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5"),
    "gear" to listOf(
        "M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
        "M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2L5.5 5.5",
        "M5.4 12a6.6 6.6 0 1 0 13.2 0a6.6 6.6 0 1 0-13.2 0",
    ),
)

object TitanIcons {
    private val cache = mutableMapOf<String, ImageVector>()

    /** Unknown names fall back to the bulb, matching the config's icon fallback. */
    fun named(name: String): ImageVector = cache.getOrPut(name) { build(name, PATHS[name] ?: PATHS.getValue("bulb")) }

    private fun build(name: String, paths: List<String>): ImageVector =
        ImageVector.Builder(
            name = name,
            defaultWidth = VIEWPORT.dp,
            defaultHeight = VIEWPORT.dp,
            viewportWidth = VIEWPORT,
            viewportHeight = VIEWPORT,
        ).apply {
            paths.forEach { path ->
                val filled = path.startsWith(FILLED)
                addPath(
                    pathData = addPathNodes(path.removePrefix(FILLED)),
                    fill = if (filled) SolidColor(Color.White) else null,
                    stroke = if (filled) null else SolidColor(Color.White),
                    strokeLineWidth = STROKE,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                )
            }
        }.build()
}

@Composable
fun TitanIcon(name: String, size: Dp, tint: Color, modifier: Modifier = Modifier) {
    Image(
        painter = rememberVectorPainter(TitanIcons.named(name)),
        contentDescription = null,
        modifier = modifier.size(size),
        colorFilter = ColorFilter.tint(tint),
    )
}
