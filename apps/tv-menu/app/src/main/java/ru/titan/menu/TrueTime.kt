package ru.titan.menu

import android.content.Context
import android.content.SharedPreferences
import android.os.SystemClock
import android.util.Log
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.URL
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager
import kotlin.math.abs

/**
 * Точное время независимо от часов приставки.
 *
 * У приставки нет батарейки часов: после отключения питания дата встаёт на дату прошивки.
 * Android берёт время из сети только трижды с интервалом в минуту после загрузки, а потом
 * ждёт сутки — если роутер поднялся позже приставки, дата остаётся сбитой на целый день.
 * Поэтому приложение само спрашивает время у NTP-серверов (как и система — без шифрования),
 * а если UDP закрыт — берёт заголовок Date у сервера клуба. Дальше время считается от
 * монотонных часов с загрузки, которые от даты не зависят.
 *
 * По этому времени проверяются сертификаты (ClockTolerantTrust), идут часы на экране,
 * и система подталкивается взять время из сети заново (SystemClockFixer).
 */
object TrueTime {
    private const val TAG = "TitanMenu"
    private const val PREFS = "titan_time"
    private const val KEY_LAST_GOOD = "last_good"
    private const val NTP_PORT = 123
    private const val NTP_TIMEOUT_MS = 3_000
    private const val HTTP_TIMEOUT_MS = 6_000
    private const val NTP_EPOCH_OFFSET_SEC = 2_208_988_800L
    /** Расхождение больше — часы приставки считаем сбитыми. */
    private const val OFF_THRESHOLD_MS = 5 * 60_000L
    /** 01.10.2026: приложение вышло позже, более ранняя дата точно неверна. */
    private const val EARLIEST_REAL_TIME = 1_790_812_800_000L

    private val NTP_SERVERS = listOf("time.android.com", "time.google.com", "ru.pool.ntp.org", "ntp1.vniiftri.ru", "pool.ntp.org")

    @Volatile private var anchorWall = 0L
    @Volatile private var anchorElapsed = 0L
    @Volatile private var lastSyncElapsed = 0L
    @Volatile private var floor = EARLIEST_REAL_TIME
    private var prefs: SharedPreferences? = null

    fun init(context: Context) {
        prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        floor = maxOf(EARLIEST_REAL_TIME, prefs?.getLong(KEY_LAST_GOOD, 0L) ?: 0L)
    }

    val isKnown: Boolean get() = anchorElapsed != 0L

    /** Сколько прошло с последней удачной сверки (мс); без сверки — Long.MAX_VALUE. */
    val sinceSyncMs: Long get() = if (lastSyncElapsed == 0L) Long.MAX_VALUE else SystemClock.elapsedRealtime() - lastSyncElapsed

    /** Точное время, если удалось узнать; иначе — часы приставки. */
    fun now(): Long = if (isKnown) anchorWall + (SystemClock.elapsedRealtime() - anchorElapsed) else System.currentTimeMillis()

    /** Часы приставки сбиты: расходятся с точным временем или заведомо в прошлом. */
    fun isDeviceClockOff(): Boolean =
        if (isKnown) abs(now() - System.currentTimeMillis()) > OFF_THRESHOLD_MS else System.currentTimeMillis() < floor

    /** Сверка с сетью: NTP, потом Date серверов клуба. Блокирует поток — звать не из UI. */
    fun sync(httpsHosts: List<String>): Boolean {
        for (server in NTP_SERVERS) {
            val fix = runCatching { sntp(server) }.onFailure { Log.d(TAG, "NTP $server: ${it.message}") }.getOrNull()
            if (fix != null && accept(fix, "NTP $server")) return true
        }
        for (host in httpsHosts) {
            val fix = runCatching { httpDate(host) }.onFailure { Log.d(TAG, "Date $host: ${it.message}") }.getOrNull()
            if (fix != null && accept(fix, "Date $host")) return true
        }
        return false
    }

