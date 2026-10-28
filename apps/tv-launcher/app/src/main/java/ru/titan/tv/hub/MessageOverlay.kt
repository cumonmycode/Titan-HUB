package ru.titan.tv.hub

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import ru.titan.tv.R
import kotlin.math.roundToInt

/**
 * A message from the staff at the top of the screen, over a film, a game or the home screen, for a few
 * seconds. Plain views in an overlay window: the guest's app keeps playing and keeps the remote.
 * Needs «display over other apps», granted over adb (`appops set ru.titan.tv SYSTEM_ALERT_WINDOW allow`);
 * without it the message is a system toast.
 */
class MessageOverlay(private val context: Context) {
    private val windows = context.getSystemService(WindowManager::class.java)
    private val main = Handler(Looper.getMainLooper())
    private var shown: View? = null
    private val hide = Runnable { dismiss() }

    fun show(text: String, seconds: Int) {
        main.post {
            if (!Settings.canDrawOverlays(context)) {
                Toast.makeText(context, text, Toast.LENGTH_LONG).show()
                return@post
            }
            removeNow()
            val card = card(text)
            // A wrap-content window is first measured at a dialog's width and the text would wrap early
            card.measure(
                View.MeasureSpec.makeMeasureSpec(px(MAX_WIDTH), View.MeasureSpec.AT_MOST),
                View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED),
            )
            val params = WindowManager.LayoutParams(
                card.measuredWidth,
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                PixelFormat.TRANSLUCENT,
            ).apply {
                gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
                y = px(TOP)
            }
            runCatching { windows.addView(card, params) }.onFailure { return@post }
            shown = card
            card.alpha = 0f
            card.translationY = -px(RISE).toFloat()
            card.animate().alpha(1f).translationY(0f).setDuration(IN_MS).start()
            main.removeCallbacks(hide)
            main.postDelayed(hide, seconds * MS_PER_SECOND)
        }
    }

    fun dismiss() {
        main.post {
            main.removeCallbacks(hide)
            val card = shown ?: return@post
            card.animate().alpha(0f).translationY(-px(RISE).toFloat()).setDuration(OUT_MS).withEndAction { remove(card) }.start()
            shown = null
        }
    }

    private fun removeNow() {
        main.removeCallbacks(hide)
        shown?.let(::remove)
        shown = null
    }

    private fun remove(view: View) {
        runCatching { windows.removeView(view) }
    }

    private fun card(text: String): View {
        val logo = ImageView(context).apply {
            setImageResource(R.drawable.ic_launcher)
            background = GradientDrawable().apply { cornerRadius = px(LOGO_CORNER).toFloat() }
            clipToOutline = true
            layoutParams = LinearLayout.LayoutParams(px(LOGO), px(LOGO)).apply { marginEnd = px(GAP) }
        }
        val caption = TextView(context).apply {
            this.text = CAPTION
            setTextColor(ACCENT_SOFT)
            setTextSize(TypedValue.COMPLEX_UNIT_PX, px(CAPTION_SIZE).toFloat())
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            letterSpacing = CAPTION_TRACKING
        }
        val message = TextView(context).apply {
            this.text = text
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_PX, px(TEXT_SIZE).toFloat())
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            maxWidth = px(TEXT_WIDTH)
            setPadding(0, px(CAPTION_GAP), 0, 0)
        }
        val words = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            addView(caption)
            addView(message)
        }
        return LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(px(PAD_X), px(PAD_Y), px(PAD_X + GAP), px(PAD_Y))
            background = GradientDrawable().apply {
                cornerRadius = px(CORNER).toFloat()
                setColor(CARD)
                setStroke(px(STROKE), RIM)
            }
            addView(logo)
            addView(words)
        }
    }

    // Sizes are design pixels on the 1920-wide canvas, like the rest of the launcher
    private fun px(design: Int): Int = (design * context.resources.displayMetrics.widthPixels / CANVAS_WIDTH).roundToInt()

    private companion object {
        const val CAPTION = "TITAN · СООБЩЕНИЕ"
        const val CANVAS_WIDTH = 1920f
        const val TOP = 56
        const val RISE = 24
        const val LOGO = 76
        const val LOGO_CORNER = 20
        const val GAP = 28
        const val PAD_X = 28
        const val PAD_Y = 24
        const val CORNER = 36
        const val STROKE = 2
        const val CAPTION_SIZE = 20
        const val CAPTION_GAP = 6
        const val CAPTION_TRACKING = 0.12f
        const val TEXT_SIZE = 38
        const val TEXT_WIDTH = 1240
        const val MAX_WIDTH = 1500
        const val IN_MS = 220L
        const val OUT_MS = 180L
        const val MS_PER_SECOND = 1_000L
        val CARD = Color.rgb(20, 15, 30)
        val RIM = Color.argb(170, 139, 92, 246)
        val ACCENT_SOFT = Color.rgb(198, 180, 255)
    }
}
