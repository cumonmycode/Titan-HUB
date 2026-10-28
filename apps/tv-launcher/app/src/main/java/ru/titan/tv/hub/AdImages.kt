package ru.titan.tv.hub

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.MessageDigest

/**
 * Pictures for the ads, downloaded once and kept on disk, so the panel shows them after a restart
 * without the internet. Decoded no larger than the panel needs: the TV has 2 GB for everything.
 */
class AdImages(private val http: OkHttpClient, cacheDir: File) {
    private val dir = File(cacheDir, DIR).apply { mkdirs() }
    private val memory = LruCache<String, ImageBitmap>(MEMORY_ITEMS)

    suspend fun load(url: String, maxWidth: Int, maxHeight: Int): ImageBitmap? = withContext(Dispatchers.IO) {
        val key = "$url@${maxWidth}x$maxHeight"
        memory.get(key)?.let { return@withContext it }
        val file = File(dir, sha1(url))
        if (!file.exists() && !download(url, file)) return@withContext null
        decode(file, maxWidth, maxHeight)?.asImageBitmap()?.also { memory.put(key, it) }
    }

    private fun download(url: String, file: File): Boolean = runCatching {
        http.newCall(Request.Builder().url(url).build()).execute().use { response ->
            val body = response.body
            if (!response.isSuccessful || body == null) return false
            val partial = File(file.path + PARTIAL)
            partial.outputStream().use { body.byteStream().copyTo(it) }
            partial.renameTo(file)
        }
    }.getOrDefault(false)

    private fun decode(file: File, maxWidth: Int, maxHeight: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            // Not a picture after all; a later attempt downloads it again
            file.delete()
            return null
        }
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= maxWidth && bounds.outHeight / (sample * 2) >= maxHeight) sample *= 2
        return BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })
    }

    private fun sha1(text: String): String =
        MessageDigest.getInstance("SHA-1").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }

    private companion object {
        const val DIR = "ads"
        const val PARTIAL = ".part"
        const val MEMORY_ITEMS = 8
    }
}
