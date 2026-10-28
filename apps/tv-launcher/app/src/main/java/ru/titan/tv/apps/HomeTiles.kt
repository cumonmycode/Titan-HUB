package ru.titan.tv.apps

/** The apps a row lists, in its order; apps that are not installed are skipped. */
fun homeTiles(installed: List<AppEntry>, pinned: List<String>): List<AppEntry> {
    val byPackage = installed.associateBy { it.packageName }
    return pinned.distinct().mapNotNull { byPackage[it] }
}
