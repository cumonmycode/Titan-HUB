import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// The key lives outside the repository, next to Titan Menu's. Without it the release is signed with
// this computer's debug key, and such an update will not install over the TV's copy.
val releaseKey = Properties().apply {
    val file = File(System.getProperty("user.home"), ".titan-keys/titan-menu.properties")
    if (file.exists()) file.inputStream().use(::load)
}

android {
    namespace = "ru.titan.tv"
    compileSdk = 37

    defaultConfig {
        applicationId = "ru.titan.tv"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
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
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            // The Wi-Fi helper must carry the same key: its reconnect receiver is guarded by a signature permission
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.animation)
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.coroutines.android)
    implementation(libs.okhttp)

    testImplementation(libs.junit)
    // Real org.json for JVM tests; android.jar only ships stubs
    testImplementation(libs.org.json)
}
