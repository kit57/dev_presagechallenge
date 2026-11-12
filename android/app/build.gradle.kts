import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val localProperties = Properties().apply {
    val propertiesFile = rootProject.file("local.properties")
    if (propertiesFile.isFile) {
        propertiesFile.inputStream().use(::load)
    }
}
val presageApiKey = localProperties.getProperty("presage.apiKey", "")
val escapedPresageApiKey = presageApiKey
    .replace("\\", "\\\\")
    .replace("\"", "\\\"")

android {
    namespace = "com.kit57.signalsession"
    compileSdk {
        version = release(36) {
            minorApiLevel = 1
        }
    }

    defaultConfig {
        applicationId = "com.kit57.signalsession"
        minSdk = 28
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        buildConfigField("String", "PRESAGE_API_KEY", "\"$escapedPresageApiKey\"")
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.8.1")
    implementation("androidx.core:core-ktx:1.18.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.10.0")
    implementation("androidx.camera:camera-view:1.6.0")
    implementation("com.presagetech:smartspectra:3.4.0")
}
