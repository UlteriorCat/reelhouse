version = run {
    val text = file("src/main/assets/playz/source.json").readText()
    val m = Regex("\"version\"\\s*:\\s*(\\d+)\\s*[,}]").find(text)
        ?: error("src/main/assets/playz/source.json has no top-level integer \"version\": N")
    m.groupValues[1].toInt()
}

cloudstream {
    description = "Live Sports Events"
    authors = listOf("Eclipsia")

    status = 1

    tvTypes = listOf("Live")
    language = "en"

    iconUrl = "https://codefloe.com/eclipsia/cloudstream/raw/branch/main/livesports.png"

    requiresResources = true
}

android {
    namespace = "com.playz"
}

extra["corePackage"] = "playz"
extra["coreVariant"] = "playz"
apply(from = rootProject.file("gradle/shared-core.gradle.kts"))

dependencies {

    compileOnly("org.mozilla:rhino:1.8.1")
    testImplementation("org.mozilla:rhino:1.8.1")
}

tasks.configureEach {
    if (this is Zip && name == "make") {
        into("assets") {
            from(layout.projectDirectory.dir("src/main/assets"))
            from(rootProject.layout.projectDirectory.dir("shared/src/playz/main/assets"))
        }
    }
}
