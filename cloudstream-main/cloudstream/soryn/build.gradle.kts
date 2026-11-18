version = run {
    val text = file("src/main/assets/soryn/source.json").readText()
    val m = Regex("\"version\"\\s*:\\s*(\\d+)\\s*[,}]").find(text)
        ?: error("src/main/assets/soryn/source.json has no top-level integer \"version\": N")
    m.groupValues[1].toInt()
}

cloudstream {
    description = "Netflix, Prime Video, Disney+ & more"
    authors = listOf("Eclipsia")

    status = 1

    tvTypes = listOf("Movie", "TvSeries")
    language = "en"

    iconUrl = "https://codefloe.com/eclipsia/cloudstream/raw/branch/main/soryn.png"

    requiresResources = true
}

android {
    namespace = "com.soryn"
}

extra["corePackage"] = "soryn"
extra["coreVariant"] = "soryn"
apply(from = rootProject.file("gradle/shared-core.gradle.kts"))

dependencies {

    compileOnly("org.mozilla:rhino:1.8.1")
}

tasks.configureEach {
    if (this is Zip && name == "make") {
        into("assets") {
            from(layout.projectDirectory.dir("src/main/assets"))
            from(rootProject.layout.projectDirectory.dir("shared/src/soryn/main/assets"))
        }
    }
}
