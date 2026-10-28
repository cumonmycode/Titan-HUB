package ru.titan.tv.airplay

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTimestamp
import android.media.AudioTrack
import android.os.Process
import android.os.SystemClock
import android.util.Log
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private const val TAG = "Titan/AirPlay"
const val SAMPLE_RATE = 44_100
private const val BYTES_PER_FRAME = 4
private const val NS_PER_SECOND = 1_000_000_000L
private const val NS_PER_MS = 1_000_000L
// The add-on releases audio this long before its AirPlay time unless it says otherwise
const val DEFAULT_LEAD_MS = 250
// Silence this long means the sender paused or the link dropped: stop, and line up afresh when audio returns
private const val UNDERRUN_MS = 300L
// Audio piling up past this means the output stalled; newer audio is dropped instead of filling the memory
private const val MAX_QUEUED_BYTES = SAMPLE_RATE * BYTES_PER_FRAME * 2
// After the TV refused an audio output, it is asked again only this much later, not for every chunk
private const val RETRY_AFTER_FAILURE_MS = 2_000L
// Off by more than this, the TV jumps: it drops audio or inserts silence; below it, it plays a touch faster or slower
internal const val JUMP_NS = 25 * NS_PER_MS
// Errors under this are timing noise
internal const val STEADY_NS = NS_PER_MS
// A chunk is stretched or squeezed by at most this share: 0.5 % is about 9 cents of pitch, which nobody hears
internal const val MAX_STRETCH = 0.005
// Each chunk works off this share of the remaining error, so a TV settles within seconds without overshooting
internal const val CATCH_UP_SHARE = 0.2
// Never more than half a second of silence at once, whatever the clock says
internal const val MAX_PAD_FRAMES = SAMPLE_RATE / 2
// How far back the earliest arrival is looked for: long enough to see past Wi-Fi hiccups, short enough to follow clock drift
internal const val CLOCK_WINDOW_NS = 10 * NS_PER_SECOND
// Audio arriving this much later than the stream's pace for this long means the sender really paused or skipped
internal const val GAP_NS = 60 * NS_PER_MS
internal const val GAP_HOLD_NS = 500 * NS_PER_MS
private const val REPORT_EVERY_NS = 30 * NS_PER_SECOND

internal fun framesToNs(frames: Long): Long = frames * NS_PER_SECOND / SAMPLE_RATE

internal fun nsToFrames(ns: Long): Long = ns * SAMPLE_RATE / NS_PER_SECOND

/**
 * Frames to drop from the head of a chunk (positive) or of silence to put before it (negative) when the TV
 * would play it [errorNs] too late (positive) or too early (negative); zero leaves small errors to [stretch].
 */
internal fun jump(errorNs: Long, chunkFrames: Int): Int = when {
    errorNs > JUMP_NS -> min(chunkFrames.toLong(), nsToFrames(errorNs)).toInt()
    errorNs < -JUMP_NS -> -min(MAX_PAD_FRAMES.toLong(), nsToFrames(-errorNs)).toInt()
    else -> 0
}

/** Frames to take out of (positive) or add to (negative) a chunk of [chunkFrames] to work off [errorNs] gently. */
internal fun stretch(errorNs: Long, chunkFrames: Int): Int {
    if (abs(errorNs) < STEADY_NS) return 0
    val wanted = (nsToFrames(errorNs) * CATCH_UP_SHARE).roundToInt()
    val limit = max(1, (chunkFrames * MAX_STRETCH).roundToInt())
    return wanted.coerceIn(-limit, limit)
}

/**
 * [pcm] played back as [frames] whole stereo frames by linear interpolation. The first and last frames stay put,
 * so chunks still join seamlessly, and the slight change of speed has no clicks of dropped frames.
 */
internal fun resample(pcm: ByteArray, frames: Int): ByteArray {
    val inFrames = pcm.size / BYTES_PER_FRAME
    if (frames == inFrames || inFrames < 2 || frames < 2) return pcm
    val input = ByteBuffer.wrap(pcm).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
    val out = ByteBuffer.allocate(frames * BYTES_PER_FRAME).order(ByteOrder.LITTLE_ENDIAN)
    val step = (inFrames - 1).toDouble() / (frames - 1)
    for (i in 0 until frames) {
        val position = i * step
        val left = min(position.toInt(), inFrames - 2)
        val fraction = position - left
        for (channel in 0..1) {
            val a = input.get(left * 2 + channel)
            val b = input.get((left + 1) * 2 + channel)
            out.putShort((a + (b - a) * fraction).roundToInt().toShort())
        }
    }
    return out.array()
}

/**
 * When the add-on let go of each frame, read from when the frames arrived. Network delays only ever make audio
 * late, so the earliest arrival in a recent window, less the stream position, is when frame 0 left the add-on.
 * Every TV fed by the same AirPlay group sees the same release times, which is what keeps them together.
 */
internal class StreamClock {
    // Arrival time and stream start it implies, kept rising so the first entry is always the earliest start
    private val starts = ArrayDeque<Pair<Long, Long>>()
    private var lateSinceNs = -1L

    /** The stream's start time in the TV's clock, after a chunk whose first frame is [firstFrame] arrived at [arrivalNs]. */
    fun add(arrivalNs: Long, firstFrame: Long): Long {
        val start = arrivalNs - framesToNs(firstFrame)
        val current = starts.firstOrNull()?.second
        if (current != null && start - current > GAP_NS) {
            // A short Wi-Fi stall catches up quickly; a sender that paused or skipped stays late
            if (lateSinceNs < 0) lateSinceNs = arrivalNs
            if (arrivalNs - lateSinceNs >= GAP_HOLD_NS) reset()
        } else {
            lateSinceNs = -1L
        }
        while (starts.isNotEmpty() && starts.last().second >= start) starts.removeLast()
        starts.addLast(arrivalNs to start)
        while (starts.first().first < arrivalNs - CLOCK_WINDOW_NS) starts.removeFirst()
        return starts.first().second
    }