    /** Время [wall] в момент [elapsed] по монотонным часам. */
    private class Fix(val wall: Long, val elapsed: Long)

    private fun accept(fix: Fix, source: String): Boolean {
        if (fix.wall < floor) {
            Log.w(TAG, "$source прислал время раньше допустимого — пропускаем")
            return false
        }
        anchorWall = fix.wall
        anchorElapsed = fix.elapsed
        lastSyncElapsed = SystemClock.elapsedRealtime()
        prefs?.edit()?.putLong(KEY_LAST_GOOD, fix.wall)?.apply()
        val offset = now() - System.currentTimeMillis()
        if (abs(offset) > OFF_THRESHOLD_MS) Log.i(TAG, "Часы приставки расходятся с $source на ${offset / 60_000} мин")
        return true
    }

    private fun sntp(server: String): Fix? {
        val address = InetAddress.getByName(server)
        DatagramSocket().use { socket ->
            socket.soTimeout = NTP_TIMEOUT_MS
            val request = ByteArray(48).also { it[0] = 0x1B } // версия 3, режим «клиент»
            val sent = SystemClock.elapsedRealtime()
            socket.send(DatagramPacket(request, request.size, address, NTP_PORT))
            val response = DatagramPacket(ByteArray(48), 48)
            socket.receive(response)
            val received = SystemClock.elapsedRealtime()
            val data = response.data
            val mode = data[0].toInt() and 0x7
            val stratum = data[1].toInt() and 0xff
            if (mode != 4 && mode != 5) return null
            if (stratum !in 1..15) return null
            val transmit = ntpTimestamp(data, 40)
            if (transmit <= 0L) return null
            // Ответ ушёл примерно посередине пути туда-обратно.
            return Fix(transmit + (received - sent) / 2, received)
        }
    }

    private fun ntpTimestamp(data: ByteArray, offset: Int): Long {
        val seconds = read32(data, offset)
        if (seconds == 0L) return 0L
        val fraction = read32(data, offset + 4)
        return (seconds - NTP_EPOCH_OFFSET_SEC) * 1000L + fraction * 1000L / 0x1_0000_0000L
    }

    private fun read32(data: ByteArray, offset: Int): Long =
        ((data[offset].toLong() and 0xff) shl 24) or ((data[offset + 1].toLong() and 0xff) shl 16) or
            ((data[offset + 2].toLong() and 0xff) shl 8) or (data[offset + 3].toLong() and 0xff)

    /**
     * Заголовок Date сервера клуба — если NTP (UDP 123) закрыт. Сертификат по сбитым часам
     * «ещё не действует», поэтому доверие как у NTP: берём из ответа только время.
     */
    private fun httpDate(host: String): Fix? {
        val conn = URL(host.trimEnd('/') + "/api/health").openConnection() as HttpsURLConnection
        try {
            conn.sslSocketFactory = timeOnlyContext.socketFactory
            conn.hostnameVerifier = HostnameVerifier { _, _ -> true }
            conn.connectTimeout = HTTP_TIMEOUT_MS
            conn.readTimeout = HTTP_TIMEOUT_MS
            conn.instanceFollowRedirects = false
            conn.requestMethod = "HEAD"
            val sent = SystemClock.elapsedRealtime()
            conn.responseCode
            val received = SystemClock.elapsedRealtime()
            val header = conn.getHeaderField("Date") ?: return null
            val format = SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", Locale.US).apply { timeZone = TimeZone.getTimeZone("GMT") }
            val wall = format.parse(header)?.time ?: return null
            // Date — с точностью до секунды: берём середину секунды и середину пути.
            return Fix(wall + 500 + (received - sent) / 2, received)
        } finally {
            conn.disconnect()
        }
    }

    private val timeOnlyContext: SSLContext by lazy {
        val trustAny = object : X509TrustManager {
            override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) = Unit
            override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) = Unit
            override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
        }
        SSLContext.getInstance("TLS").apply { init(null, arrayOf(trustAny), SecureRandom()) }
    }
}
