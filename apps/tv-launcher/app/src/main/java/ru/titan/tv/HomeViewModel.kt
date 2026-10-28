package ru.titan.tv

import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.compose.ui.graphics.ImageBitmap
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import ru.titan.tv.airplay.AirPlayCommand
import ru.titan.tv.apps.AppEntry
import ru.titan.tv.apps.LauncherApp
import ru.titan.tv.apps.homeTiles
import ru.titan.tv.home.StaffCall
import ru.titan.tv.inputs.TvSource
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class HomeViewModel(application: Application) : AndroidViewModel(application) {
    private val graph = application.graph
    val smartHome = graph.smartHome
    val tv = graph.tv
    val wifiNotices = graph.wifi.notices
    val airplay = graph.airplay.state
    val sources: StateFlow<List<TvSource>> = graph.inputs.sources

    fun sendAirPlay(command: AirPlayCommand) = graph.airplay.send(command)

    private val _allApps = MutableStateFlow<List<LauncherApp>>(emptyList())

    /** Every launchable app, alphabetically with settings last, for the all-apps grid. */
    val allApps: StateFlow<List<LauncherApp>> = _allApps.asStateFlow()

    /** The home row as config.json sets it; guests cannot rearrange it, so every evening starts the same. */
    val homeApps: StateFlow<List<LauncherApp>> = combine(_allApps, smartHome.config) { all, config ->
        installed(all, config.config.pinnedApps)
    }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    /** The online cinemas behind the «Фильмы и сериалы» tile. */
    val cinemaApps: StateFlow<List<LauncherApp>> = combine(_allApps, smartHome.config) { all, config ->
        installed(all, config.config.cinemaApps)
    }.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    private val _homePresses = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val homePresses: SharedFlow<Unit> = _homePresses.asSharedFlow()

    private var reloadJob: Job? = null

    private val packageChanges = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) = reloadApps(debounce = true)
    }

    init {
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_PACKAGE_ADDED)
            addAction(Intent.ACTION_PACKAGE_REMOVED)
            addAction(Intent.ACTION_PACKAGE_CHANGED)
            addDataScheme("package")
        }
        ContextCompat.registerReceiver(application, packageChanges, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        reloadApps()
    }

    fun onResume() {
        smartHome.reload()
        graph.inputs.refresh()
    }

    fun onHomePressed() {
        _homePresses.tryEmit(Unit)
    }

    fun open(app: LauncherApp) = graph.apps.open(app.packageName)

    fun openSource(source: TvSource) = graph.inputs.open(source)

    fun callStaff(): StaffCall = smartHome.callStaff()

    suspend fun largeBanner(packageName: String, width: Int, height: Int): ImageBitmap? =
        graph.apps.largeBanner(packageName, width, height)

    private fun installed(all: List<LauncherApp>, packages: List<String>): List<LauncherApp> {
        val byPackage = all.associateBy { it.packageName }
        return homeTiles(all.map { AppEntry(it.packageName, it.label) }, packages).mapNotNull { byPackage[it.packageName] }
    }

    // An install fires several package broadcasts; only the last reload counts
    private fun reloadApps(debounce: Boolean = false) {
        reloadJob?.cancel()
        reloadJob = viewModelScope.launch {
            if (debounce) delay(PACKAGE_DEBOUNCE_MS)
            _allApps.value = graph.apps.load(pinned = emptyList())
        }
    }

    override fun onCleared() {
        getApplication<Application>().unregisterReceiver(packageChanges)
    }

    private companion object {
        const val PACKAGE_DEBOUNCE_MS = 500L
    }
}
