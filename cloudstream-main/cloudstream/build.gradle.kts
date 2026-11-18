import com.android.build.api.dsl.LibraryExtension
import com.lagradost.cloudstream3.gradle.CloudstreamExtension
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinJvmCompile

buildscript {
    repositories {
        google()
        mavenCentral()

        maven("https://jitpack.io") {
            content { includeGroupByRegex("com\\.github\\..*|com\\.lagradost.*") }
        }
    }

    dependencies {
        classpath("com.android.tools.build:gradle:9.1.1")

        classpath("com.github.recloudstream.gradle:com.lagradost.cloudstream3.gradle.gradle.plugin:${property("cloudstreamGradlePluginVersion")}")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.21")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
        maven("https://jitpack.io") {
            content { includeGroupByRegex("com\\.github\\..*|com\\.lagradost.*") }
        }
    }
}

fun Project.cloudstream(configuration: CloudstreamExtension.() -> Unit) = extensions.getByName<CloudstreamExtension>("cloudstream").configuration()

fun Project.android(configuration: LibraryExtension.() -> Unit) = extensions.getByName<LibraryExtension>("android").configuration()

extra["addKotlinSrcDir"] = { project: Project, dir: Any ->
    project.android { sourceSets.getByName("main").kotlin.directories.add(dir.toString()) }
}

val tmdbDefaultKey: String = providers.gradleProperty("tmdbApiKey")
    .orElse(providers.environmentVariable("TMDB_API_KEY"))
    .orElse("")
    .get()
    .trim()
    .replace("\\", "\\\\")
    .replace("\"", "\\\"")

subprojects {
    apply(plugin = "com.android.library")
    apply(plugin = "com.lagradost.cloudstream3.gradle")

    cloudstream {
        setRepo(System.getenv("GITHUB_REPOSITORY") ?: "user/repo")
    }

    android {
        defaultConfig {
            minSdk = 21
            buildConfigField("String", "TMDB_DEFAULT_KEY", "\"$tmdbDefaultKey\"")
        }
        buildFeatures {
            buildConfig = true
        }
        compileSdk = 35

        testOptions {
            unitTests.isReturnDefaultValues = true
        }

        compileOptions {
            sourceCompatibility = JavaVersion.VERSION_11
            targetCompatibility = JavaVersion.VERSION_11
        }

        tasks.withType<KotlinJvmCompile>().configureEach {
            compilerOptions {
                jvmTarget.set(JvmTarget.JVM_11)
                freeCompilerArgs.addAll(
                    "-Xno-call-assertions",
                    "-Xno-param-assertions",
                    "-Xno-receiver-assertions"
                )
            }
        }
    }

    dependencies {

        add("cloudstream", "com.lagradost:cloudstream3:${property("cloudstreamLibraryVersion")}")

        add("implementation", kotlin("stdlib"))
        add("implementation", "org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.1")
        add("implementation", "com.github.Blatzar:NiceHttp:0.4.11")
        add("implementation", "org.jsoup:jsoup:1.18.3")
        add("implementation", "com.fasterxml.jackson.module:jackson-module-kotlin:2.13.1")

        add("testImplementation", "junit:junit:4.13.2")
        add("testImplementation", "org.json:json:20260814")
        add("testImplementation", "com.squareup.okhttp3:okhttp:4.12.0")
        add("testImplementation", "org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.1")
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
