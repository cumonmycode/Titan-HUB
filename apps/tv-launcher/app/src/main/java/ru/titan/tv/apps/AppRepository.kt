package ru.titan.tv.apps

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.ResolveInfo
import android.graphics.Bitmap
import android.provider.Settings
import android.util.Log
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.core.graphics.drawable.toBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

data class LauncherApp(
    val packageName: String,
    val label: String,
    val banner: ImageBitmap?,
    val icon: ImageBitmap?,
    val colors: ArtColors,
    val eyebrow: String,
    val tagline: String,
)

private const val TAG = "AppRepository"
private const val SETTINGS_LABEL = "Настройки"
private const val BANNER_W = 320
private const val BANNER_H = 180
private const val ICON_SIZE = 192
private const val SAMPLE_W = 32
private const val SAMPLE_H = 18

private val SETTINGS_COLORS = ArtColors(
    base = 0xFF0B0D11.toInt(),
    deep = 0xFF2B313D.toInt(),
    vibrant = 0xFF6B7A99.toInt(),
    glow = 0xFFC9D4EA.toInt(),
)

private val DEFAULT_TAGLINE = "Приложение" to "OK — открыть"

// Live TV: the booth has no aerial. The package stays on the TV because it also plays the HDMI inputs,
// which «Источники» opens directly
private val HIDDEN_PACKAGES = setOf("com.mediatek.wwtv.tvcenter")

private val TAGLINES = mapOf(
    SETTINGS_PACKAGE to ("Система" to "Сеть, экран, пульт и приложения"),
    "com.google.android.youtube.tv" to ("Видео" to "Подписки, клипы и трансляции"),
    "tv.twitch.android.app" to ("Стримы" to "Игры, шоу и киберспорт в прямом эфире"),
    "com.spotify.tv.android" to ("Музыка" to "Плейлисты, альбомы и подкасты"),
    "ar.tvplayer.tv" to ("ТВ-каналы" to "Прямой эфир и телепрограмма"),
    "ru.kinopoisk.tv" to ("Онлайн-кинотеатр" to "Фильмы, сериалы и спорт"),
    "ru.rt.video.app.tv" to ("Онлайн-кинотеатр" to "Кино, сериалы и телеканалы"),
    "com.vk.tv" to ("Видео" to "Сериалы, шоу и клипы"),
    "rtb.mobile.android" to ("Видео" to "Шоу, блогеры и фильмы"),
    "top.rootu.lampa" to ("Каталог" to "Фильмы и сериалы из любых источников"),
)

/** Lists the apps that have a TV launch activity, with their banners and art colours. */
class AppRepository(private val context: Context) {
    private val pm = context.packageManager

    suspend fun load(pinned: List<String>): List<LauncherApp> = withContext(Dispatchers.Default) {
        val launchable = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER)
        val resolved = pm.queryIntentActivities(launchable, 0)
            .filter { it.activityInfo.packageName !in HIDDEN_PACKAGES }
            .distinctBy { it.activityInfo.packageName }
            .associateBy { settingsKey(it.activityInfo.packageName) }
        val entries = resolved.map { (key, info) -> AppEntry(key, info.loadLabel(pm).toString()) } +
            listOfNotNull(AppEntry(SETTINGS_PACKAGE, SETTINGS_LABEL).takeIf { SETTINGS_PACKAGE !in resolved })
        orderApps(entries, pinned, context.packageName).map { entry ->
            resolved[entry.packageName]?.let { toLauncherApp(it, entry.packageName) } ?: settingsApp()
        }
    }

    fun open(packageName: String) {
        val intent = when (packageName) {
            SETTINGS_PACKAGE -> Intent(Settings.ACTION_SETTINGS)
            else -> pm.getLeanbackLaunchIntentForPackage(packageName) ?: pm.getLaunchIntentForPackage(packageName)
        }
        if (intent == null) {
            Log.w(TAG, "No launch intent for $packageName")
            return
        }
        try {
            context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: ActivityNotFoundException) {
            Log.w(TAG, "Cannot open $packageName", e)
        }
    }

    /** The app's TV banner at [width]×[height], for the big cinema cards; null when it has none. */
    suspend fun largeBanner(packageName: String, width: Int, height: Int): ImageBitmap? = withContext(Dispatchers.Default) {
        runCatching {
            val info = pm.getApplicationInfo(packageName, 0)
            val activity = pm.getLeanbackLaunchIntentForPackage(packageName)?.component?.let { pm.getActivityInfo(it, 0) }
            (activity?.loadBanner(pm) ?: info.loadBanner(pm))?.toBitmap(width, height)?.asImageBitmap()
        }.getOrNull()
    }

    private fun toLauncherApp(info: ResolveInfo, packageName: String): LauncherApp {
        val activity = info.activityInfo
        val banner = (activity.loadBanner(pm) ?: activity.applicationInfo.loadBanner(pm))
            ?.toBitmap(BANNER_W, BANNER_H)
        val icon = if (banner == null) info.loadIcon(pm).toBitmap(ICON_SIZE, ICON_SIZE) else null
        val (eyebrow, tagline) = TAGLINES[packageName] ?: DEFAULT_TAGLINE
        return LauncherApp(
            packageName = packageName,
            label = info.loadLabel(pm).toString(),
            banner = banner?.asImageBitmap(),
            icon = icon?.asImageBitmap(),
            colors = artColorsOf(banner ?: icon),
            eyebrow = eyebrow,
            tagline = tagline,
        )
    }

    private fun settingsApp() = LauncherApp(
        packageName = SETTINGS_PACKAGE,
        label = SETTINGS_LABEL,
        banner = null,
        icon = null,
        colors = SETTINGS_COLORS,
        eyebrow = "Система",
        tagline = "Сеть, экран, пульт и приложения",
    )
}

/** The backdrop palette of any picture: an app banner or an AirPlay cover. */
internal fun artColorsOf(bitmap: Bitmap?): ArtColors {
    if (bitmap == null) return DEFAULT_ART_COLORS
    val small = Bitmap.createScaledBitmap(bitmap, SAMPLE_W, SAMPLE_H, true)
    val pixels = IntArray(SAMPLE_W * SAMPLE_H)
    small.getPixels(pixels, 0, SAMPLE_W, 0, 0, SAMPLE_W, SAMPLE_H)
    return extractArtColors(pixels)
}
