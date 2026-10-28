package ru.titan.tv.ui.sheets

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import ru.titan.tv.apps.LauncherApp
import ru.titan.tv.ui.LocalStage
import ru.titan.tv.ui.glass.Backdrop
import ru.titan.tv.ui.glass.Glass
import ru.titan.tv.ui.glass.Lens
import ru.titan.tv.ui.home.AppTile
import ru.titan.tv.ui.theme.Type

/** Every installed app; OK opens one. */
@Composable
fun AppsSheet(
    apps: List<LauncherApp>,
    backdrop: Backdrop,
    onOpen: (LauncherApp) -> Unit,
    modifier: Modifier = Modifier,
) {
    val s = LocalStage.current
    val firstFocus = remember { FocusRequester() }
    LaunchedEffect(apps.isNotEmpty()) {
        if (apps.isEmpty()) return@LaunchedEffect
        withFrameNanos { }
        firstFocus.requestSafely()
    }
    Glass(backdrop, s.dp(46), Lens.sheet(), modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().padding(top = s.dp(44))) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = s.dp(56)),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Bottom,
            ) {
                BasicText("Все приложения", style = Type.title(s))
                BasicText("OK — открыть · «Назад» — на главный экран", style = Type.caption(s).copy(fontSize = s.sp(20)))
            }
            LazyVerticalGrid(
                columns = GridCells.FixedSize(s.dp(248)),
                contentPadding = PaddingValues(horizontal = s.dp(40), vertical = s.dp(48)),
                horizontalArrangement = Arrangement.spacedBy(s.dp(40), Alignment.CenterHorizontally),
                verticalArrangement = Arrangement.spacedBy(s.dp(12)),
            ) {
                itemsIndexed(apps, key = { _, app -> app.packageName }) { index, app ->
                    AppTile(
                        app = app,
                        enabled = true,
                        onFocused = {},
                        onClick = { onOpen(app) },
                        modifier = if (index == 0) Modifier.focusRequester(firstFocus) else Modifier,
                    )
                }
            }
        }
    }
}
