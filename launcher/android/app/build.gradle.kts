import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Signing: keystore.properties beside this project (never published) names the key that signs every version.
// Android installs an update only when it is signed by the same key, so keep the key and its passwords safe.
val keyProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "com.vittorionetti.atlas.launcher"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.vittorionetti.atlas.launcher"
        minSdk = 30
        targetSdk = 35
        versionCode = (project.property("atlasVersionCode") as String).toInt()
        versionName = project.property("atlasVersionName") as String
    }

    signingConfigs {
        if (keyProps.getProperty("storeFile") != null) create("release") {
            storeFile = file(keyProps.getProperty("storeFile"))
            storePassword = keyProps.getProperty("storePassword")
            keyAlias = keyProps.getProperty("keyAlias")
            keyPassword = keyProps.getProperty("keyPassword")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/atlasAssets"))
}

// The page, its fonts and your settings go into the app at build time:
//   launcher/web             the launcher's page
//   static/vendor/fonts      IBM Plex, the same files Atlas serves
//   launcher/rules.json      how apps are placed in your categories (else rules.example.json)
//   launcher/launcher.json   your Atlas server and a one-time pairing code (else launcher.example.json)
val launcherDir = rootProject.projectDir.parentFile
val atlasDir = launcherDir.parentFile
val copyAtlasAssets by tasks.registering(Copy::class) {
    into(layout.buildDirectory.dir("generated/atlasAssets"))
    from(File(launcherDir, "web")) { into("web") }
    from(File(atlasDir, "static/vendor/fonts")) { include("*.woff2", "OFL.txt"); into("web/fonts") }
    from(if (File(launcherDir, "rules.json").exists()) File(launcherDir, "rules.json") else File(launcherDir, "rules.example.json")) {
        rename { "rules.json" }; into("web")
    }
    from(if (File(launcherDir, "launcher.json").exists()) File(launcherDir, "launcher.json") else File(launcherDir, "launcher.example.json")) {
        rename { "launcher.json" }
    }
}
tasks.named("preBuild") { dependsOn(copyAtlasAssets) }
