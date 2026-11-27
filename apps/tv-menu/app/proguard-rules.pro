# Мост страницы экрана (MenuActivity.PageBridge): страница зовёт методы по имени.
-keepclassmembers class ru.titan.menu.** {
    @android.webkit.JavascriptInterface <methods>;
}
