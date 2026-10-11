package ru.titan.menu

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.RadioGroup
import android.widget.TextView
import android.widget.Toast

/**
 * Настройки приставки с пульта. Содержимое экрана (что показывать, поворот, тема,
 * слайды) задаётся в Titan HUB — здесь только подключение, автозапуск и выход.
 */
class SetupActivity : Activity() {
    private lateinit var prefs: Prefs
    private lateinit var connection: TextView
    private lateinit var unpair: Button
    private lateinit var legacyOff: Button
    private lateinit var autostart: TextView
    private lateinit var autostartButton: Button
    private lateinit var manual: View
    private lateinit var address: EditText
    private lateinit var rotations: RadioGroup

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_setup)
        prefs = Prefs(this)
        connection = findViewById(R.id.connection_status)
        unpair = findViewById(R.id.unpair)
        legacyOff = findViewById(R.id.legacy_off)
        autostart = findViewById(R.id.autostart_status)
        autostartButton = findViewById(R.id.autostart_button)
        findViewById<TextView>(R.id.version).text = getString(R.string.setup_version, BuildConfig.VERSION_NAME)
        manual = findViewById(R.id.manual)
        address = findViewById(R.id.address)
        rotations = findViewById(R.id.rotation)
        address.setText(prefs.manualAddress.orEmpty().ifBlank { DEFAULT_ADDRESS })
        rotations.check(rotationButton(prefs.rotation))
        address.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_DONE) saveManual()
            actionId == EditorInfo.IME_ACTION_DONE
        }
        findViewById<Button>(R.id.manual_save).setOnClickListener { saveManual() }

        val back = findViewById<Button>(R.id.back)
        back.setOnClickListener { finish() }
        unpair.setOnClickListener { confirmUnpair() }
        legacyOff.setOnClickListener {
            prefs.clearLegacy()
            finish()
        }
        autostartButton.setOnClickListener { requestAutostart() }
        findViewById<Button>(R.id.home_button).setOnClickListener { openSettings(Settings.ACTION_HOME_SETTINGS) }
        findViewById<Button>(R.id.system_settings).setOnClickListener { openSettings(Settings.ACTION_SETTINGS) }
        findViewById<Button>(R.id.exit).setOnClickListener { finishAffinity() }
        // Фокус пульта — на «Вернуться», когда экран уже собран (иначе приставка ставит его куда придётся).
        back.post { back.requestFocus() }
    }

    override fun onResume() {
        super.onResume()
        showConnection()
        showAutostart()
    }

    private fun showConnection() {
        val legacy = prefs.legacyUrl
        connection.text = when {
            prefs.isPaired -> getString(R.string.setup_connection_paired, prefs.screenName.orEmpty(), Uri.parse(prefs.host).host.orEmpty())
            legacy != null -> getString(R.string.setup_connection_legacy, Uri.parse(legacy).host.orEmpty(), prefs.pairCode)
            else -> getString(R.string.setup_connection_unpaired, prefs.pairCode)
        }
        unpair.visibility = if (prefs.isPaired) View.VISIBLE else View.GONE
        legacyOff.visibility = if (!prefs.isPaired && legacy != null) View.VISIBLE else View.GONE
        // Подключённым экраном управляет Titan HUB — ручные поля прячем.
        manual.visibility = if (prefs.isPaired) View.GONE else View.VISIBLE
    }

    private fun saveManual() {
        val raw = address.text.toString().trim()
        if (Prefs.menuUrl(raw) == null) {
            address.error = getString(R.string.setup_address_error)
            address.requestFocus()
            return
        }
        prefs.saveManual(raw, rotationOf(rotations.checkedRadioButtonId))
        finish()
    }

    private fun rotationButton(rotation: Int) = when (rotation) {
        90 -> R.id.rotate_90
        270 -> R.id.rotate_270
        else -> R.id.rotate_0
    }

    private fun rotationOf(buttonId: Int) = when (buttonId) {
        R.id.rotate_90 -> 90
        R.id.rotate_270 -> 270
        else -> 0
    }

    private fun confirmUnpair() {
        AlertDialog.Builder(this)
            .setTitle(R.string.setup_unpair_confirm)
            .setMessage(R.string.setup_unpair_message)
            .setPositiveButton(R.string.setup_unpair) { _, _ ->
                prefs.clearPairing()
                finish()
            }
            .setNegativeButton(R.string.setup_cancel, null)
            .show()
    }

    // С Android 10 приложение может открыть экран после загрузки только с разрешением «Поверх других приложений».
    private fun autostartAllowed() = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || Settings.canDrawOverlays(this)

    private fun showAutostart() {
        val allowed = autostartAllowed()
        autostart.setText(if (allowed) R.string.setup_autostart_on else R.string.setup_autostart_off)
        autostartButton.visibility = if (allowed) View.GONE else View.VISIBLE
    }

    private fun requestAutostart() {
        val opened = tryStart(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))) ||
            tryStart(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION))
        if (!opened) autostart.text = getString(R.string.setup_autostart_adb, packageName)
    }

    private fun openSettings(action: String) {
        if (!tryStart(Intent(action))) Toast.makeText(this, R.string.setup_no_screen, Toast.LENGTH_LONG).show()
    }

    private fun tryStart(intent: Intent): Boolean = try {
        startActivity(intent)
        true
    } catch (e: ActivityNotFoundException) {
        false
    }

    private companion object {
        const val DEFAULT_ADDRESS = "kbr.titanpos.ru"
    }
}
