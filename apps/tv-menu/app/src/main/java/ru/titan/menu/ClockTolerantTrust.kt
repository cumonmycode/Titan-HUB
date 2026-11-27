package ru.titan.menu

import android.util.Log
import java.net.Socket
import java.security.KeyStore
import java.security.SecureRandom
import java.security.cert.CertPathBuilder
import java.security.cert.CertStore
import java.security.cert.CertificateException
import java.security.cert.CollectionCertStoreParameters
import java.security.cert.PKIXBuilderParameters
import java.security.cert.X509CertSelector
import java.security.cert.X509Certificate
import java.util.Date
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLEngine
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509ExtendedTrustManager

/**
 * Проверка сертификата, которой не мешают сбитые часы приставки.
 *
 * Сначала — обычная системная проверка. Если она не прошла, а часы приставки сбиты
 * (TrueTime знает точное время), цепочка проверяется заново — полностью, до корневых
 * сертификатов системы, — но на точное время. Имя сервера, как и раньше, сверяет
 * HttpsURLConnection. Часы в порядке — системный отказ остаётся отказом.
 *
 * Ставится для всех HttpsURLConnection приложения: страница экрана, данные и картинки
 * идут через OfflineCache, пульс и привязка — через HubClient.
 */
class ClockTolerantTrust private constructor(private val system: X509ExtendedTrustManager) : X509ExtendedTrustManager() {

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, socket: Socket?) =
        guard(chain) { system.checkServerTrusted(chain, authType, socket) }

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String, engine: SSLEngine?) =
        guard(chain) { system.checkServerTrusted(chain, authType, engine) }

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) =
        guard(chain) { system.checkServerTrusted(chain, authType) }

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String, socket: Socket?) =
        system.checkClientTrusted(chain, authType, socket)

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String, engine: SSLEngine?) =
        system.checkClientTrusted(chain, authType, engine)

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) = system.checkClientTrusted(chain, authType)

    override fun getAcceptedIssuers(): Array<X509Certificate> = system.acceptedIssuers

    private inline fun guard(chain: Array<X509Certificate>, check: () -> Unit) {
        try {
            check()
        } catch (e: CertificateException) {
            if (!TrueTime.isKnown || !TrueTime.isDeviceClockOff() || chain.isEmpty()) throw e
            try {
                verifyAt(chain, TrueTime.now())
            } catch (retry: Exception) {
                Log.w(TAG, "Сертификат не прошёл и по точному времени", retry)
                throw e
            }
        }
    }

    private fun verifyAt(chain: Array<X509Certificate>, time: Long) {
        val leaf = chain[0]
        leaf.extendedKeyUsage?.let { if (SERVER_AUTH !in it && ANY_USAGE !in it) throw CertificateException("Сертификат не для сервера") }
        val target = X509CertSelector().apply { certificate = leaf }
        val params = PKIXBuilderParameters(anchors, target).apply {
            isRevocationEnabled = false // системная проверка Android отзыв тоже не смотрит
            date = Date(time)
            addCertStore(CertStore.getInstance("Collection", CollectionCertStoreParameters(chain.toList())))
        }
        CertPathBuilder.getInstance("PKIX").build(params)
    }

    companion object {
        private const val TAG = "TitanMenu"
        private const val SERVER_AUTH = "1.3.6.1.5.5.7.3.1"
        private const val ANY_USAGE = "2.5.29.37.0"

        private val anchors: KeyStore by lazy { KeyStore.getInstance("AndroidCAStore").apply { load(null) } }

        /** Один раз на процесс: все HttpsURLConnection приложения проверяют сертификат так. */
        fun install() {
            val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
            factory.init(null as KeyStore?)
            val system = factory.trustManagers.filterIsInstance<X509ExtendedTrustManager>().firstOrNull()
            if (system == null) {
                Log.w(TAG, "Нет системной проверки сертификатов — оставляем как есть")
                return
            }
            val context = SSLContext.getInstance("TLS")
            context.init(null, arrayOf(ClockTolerantTrust(system)), SecureRandom())
            HttpsURLConnection.setDefaultSSLSocketFactory(context.socketFactory)
        }
    }
}
