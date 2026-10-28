package ru.titan.tv.ui.ads

import android.graphics.Bitmap
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import kotlinx.coroutines.delay
import ru.titan.tv.hub.Ad
import ru.titan.tv.hub.QrMatrix
import ru.titan.tv.ui.LocalStage
import ru.titan.tv.ui.glass.Backdrop
import ru.titan.tv.ui.glass.Glass
import ru.titan.tv.ui.glass.Lens
import ru.titan.tv.ui.theme.Type

/** Loads an ad picture no larger than width×height pixels; null while it cannot. */
typealias AdImageLoader = suspend (url: String, width: Int, height: Int) -> ImageBitmap?

const val AD_WIDTH = 720
const val AD_HEIGHT = 148
private const val CORNER = 28
private const val PAD = 16
private const val QR_PAD = 10
private const val QR_CORNER = 16
private const val MS_PER_SECOND = 1_000L
// Like the ad band of the menu TV: the picture fills the panel dimmed, then sits whole on top
private const val FILL_ALPHA = 0.35f
private val QR_FILL = Color.White
private val IMAGE_FILL = Color(0xFF0B0810)

/**
 * The club's own ads — the same band as on the menu TV, set in «Экраны» in Titan HUB: pictures and cards
 * with a QR, one at a time, each for its own time. Glass like the chips, the height of the app tiles.
 * Not focusable: a guest scans the QR with a phone, the remote never stops here.
 */
@Composable
fun AdPanel(ads: List<Ad>, backdrop: Backdrop, image: AdImageLoader, modifier: Modifier = Modifier) {
    val s = LocalStage.current
    var index by remember(ads) { mutableIntStateOf(0) }
    LaunchedEffect(ads) {
        if (ads.size < 2) return@LaunchedEffect
        while (true) {
            delay(ads[index % ads.size].durationSec * MS_PER_SECOND)
            index = (index + 1) % ads.size
        }
    }
    AnimatedVisibility(
        visible = ads.isNotEmpty(),
        modifier = modifier,
        enter = fadeIn(tween(400)),
        exit = fadeOut(tween(250)),
    ) {
        val ad = ads.getOrNull(index % ads.size.coerceAtLeast(1)) ?: return@AnimatedVisibility
        Glass(backdrop, s.dp(CORNER), Lens.chip(), Modifier.size(s.dp(AD_WIDTH), s.dp(AD_HEIGHT))) {
            AnimatedContent(
                targetState = ad,
                transitionSpec = { fadeIn(tween(500, delayMillis = 150)) togetherWith fadeOut(tween(250)) },
                label = "ad",
            ) { shown ->
                if (shown.isImage) PictureAd(shown, image) else CardAd(shown)
            }
        }
    }
}

@Composable
private fun CardAd(ad: Ad) {
    val s = LocalStage.current
    val qr = ad.qr
    Row(
        Modifier.fillMaxSize().padding(s.dp(PAD)),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(s.dp(24)),
    ) {
        if (qr != null) QrTile(qr)
        Column(Modifier.padding(start = s.dp(if (qr == null) 16 else 0), end = s.dp(12))) {
            ad.title?.let {
                BasicText(
                    it,
                    style = Type.pill(s).copy(fontSize = s.sp(28), fontWeight = FontWeight.Bold),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            ad.body?.let {
                BasicText(
                    it,
                    style = Type.meta(s).copy(fontSize = s.sp(20), lineHeight = s.sp(26)),
                    maxLines = if (ad.title == null) 3 else 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = s.dp(6)),
                )
            }
        }
    }
}

@Composable
private fun QrTile(qr: QrMatrix) {
    val s = LocalStage.current
    val bitmap = remember(qr) { qrBitmap(qr) }
    Box(
        Modifier
            .size(s.dp(AD_HEIGHT - PAD * 2))
            .clip(RoundedCornerShape(s.dp(QR_CORNER)))
            .background(QR_FILL)
            .padding(s.dp(QR_PAD)),
    ) {
        // Every module a crisp square: no smoothing when a 33-pixel code is scaled up
        Image(bitmap, contentDescription = null, contentScale = ContentScale.FillBounds, filterQuality = FilterQuality.None, modifier = Modifier.fillMaxSize())
    }
}

@Composable
private fun PictureAd(ad: Ad, image: AdImageLoader) {
    val s = LocalStage.current
    val url = ad.imageUrl ?: return
    val (width, height) = with(LocalDensity.current) { s.dp(AD_WIDTH).roundToPx() to s.dp(AD_HEIGHT).roundToPx() }
    val picture by produceState<ImageBitmap?>(null, url) { value = image(url, width, height) }
    Box(Modifier.fillMaxSize().background(IMAGE_FILL)) {
        val bitmap = picture ?: return@Box
        if (ad.fillsFrame) {
            Image(bitmap, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
        } else {
            Image(bitmap, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize().alpha(FILL_ALPHA))
            Image(bitmap, contentDescription = null, contentScale = ContentScale.Fit, modifier = Modifier.fillMaxSize())
        }
    }
}

private fun qrBitmap(qr: QrMatrix): ImageBitmap {
    val pixels = IntArray(qr.size * qr.size) { i ->
        if (qr.isDark(i % qr.size, i / qr.size)) android.graphics.Color.BLACK else android.graphics.Color.WHITE
    }
    return Bitmap.createBitmap(pixels, qr.size, qr.size, Bitmap.Config.ARGB_8888).asImageBitmap()
}
