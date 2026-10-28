package ru.titan.tv.airplay

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.SystemClock
import android.util.Log
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.DataInputStream
import java.io.IOException
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume
import kotlin.math.max

private const val TAG = "Titan/AirPlay"
private const val DISCOVERY_TIMEOUT_MS = 20_000L
private const val CONNECT_TIMEOUT_MS = 5_000
// The add-on pings every few seconds; this much silence means the link is dead
private const val READ_TIMEOUT_MS = 15_000
private const val FIRST_RETRY_MS = 3_000L
// A TV switched on from standby finds the add-on within this long; a refused attempt costs next to nothing
private const val MAX_RETRY_MS = 15_000L
private const val READ_BUFFER = 64 * 1024
// Twice the panel's size on a 1080p screen is sharp enough and keeps a cover to about 2 MB
private const val COVER_PX = 720
// Asking for audio focus is a binder call; a refused request is not repeated for every audio chunk
private const val FOCUS_RETRY_MS = 5_000L
private const val MAX_LEAD_MS = 2_000L
private const val NS_PER_MS = 1_000_000L

/** The AirPlay side of this TV as the UI sees it. */
data class AirPlayState(
    /** The speaker name iPhones see; null until the add-on confirms it is announced. */
    val receiverName: String? = null,
    val nowPlaying: NowPlaying? = null,
    val cover: ImageBitmap? = null,
)

/**
 * Keeps this TV connected to the Steklo AirPlay add-on in Home Assistant. The add-on announces an AirPlay 2
 * speaker named after the room while the link is up, and streams its audio, track details and cover here.
 */
class AirPlayLink(private val context: Context, private val scope: CoroutineScope) {
    private val _state = MutableStateFlow(AirPlayState())
    private val player = PcmPlayer()
    private val audio = context.getSystemService(AudioManager::class.java)
    private val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
        .setAudioAttributes(
            AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build(),
        )
        .build()
    private val volume = TvVolume(context, ::onTvVolume).also { tvVolume ->
        runCatching { tvVolume.start() }.onFailure { Log.w(TAG, "TV volume changes will not reach AirPlay", it) }
    }
    private var job: Job? = null
    private var coverJob: Job? = null
    private var roomName: String? = null
    private var hasFocus = false
    private var focusAskedAtMs = 0L

    /** Whether the sender in this session already got the TV's volume. */
    private var volumeSynced = false

    @Volatile
    private var output: OutputStream? = null

    val state: StateFlow<AirPlayState> = _state.asStateFlow()

    /** Passes a remote button on to the sending iPhone through the add-on; dropped when not linked. */
    fun send(command: AirPlayCommand) = sendLine(commandLine(command))

    /** Connects under [name], or reconnects when the room got a new name. */
    fun start(name: String) {
        if (name == roomName && job?.isActive == true) return
        roomName = name
        val previous = job
        // The old link must be gone before the new one starts, or both would feed one player
        job = scope.launch(Dispatchers.IO) {
            previous?.cancelAndJoin()
            linkLoop(name)
        }
    }

    private fun sendLine(line: String) {
        val out = output ?: return
        scope.launch(Dispatchers.IO) {
            try {
                synchronized(out) { out.write(line.toByteArray(Charsets.UTF_8)) }
            } catch (e: IOException) {
                Log.w(TAG, "AirPlay command not sent: ${e.message}")
            }
        }
    }

    private suspend fun linkLoop(name: String) {
        var retry = FIRST_RETRY_MS
        try {
            while (true) {
                var linked = false
                try {
                    discover()?.let { bridge -> session(bridge, name) { linked = true } }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    // Whatever broke this link, the next attempt starts clean
                    Log.i(TAG, "AirPlay link closed: ${e.message}")
                }
                reset()
                // A link that worked comes back soon; an add-on that keeps refusing is asked less and less often
                if (linked) retry = FIRST_RETRY_MS
                delay(retry)
                retry = (retry * 2).coerceAtMost(MAX_RETRY_MS)
            }
        } finally {
            reset()
        }
    }

    private suspend fun session(address: InetSocketAddress, name: String, onLinked: () -> Unit) = coroutineScope {
        val socket = Socket()
        // A blocking read ignores cancellation; closing the socket ends it
        val closer = launch {
            try {
                awaitCancellation()
            } finally {
                runCatching { socket.close() }
            }
        }
        try {
            socket.connect(address, CONNECT_TIMEOUT_MS)
            socket.soTimeout = READ_TIMEOUT_MS
            socket.tcpNoDelay = true
            val out = socket.getOutputStream()
            out.write(helloLine(name).toByteArray(Charsets.UTF_8))
            output = out
            onLinked()
            Log.i(TAG, "Linked to the AirPlay add-on at $address as «$name»")
            val input = DataInputStream(BufferedInputStream(socket.getInputStream(), READ_BUFFER))
            while (true) {
                ensureActive()
                when (val frame = readFrame(input)) {
                    is Frame.Audio -> play(frame.pcm)
                    is Frame.Event -> onEvent(frame)
                    is Frame.Cover -> onCover(frame.image)
                    Frame.Ping -> Unit
                }
            }
        } finally {
            output = null
            closer.cancel()
            runCatching { socket.close() }
        }
    }

