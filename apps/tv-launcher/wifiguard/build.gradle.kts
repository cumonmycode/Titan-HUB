import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
}

val releaseKey = Properties().apply {
    val file = File(System.getProperty("user.home"), ".titan-keys/titan-menu.properties")
    if (file.exists()) file.inputStream().use(::load)
}

android {
    namespace = "ru.titan.wifi"
    compileSdk = 37

    defaultConfig {
        applicationId = "ru.titan.wifi"
        minSdk = 26
        // Deliberately old: from API 29 on, an ordinary app may no longer turn Wi-Fi on or reconnect it
        targetSdk = 28
        versionCode = 1
        versionName = "1.0"
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
            // Same key as the launcher, so the launcher holds the signature permission that guards the helper
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        // The old target is the whole point of this app
        disable += setOf("ExpiredTargetSdkVersion", "OldTargetApi")
    }
}

dependencies {
    testImplementation(libs.junit)
}
