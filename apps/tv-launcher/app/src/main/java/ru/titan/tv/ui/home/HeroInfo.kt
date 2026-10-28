package ru.titan.tv.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import ru.titan.tv.ui.LocalStage
import ru.titan.tv.ui.Stage
import ru.titan.tv.ui.brand.TitanLogo
import ru.titan.tv.ui.icons.TitanIcon
import ru.titan.tv.ui.theme.Ink
import ru.titan.tv.ui.theme.Type
import ru.titan.tv.weather.WeatherNow
import ru.titan.tv.weather.formatTemperature
import kotlinx.coroutines.delay
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

private const val MINUTE_MS = 60_000L
private val RUSSIAN = Locale.forLanguageTag("ru")
private val TIME_FORMAT = DateTimeFormatter.ofPattern("HH:mm")
private val DATE_FORMAT = DateTimeFormatter.ofPattern("EEEE, d MMMM", RUSSIAN)

private const val CLOCK_SIZE = 184
private const val DATE_SIZE = 40
private const val LOGO = 46
private const val WEATHER_ICON = 48

fun clockStyle(s: Stage, size: Int = CLOCK_SIZE) = Type.number(s, size).copy(
    fontWeight = FontWeight.SemiBold,
    letterSpacing = (-0.045).em,
    lineHeight = s.sp(size),
)

/** The club's mark, then the time, the date and the weather, readable from the sofa. */
@Composable
fun HeroInfo(weather: WeatherNow?, modifier: Modifier = Modifier) {
    val s = LocalStage.current
    val now = rememberMinuteClock()
    Column(modifier) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(s.dp(20))) {
            TitanLogo(s.dp(LOGO))
            BasicText("TITAN", style = Type.eyebrow(s).copy(color = Ink.Primary, fontSize = s.sp(28), fontWeight = FontWeight.Bold, letterSpacing = 0.32.em))
        }
        BasicText(now.format(TIME_FORMAT), style = clockStyle(s), modifier = Modifier.padding(top = s.dp(18)))
        val line = Type.meta(s).copy(fontSize = s.sp(DATE_SIZE), color = Ink.Primary)
        BasicText(
            now.format(DATE_FORMAT).replaceFirstChar { it.titlecase(RUSSIAN) },
            style = line,
            modifier = Modifier.padding(top = s.dp(4)),
        )
        if (weather != null) {
            Row(
                Modifier.padding(top = s.dp(22)),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(s.dp(16)),
            ) {
                TitanIcon(weather.condition.icon, s.dp(WEATHER_ICON), Ink.Sun)
                BasicText(formatTemperature(weather.temperature), style = Type.number(s, DATE_SIZE))
                BasicText(weather.condition.label, style = line.copy(color = Ink.Secondary))
            }
        }
    }
}

@Composable
fun rememberMinuteClock(): LocalDateTime {
    var now by remember { mutableStateOf(LocalDateTime.now()) }
    LaunchedEffect(Unit) {
        while (true) {
            now = LocalDateTime.now()
            delay(MINUTE_MS - System.currentTimeMillis() % MINUTE_MS)
        }
    }
    return now
}
