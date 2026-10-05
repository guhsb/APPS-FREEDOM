plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

// Código que os dois apps usam: login, acesso ao site, widget, atualização automática e tela cheia
android {
    namespace = "br.com.cbfreedom.comum"
    compileSdk = 34
    defaultConfig { minSdk = 26 }
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
