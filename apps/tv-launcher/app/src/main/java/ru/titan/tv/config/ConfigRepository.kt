package ru.titan.tv.config

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Log
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** The active config plus a problem to show the user when the last import failed. */
data class ConfigState(val config: TitanConfig, val problem: String?)

val EMPTY_CONFIG = TitanConfig(
    homeAssistant = null,
    room = null,
    weather = null,
    pinnedApps = DEFAULT_PINNED_APPS,
    cinemaApps = DEFAULT_CINEMA_APPS,
)

/**
 * config.json arrives over adb in the app's external files folder. Because it holds the
 * Home Assistant token, it is validated, stored encrypted in private storage, and the
 * plain copy is deleted.
 */
class ConfigRepository(context: Context) {
    private val incoming = File(context.getExternalFilesDir(null), INCOMING_NAME)
    private val vault = SecureFile(File(context.filesDir, STORED_NAME))

    // Decrypted once; the Keystore is only touched again when a new file arrives
    @Volatile
    private var cached: TitanConfig? = null

    /** Reads files and may decrypt; call it off the main thread. Two resumes in a row must not import twice. */
    @Synchronized
    fun load(): ConfigState {
        val stored = cached ?: vault.read()
            .map { text -> text?.let { parseConfig(it).getOrNull() } ?: EMPTY_CONFIG }
            .getOrElse { return ConfigState(EMPTY_CONFIG, "Не удалось открыть сохранённые настройки — загрузите config.json ещё раз") }
        cached = stored
        if (!incoming.exists()) return ConfigState(stored, problem = null)
        val text = runCatching { incoming.readText() }.getOrElse {
            return ConfigState(stored, "Не удалось прочитать config.json: ${it.message}")
        }
        return parseConfig(text).fold(
            onSuccess = { config -> importConfig(text, config) },
            onFailure = { ConfigState(stored, it.message) },
        )
    }

    private fun importConfig(text: String, config: TitanConfig): ConfigState {
        val saved = runCatching { vault.write(text) }
            .onFailure { Log.e(TAG, "Config could not be encrypted", it) }
            .isSuccess
        if (!saved) return ConfigState(config, "config.json применён, но не сохранён — загрузите его ещё раз")
        if (!incoming.delete()) Log.w(TAG, "Plain config.json could not be deleted")
        cached = config
        return ConfigState(config, problem = null)
    }

    private companion object {
        const val TAG = "ConfigRepository"
        const val INCOMING_NAME = "config.json"
        const val STORED_NAME = "config.enc"
    }
}

/** A file encrypted with an AES-GCM key that never leaves the Android Keystore. */
private class SecureFile(private val file: File) {

    fun write(text: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key()) }
        val encrypted = cipher.doFinal(text.toByteArray(Charsets.UTF_8))
        file.writeBytes(byteArrayOf(cipher.iv.size.toByte()) + cipher.iv + encrypted)
    }

    /** Success(null) when nothing is stored yet; failure when the file exists but cannot be decrypted. */
    fun read(): Result<String?> {
        if (!file.exists()) return Result.success(null)
        return runCatching {
            val bytes = file.readBytes()
            val ivLength = bytes[0].toInt()
            val iv = bytes.copyOfRange(1, 1 + ivLength)
            val cipher = Cipher.getInstance(TRANSFORMATION).apply {
                init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, iv))
            }
            String(cipher.doFinal(bytes.copyOfRange(1 + ivLength, bytes.size)), Charsets.UTF_8)
        }.onFailure { Log.e(TAG, "Stored config could not be decrypted", it) }
    }

    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (keyStore.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build()
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).apply { init(spec) }.generateKey()
    }

    private companion object {
        const val TAG = "SecureFile"
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "titan-config"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val TAG_BITS = 128
    }
}
