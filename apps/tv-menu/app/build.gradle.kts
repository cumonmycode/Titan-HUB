import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Ключ подписи лежит вне репозитория. Без него релиз подписывается отладочным ключом
// этого компьютера — такое обновление поверх установленного APK не встанет.
val releaseKey = Properties().apply {
    val file = File(System.getProperty("user.home"), ".titan-keys/titan-menu.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

android {
    namespace = "ru.titan.menu"
    compileSdk = 36

    defaultConfig {
        applicationId = "ru.titan.menu"
        // Android 7.1+: раньше система не доверяет сертификату Let's Encrypt (ISRG Root X1).
        minSdk = 25
        // 28 нарочно: с targetSdk 29+ Android не даёт приложению включить Wi‑Fi, а приставка
        // должна возвращаться в сеть сама (NetworkKeeper). APK ставится мимо Google Play.
        targetSdk = 28
        versionCode = 6
        versionName = "2.2.0"
    }

    signingConfigs {
        if (!releaseKey.isEmpty) {
            create("release") {
                storeFile = File(releaseKey.getProperty("storeFile"))
                storePassword = releaseKey.getProperty("storePassword")
                keyAlias = releaseKey.getProperty("keyAlias")
                keyPassword = releaseKey.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    lint {
        // Требование Google Play к targetSdk; приложение туда не публикуется (см. targetSdk выше).
        disable += "ExpiredTargetSdkVersion"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}
