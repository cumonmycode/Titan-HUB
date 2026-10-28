package ru.titan.tv

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import ru.titan.tv.ui.ProvideStage
import ru.titan.tv.ui.sheets.RoomOverlay

/** Room controls over whatever is playing, opened by the remote's Assistant button. */
class RoomActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val graph = application.graph
        graph.smartHome.reload()
        setContent { ProvideStage { RoomOverlay(graph.smartHome, graph.tv, onClose = ::finish) } }
    }
}
