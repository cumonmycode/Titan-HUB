package ru.titan.menu

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log

/**
 * Объявление приставки в локальной сети (mDNS/Bonjour, как у Chromecast): телефон с
 * Titan HUB видит «Titan TV 4821» и по адресу из объявления идёт в LocalServer.
 * В TXT — код с экрана, модель и версия, чтобы телефон показал понятный список.
 */
class Advertiser(context: Context) {
    private val nsd: NsdManager? = context.getSystemService(NsdManager::class.java)
    private var listener: NsdManager.RegistrationListener? = null

    fun start(name: String, attributes: Map<String, String>) {
        stop()
        val manager = nsd ?: return
        val info = NsdServiceInfo().apply {
            serviceName = name
            serviceType = SERVICE_TYPE
            port = LocalServer.PORT
            attributes.forEach { (key, value) -> setAttribute(key, value.take(MAX_VALUE)) }
        }
        val registration = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(info: NsdServiceInfo) { Log.i(TAG, "В сети как «${info.serviceName}»") }
            override fun onRegistrationFailed(info: NsdServiceInfo, errorCode: Int) { Log.w(TAG, "Объявление в сети не удалось: $errorCode") }
            override fun onServiceUnregistered(info: NsdServiceInfo) = Unit
            override fun onUnregistrationFailed(info: NsdServiceInfo, errorCode: Int) = Unit
        }
        runCatching { manager.registerService(info, NsdManager.PROTOCOL_DNS_SD, registration) }
            .onSuccess { listener = registration }
            .onFailure { Log.w(TAG, "Объявление в сети не удалось", it) }
    }

    fun stop() {
        val registration = listener ?: return
        listener = null
        runCatching { nsd?.unregisterService(registration) }
    }

    companion object {
        const val SERVICE_TYPE = "_titanscreen._tcp"
        private const val TAG = "TitanMenu"
        private const val MAX_VALUE = 60
    }
}
