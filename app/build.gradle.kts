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
        versionName = (System.getenv("VER_MAJ") ?: "3") + "." + (System.getenv("VER_MIN") ?: "0")   // 3.0 … 3.10, depois 4.0 … (o número de atualização é o versionCode)
    }

    // Assinatura: a chave NÃO fica no repositório. No GitHub ela vem dos Secrets
    // (FREEDOM_KEYSTORE e FREEDOM_KEYSTORE_PASSWORD, ver LEIA-ME). Sem eles (build no PC), usa a chave de teste do Android.
    val chave = System.getenv("FREEDOM_KEYSTORE_FILE")?.let { rootProject.file(it) }?.takeIf { it.exists() }
    signingConfigs {
        if (chave != null) create("freedom") {
            storeFile = chave
            storePassword = System.getenv("FREEDOM_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("FREEDOM_KEY_ALIAS") ?: "freedom"
            keyPassword = System.getenv("FREEDOM_KEYSTORE_PASSWORD")
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            signingConfig = if (chave != null) signingConfigs.getByName("freedom") else signingConfigs.getByName("debug")
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