    fun reset() {
        starts.clear()
        lateSinceNs = -1L
    }
}

private class Chunk(val pcm: ByteArray, val arrivalNs: Long, val firstFrame: Long)

/**
 * Plays the AirPlay stream on the TV in step with the other speakers. Each frame is due a fixed lead after the
 * add-on let go of it; the TV's audio output reports when what it was given will actually sound, and the player
 * drops or adds audio to land on time, so TVs with slow and fast audio hardware still play together.
 */
class PcmPlayer {
    private val queue = LinkedBlockingQueue<Chunk>()
    private val queuedBytes = AtomicInteger(0)
    private val clock = StreamClock()
    private val stamp = AudioTimestamp()
    private var receivedFrames = 0L
    private var reportedAtNs = 0L

    /** How long after the add-on lets go of a frame it should sound; set from what the add-on announces. */
    @Volatile
    var leadNs = DEFAULT_LEAD_MS * NS_PER_MS

    @Volatile
    private var worker: Thread? = null

    @Volatile
    private var failedAtMs = -RETRY_AFTER_FAILURE_MS

    fun write(pcm: ByteArray) {
        val arrival = System.nanoTime()
        if (queuedBytes.get() > MAX_QUEUED_BYTES) return
        if (worker?.isAlive != true) {
            if (SystemClock.elapsedRealtime() - failedAtMs < RETRY_AFTER_FAILURE_MS) return
            worker = Thread(::run, "AirPlay audio").also(Thread::start)
        }
        queue.put(Chunk(pcm, arrival, receivedFrames))
        receivedFrames += pcm.size / BYTES_PER_FRAME
        queuedBytes.addAndGet(pcm.size)
    }

    /** Stops at once and forgets what is queued, for a dropped link or a stopped sender. */
    fun stop() {
        worker?.interrupt()
        worker = null
        queue.clear()
        queuedBytes.set(0)
    }

    private fun run() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
        try {
            while (true) {
                var chunk: Chunk? = queue.take()
                // After a pause the sender starts a fresh timeline
                clock.reset()
                val track = newTrack()
                try {
                    track.play()
                    var written = 0L
                    while (chunk != null) {
                        queuedBytes.addAndGet(-chunk.pcm.size)
                        written += play(track, chunk, written)
                        chunk = queue.poll(UNDERRUN_MS, TimeUnit.MILLISECONDS)
                    }
                } finally {
                    track.release()
                }
            }
        } catch (_: InterruptedException) {
            // stop() asked for it
        } catch (e: Exception) {
            // The TV took its audio output away (HDMI change, audio server restart); the next audio tries again
            Log.w(TAG, "Audio output failed", e)
            failedAtMs = SystemClock.elapsedRealtime()
            queue.clear()
            queuedBytes.set(0)
        }
    }

    /** Writes [chunk] so its first frame sounds on time; returns the frames handed to the output. */
    private fun play(track: AudioTrack, chunk: Chunk, written: Long): Long {
        val due = clock.add(chunk.arrivalNs, chunk.firstFrame) + framesToNs(chunk.firstFrame) + leadNs
        val sounds = soundsAt(track, written)
        val error = sounds - due
        report(sounds, error)
        val frames = chunk.pcm.size / BYTES_PER_FRAME
        val jump = jump(error, frames)
        return when {
            jump > 0 -> output(track, chunk.pcm.copyOfRange(jump * BYTES_PER_FRAME, chunk.pcm.size))
            jump < 0 -> output(track, ByteArray(-jump * BYTES_PER_FRAME)) + output(track, chunk.pcm)
            else -> output(track, resample(chunk.pcm, frames - stretch(error, frames)))
        }
    }

    /** When frame number [written] of this track will sound, as the audio output reports it. */
    private fun soundsAt(track: AudioTrack, written: Long): Long {
        if (track.getTimestamp(stamp) && stamp.framePosition > 0) {
            return stamp.nanoTime + framesToNs(written - stamp.framePosition)
        }
        // Until the output reports timestamps, what it has not played yet is the best guess
        val played = track.playbackHeadPosition.toLong() and 0xFFFF_FFFFL
        return System.nanoTime() + framesToNs(written - played)
    }

    private fun output(track: AudioTrack, pcm: ByteArray): Long {
        if (pcm.isEmpty()) return 0
        val written = track.write(pcm, 0, pcm.size)
        if (written < 0) throw IllegalStateException("AudioTrack.write returned $written")
        return (written / BYTES_PER_FRAME).toLong()
    }

    /** Now and then, how far ahead the TV's audio runs and how close to time it is, for tuning by the logs. */
    private fun report(sounds: Long, error: Long) {
        val now = System.nanoTime()
        if (now - reportedAtNs < REPORT_EVERY_NS) return
        reportedAtNs = now
        Log.i(TAG, "Audio output latency ${(sounds - now) / NS_PER_MS} ms, off time by ${error / NS_PER_MS} ms, lead ${leadNs / NS_PER_MS} ms")
    }

    private fun newTrack(): AudioTrack {
        val format = AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(SAMPLE_RATE)
            .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
            .build()
        val minBuffer = AudioTrack.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT)
        // An error code instead of a size still gets a buffer of 100 ms
        val buffer = if (minBuffer > 0) minBuffer * 2 else SAMPLE_RATE * BYTES_PER_FRAME / 10
        return AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build(),
            )
            .setAudioFormat(format)
            .setBufferSizeInBytes(buffer)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
    }
}
