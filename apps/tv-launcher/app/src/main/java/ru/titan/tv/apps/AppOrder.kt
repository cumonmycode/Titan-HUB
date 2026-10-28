package ru.titan.tv.apps

/** The settings tile; opens system settings whichever package provides them. */
const val SETTINGS_PACKAGE = "titan:settings"

/** Android TV's own settings app, which shows up among the launchable apps. */
const val SYSTEM_SETTINGS_PACKAGE = "com.android.tv.settings"

data class AppEntry(val packageName: String, val label: String)

/** Folds the system settings app into the settings tile so it appears once, at the end. */
fun settingsKey(packageName: String): String =
    if (packageName == SYSTEM_SETTINGS_PACKAGE) SETTINGS_PACKAGE else packageName

/**
 * Pinned apps first in the order given, then the rest alphabetically,
 * with the settings tile last unless it is pinned. The launcher hides itself.
 */
fun orderApps(apps: List<AppEntry>, pinned: List<String>, selfPackage: String): List<AppEntry> {
    val visible = apps.filter { it.packageName != selfPackage }
    val byPackage = visible.associateBy { it.packageName }
    val pinnedApps = pinned.distinct().mapNotNull { byPackage[it] }
    val pinnedPackages = pinnedApps.map { it.packageName }.toSet()
    val (settings, others) = visible
        .filter { it.packageName !in pinnedPackages }
        .partition { it.packageName == SETTINGS_PACKAGE }
    return pinnedApps + others.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.label }) + settings
}
