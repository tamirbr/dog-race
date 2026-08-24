plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val alternateBuildDir = System.getenv("DOGRACE_BUILD_DIR")
if (!alternateBuildDir.isNullOrBlank()) {
    layout.buildDirectory.set(file(alternateBuildDir))
}

android {
    namespace = "com.dograce.game"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.dograce.game"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
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
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.webkit:webkit:1.11.0")
}
