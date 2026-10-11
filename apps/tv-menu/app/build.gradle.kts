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
        targetSdk = 36
        versionCode = 5
        versionName = "2.1.0"
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