    private fun play(pcm: ByteArray) {
        // Other players on the TV pause when AirPlay starts
        if (!hasFocus) {
            val now = SystemClock.elapsedRealtime()
            if (now - focusAskedAtMs >= FOCUS_RETRY_MS) {
                focusAskedAtMs = now
                hasFocus = audio.requestAudioFocus(focus) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
            }
        }
        player.write(pcm)
    }

    private fun onEvent(frame: Frame.Event) {
        val json = frame.json
        when (json.optString("type")) {
            "receiver" -> {
                // Every TV in an AirPlay group sounds this long after the add-on let go of the audio
                player.leadNs = json.optLong("lead_ms", DEFAULT_LEAD_MS.toLong()).coerceIn(0, MAX_LEAD_MS) * NS_PER_MS
                _state.update { it.copy(receiverName = json.optString("name").ifEmpty { null }) }
            }
            "volume" -> onSenderVolume(json.optDouble("level", -1.0))
            else -> if (isSessionEnd(json)) endSession() else onPlayback(json)
        }
    }

    private fun onPlayback(json: JSONObject) {
        // A new phone starts out with the TV's volume
        if (json.optString("type") == "session") volumeSynced = false
        val next = reduceNowPlaying(_state.value.nowPlaying, json, SystemClock.elapsedRealtime())
        _state.update { it.copy(nowPlaying = next) }
    }

    private fun endSession() {
        stopAudio()
        coverJob?.cancel()
        volumeSynced = false
        _state.update { it.copy(nowPlaying = null, cover = null) }
    }

    private fun onSenderVolume(level: Double) {
        if (level !in 0.0..1.0) return
        if (volumeSynced) {
            volume.fromSender(level)
            return
        }
        // The phone's first word on volume is its own old setting; the TV keeps its volume and tells the phone
        volumeSynced = true
        volume.startSession(level)?.let { sendLine(volumeLine(it)) }
    }

    /** The remote control changed the TV's volume; the phone's slider follows while it plays here. */
    private fun onTvVolume(level: Double) {
        if (_state.value.nowPlaying != null) sendLine(volumeLine(level))
    }

    private fun onCover(image: ByteArray) {
        coverJob?.cancel()
        if (image.isEmpty()) {
            _state.update { it.copy(cover = null) }
            return
        }
        // Decoding a big cover outlasts the TV's short audio queue, so it stays off the reading thread
        coverJob = scope.launch(Dispatchers.Default) {
            val bitmap = decodeCover(image) ?: return@launch
            ensureActive()
            _state.update { it.copy(cover = bitmap.asImageBitmap()) }
        }
    }

    private fun decodeCover(image: ByteArray): Bitmap? = try {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(image, 0, image.size, bounds)
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= COVER_PX) sample *= 2
        BitmapFactory.decodeByteArray(image, 0, image.size, BitmapFactory.Options().apply { inSampleSize = sample })
    } catch (e: OutOfMemoryError) {
        Log.w(TAG, "Cover of ${image.size} bytes is too big to show")
        null
    }

    private fun stopAudio() {
        player.stop()
        if (hasFocus) audio.abandonAudioFocusRequest(focus)
        hasFocus = false
        focusAskedAtMs = 0L
    }

    private fun reset() {
        stopAudio()
        coverJob?.cancel()
        volumeSynced = false
        _state.value = AirPlayState()
    }

    /** Finds the add-on over mDNS; null when it does not answer in time. */
    private suspend fun discover(): InetSocketAddress? = withTimeoutOrNull(DISCOVERY_TIMEOUT_MS) {
        suspendCancellableCoroutine { result ->
            val nsd = context.getSystemService(NsdManager::class.java)
            val done = AtomicBoolean(false)
            lateinit var discovery: NsdManager.DiscoveryListener
            val resolved = { host: InetSocketAddress ->
                if (done.compareAndSet(false, true)) {
                    runCatching { nsd.stopServiceDiscovery(discovery) }
                    result.resume(host)
                }
            }
            discovery = object : NsdManager.DiscoveryListener {
                override fun onServiceFound(info: NsdServiceInfo) {
                    // A fresh listener per resolve: NsdManager refuses one that is still busy
                    @Suppress("DEPRECATION")
                    nsd.resolveService(info, ResolveOnce(resolved))
                }

                override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                    Log.w(TAG, "mDNS discovery failed: $errorCode")
                }

                override fun onDiscoveryStarted(serviceType: String) = Unit
                override fun onServiceLost(info: NsdServiceInfo) = Unit
                override fun onDiscoveryStopped(serviceType: String) = Unit
                override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) = Unit
            }
            nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discovery)
            result.invokeOnCancellation { if (done.compareAndSet(false, true)) runCatching { nsd.stopServiceDiscovery(discovery) } }
        }
    }

    private class ResolveOnce(private val onResolved: (InetSocketAddress) -> Unit) : NsdManager.ResolveListener {
        override fun onServiceResolved(info: NsdServiceInfo) {
            @Suppress("DEPRECATION")
            val host = info.host ?: return
            onResolved(InetSocketAddress(host, info.port))
        }

        override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
            Log.w(TAG, "Resolving the AirPlay add-on failed: $errorCode")
        }
    }
}
