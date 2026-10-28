package ru.titan.tv.ui.home

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.style.TextOverflow
import ru.titan.tv.airplay.AirPlayState
import ru.titan.tv.room.RoomUi
import ru.titan.tv.ui.LocalStage
import ru.titan.tv.ui.glass.Backdrop
import ru.titan.tv.ui.glass.Glass
import ru.titan.tv.ui.glass.Lens
import ru.titan.tv.ui.icons.TitanIcon
import ru.titan.tv.ui.sheets.focusPop
import ru.titan.tv.ui.sheets.rememberFocusLift
import ru.titan.tv.ui.theme.Ink
import ru.titan.tv.ui.theme.Type

private const val INVITE_MAX = 640
private const val INVITE_FADE_MS = 300
private val CALL_FILL = Brush.linearGradient(listOf(Ink.Accent.copy(alpha = 0.78f), Ink.AccentDeep.copy(alpha = 0.7f)))

/** The focus targets of the corner chips, so a closed sheet returns focus where it was opened. */
class TopBarFocus {
    val sources = FocusRequester()
    val room = FocusRequester()
    val call = FocusRequester()
}

/**
 * The top-right corner: inputs, the booth's light and air conditioner and the call for staff
 * as glass chips, and under them the invitation to play music over AirPlay.
 */
@Composable
fun TopBar(
    backdrop: Backdrop,
    room: RoomUi?,
    hasSources: Boolean,
    airplay: AirPlayState,
    staffCalled: Boolean,
    enabled: Boolean,
    focus: TopBarFocus,
    onSources: () -> Unit,
    onRoom: () -> Unit,
    onCallStaff: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val s = LocalStage.current
    Column(modifier, horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(s.dp(24))) {
        Row(horizontalArrangement = Arrangement.spacedBy(s.dp(16)), verticalAlignment = Alignment.CenterVertically) {
            if (hasSources) {
                GlassChip(backdrop, enabled, focus.sources, onSources) {
                    TitanIcon("input", s.dp(30), Ink.Primary)
                    BasicText("Источники", style = Type.pill(s))
                }
            }
            if (room != null) {
                GlassChip(backdrop, enabled, focus.room, onRoom) {
                    TitanIcon("bulb", s.dp(30), if (room.lightsOn > 0) Ink.Lamp else Ink.Secondary)
                    BasicText(if (room.climate != null) "Свет и климат" else "Свет", style = Type.pill(s))
                    roomSummary(room)?.let { BasicText(it, style = Type.pillSecondary(s)) }
                }
            }
            if (room?.canCallStaff == true) {
                GlassChip(backdrop, enabled, focus.call, onCallStaff, fill = CALL_FILL) {
                    TitanIcon(if (staffCalled) "check" else "bell", s.dp(30), Ink.Primary)
                    BasicText(if (staffCalled) "Администратор идёт" else "Позвать администратора", style = Type.pill(s))
                }
            }
        }
        // Hidden under an open panel, where its text would peek out beside the glass
        AirPlayInvite(airplay, visible = enabled)
    }
}

/** «2 из 2 · 22°»: how many lights are on and, when the air conditioner runs, its temperature. */
private fun roomSummary(room: RoomUi): String? = listOfNotNull(
    room.lights.takeIf { it.isNotEmpty() }?.let { "${room.lightsOn} из ${it.size}" },
    room.climate?.takeIf { it.isOn }?.target?.let { "$it°" },
).joinToString(" · ").ifEmpty { null }

/** Shown once the AirPlay add-on announces this TV; it gives way to the player while music is on. */
@Composable
private fun AirPlayInvite(airplay: AirPlayState, visible: Boolean) {
    val last = remember { arrayOfNulls<String>(1) }
    airplay.receiverName?.let { last[0] = it }
    AnimatedVisibility(
        visible = visible && airplay.receiverName != null && airplay.nowPlaying == null,
        enter = fadeIn(tween(INVITE_FADE_MS)),
        exit = fadeOut(tween(INVITE_FADE_MS)),
    ) {
        val name = airplay.receiverName ?: last[0] ?: return@AnimatedVisibility
        AirPlayInviteRow(name)
    }
}

@Composable
private fun AirPlayInviteRow(name: String) {
    val s = LocalStage.current
    Row(
        Modifier.padding(end = s.dp(8)),
        horizontalArrangement = Arrangement.spacedBy(s.dp(18)),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(horizontalAlignment = Alignment.End) {
            BasicText("Слушайте свою музыку через AirPlay", style = Type.pill(s).copy(fontSize = s.sp(28)))
            BasicText(
                "На iPhone выберите «$name» в списке AirPlay",
                style = Type.caption(s).copy(fontSize = s.sp(21)),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = s.dp(INVITE_MAX)).padding(top = s.dp(6)),
            )
        }
        Box(
            Modifier.size(s.dp(64)).clip(CircleShape).background(CALL_FILL),
            contentAlignment = Alignment.Center,
        ) {
            TitanIcon("airplay", s.dp(36), Ink.Primary)
        }
    }
}

@Composable
private fun GlassChip(
    backdrop: Backdrop,
    enabled: Boolean,
    focusRequester: FocusRequester,
    onClick: () -> Unit,
    fill: Brush? = null,
    content: @Composable RowScope.() -> Unit,
) {
    val s = LocalStage.current
    var focused by remember { mutableStateOf(false) }
    val lift by rememberFocusLift(focused)
    Glass(
        backdrop,
        s.dp(32),
        Lens.chip(),
        Modifier
            .height(s.dp(64))
            .focusPop({ lift }, scale = 1.1f, corner = s.dp(32))
            .focusRequester(focusRequester)
            .onFocusChanged { focused = it.isFocused }
            .clickable(remember { MutableInteractionSource() }, indication = null, enabled = enabled, onClick = onClick),
    ) {
        // matchParentSize: filling the max size would stretch the chip across the whole top bar
        if (fill != null) Box(Modifier.matchParentSize().background(fill))
        Row(
            Modifier.align(Alignment.Center).padding(horizontal = s.dp(26)),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(s.dp(14)),
            content = content,
        )
    }
}
