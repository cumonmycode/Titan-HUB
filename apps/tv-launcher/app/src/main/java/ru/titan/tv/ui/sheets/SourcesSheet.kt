package ru.titan.tv.ui.sheets

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import ru.titan.tv.inputs.TvSource
import ru.titan.tv.ui.LocalStage
import ru.titan.tv.ui.glass.Backdrop
import ru.titan.tv.ui.glass.Glass
import ru.titan.tv.ui.glass.Lens
import ru.titan.tv.ui.icons.TitanIcon
import ru.titan.tv.ui.theme.Ink
import ru.titan.tv.ui.theme.Type

private val ROW_FILL = Color.White.copy(alpha = 0.07f)
private val ICON_FILL = Color.White.copy(alpha = 0.1f)

/**
 * «Источники»: this screen, where the guest already is, and each HDMI socket. Choosing a socket hands the
 * picture to the TV's player; the remote's Home button brings the guest back here.
 */
@Composable
fun SourcesSheet(sources: List<TvSource>, backdrop: Backdrop, onOpen: (TvSource) -> Unit, onClose: () -> Unit, modifier: Modifier = Modifier) {
    val s = LocalStage.current
    val firstHdmi = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        withFrameNanos { }
        firstHdmi.requestSafely()
    }
    Glass(backdrop, s.dp(46), Lens.sheet(), modifier.width(s.dp(620))) {
        Column(
            Modifier.padding(start = s.dp(32), end = s.dp(32), top = s.dp(32), bottom = s.dp(28)),
            verticalArrangement = Arrangement.spacedBy(s.dp(12)),
        ) {
            BasicText("Источники", style = Type.title(s))
            BasicText(
                "Подключили приставку или ноутбук — выберите вход",
                style = Type.caption(s).copy(fontSize = s.sp(21)),
                modifier = Modifier.padding(top = s.dp(2), bottom = s.dp(16)),
            )
            SourceRow(icon = "tv", title = "Titan TV", detail = "Этот экран", current = true, onClick = onClose)
            sources.forEachIndexed { index, source ->
                SourceRow(
                    icon = "input",
                    title = source.label,
                    detail = if (source.hasSignal) "Есть сигнал" else "Вход HDMI",
                    signal = source.hasSignal,
                    modifier = if (index == 0) Modifier.focusRequester(firstHdmi) else Modifier,
                    onClick = { onOpen(source) },
                )
            }
            BasicText(
                "Вернуться сюда — кнопка «Домой» на пульте",
                style = Type.caption(s).copy(color = Ink.Tertiary, textAlign = TextAlign.Center),
                modifier = Modifier.fillMaxWidth().padding(top = s.dp(14)),
            )
        }
    }
}

@Composable
private fun SourceRow(
    icon: String,
    title: String,
    detail: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    current: Boolean = false,
    signal: Boolean = false,
) {
    val s = LocalStage.current
    var focused by remember { mutableStateOf(false) }
    val lift by rememberFocusLift(focused)
    Box(
        modifier
            .fillMaxWidth()
            .height(s.dp(84))
            .focusPop({ lift }, scale = 1.035f, corner = s.dp(26))
            .clip(RoundedCornerShape(s.dp(26)))
            .background(ROW_FILL)
            .onFocusChanged { focused = it.isFocused }
            .clickable(remember { MutableInteractionSource() }, indication = null, onClick = onClick),
    ) {
        Row(
            Modifier.padding(start = s.dp(14), end = s.dp(24)).align(Alignment.CenterStart),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(s.dp(18)),
        ) {
            Box(
                Modifier.size(s.dp(56)).clip(CircleShape).background(if (current) Ink.Accent else ICON_FILL),
                contentAlignment = Alignment.Center,
            ) {
                TitanIcon(icon, s.dp(30), Ink.Primary)
            }
            Column(Modifier.weight(1f)) {
                BasicText(title, style = Type.pill(s))
                Row(Modifier.padding(top = s.dp(5)), verticalAlignment = Alignment.CenterVertically) {
                    if (signal) Box(Modifier.padding(end = s.dp(8)).size(s.dp(10)).clip(CircleShape).background(Ink.Ok))
                    BasicText(detail, style = Type.caption(s))
                }
            }
            if (current) TitanIcon("check", s.dp(30), Ink.AccentSoft)
        }
    }
}
