plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "br.com.cbfreedom.app"
    compileSdk = 34

    defaultConfig {
        // mesmo identificador do antigo "Freedom Comercial": o app novo instala por cima dele e mantém o login
        applicationId = "br.com.cbfreedom.comercial"
        minSdk = 26
        targetSdk = 34
        // cada build do GitHub ganha um número maior, assim o APK novo instala por cima do antigo
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "2." + (System.getenv("GITHUB_RUN_NUMBER") ?: "0")
    }

    signingConfigs {
        create("freedom") {
            storeFile = rootProject.file("freedom.keystore")
            storePassword = "freedom123"
            keyAlias = "freedom"
            keyPassword = "freedom123"
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("freedom")
        }
        getByName("debug") {
            signingConfig = signingConfigs.getByName("freedom")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    // avisos do verificador do Android não impedem de gerar o APK
    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
}

dependencies {
    implementation(project(":comum"))
}
