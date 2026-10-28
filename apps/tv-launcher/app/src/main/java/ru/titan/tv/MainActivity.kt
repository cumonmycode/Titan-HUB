package ru.titan.tv

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import ru.titan.tv.airplay.AirPlayService
import ru.titan.tv.ui.ProvideStage
import ru.titan.tv.ui.home.HomeScreen

class MainActivity : ComponentActivity() {
    private val viewModel: HomeViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { ProvideStage { HomeScreen(viewModel) } }
        // The home screen paints every pixel itself; a window background would cost the TV GPU a full extra fill per frame
        window.setBackgroundDrawable(null)
    }

    override fun onStart() {
        super.onStart()
        // Started while in front, the only moment Android allows it; it then outlives the launcher's screen
        AirPlayService.start(this)
    }

    override fun onResume() {
        super.onResume()
        viewModel.onResume()
    }

    // Home pressed while the launcher is already in front
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.hasCategory(Intent.CATEGORY_HOME)) viewModel.onHomePressed()
    }
}
