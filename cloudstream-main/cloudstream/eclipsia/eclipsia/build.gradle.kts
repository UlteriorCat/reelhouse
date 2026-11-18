version = run {
    val text = file("src/main/assets/manifest.json").readText()
    val m = Regex("\"version\"\\s*:\\s*(\\d+)\\s*[,}]").find(text)
        ?: error("src/main/assets/manifest.json has no top-level integer \"version\": N")
    m.groupValues[1].toInt()
}

cloudstream {
    description = "Curated collection of Providers"
    authors = listOf("Eclipsia")

    status = 1

    tvTypes = listOf("Movie", "TvSeries")
    language = "en"

    iconUrl = "https://codefloe.com/eclipsia/cloudstream/raw/branch/main/eclipsia.png"

    requiresResources = true
}

android {
    namespace = "com.eclipsia"

    sourceSets.getByName("main").kotlin.directories.add(rootProject.file("shared/src/eclipsia/main/kotlin").absolutePath)
}

dependencies {

    compileOnly("org.mozilla:rhino:1.8.1")
}

tasks.configureEach {
    if (this is Zip && name == "make") {
        into("assets") {
            from(layout.projectDirectory.dir("src/main/assets"))
            from(rootProject.layout.projectDirectory.dir("shared/src/eclipsia/main/assets"))
        }
    }
}
