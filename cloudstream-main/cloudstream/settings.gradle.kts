rootProject.name = "CloudstreamPlugins"

val projectNames = mapOf(
    "eclipsia" to "Eclipsia",
    "eclipsia-anime" to "EclipsiaAnime",
    "eclipsia-bdix" to "EclipsiaBDIX",
    "soryn" to "Soryn",
)

fun includeModule(dir: File) {
    val name = projectNames[dir.name] ?: dir.name
    include(name)
    project(":$name").projectDir = dir
}

file("eclipsia")
    .listFiles()
    ?.filter { it.isDirectory && File(it, "build.gradle.kts").exists() }
    ?.sortedBy { it.name }
    ?.forEach { includeModule(it) }

file("soryn").takeIf { File(it, "build.gradle.kts").exists() }?.let { includeModule(it) }
