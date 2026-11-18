val corePackage = extra["corePackage"] as String
val coreVariant = extra["coreVariant"] as String

val commonCore = listOf(
    "app-restart.kt",
    "memo.kt",
    "js/asset-reader.kt",
    "js/event-loop.kt",
    "js/sandbox.kt",
    "json/json.kt",
    "net/address-policy.kt",
    "net/cookie-store.kt",
    "net/net-policy.kt",
    "play/playback-rules.kt",
    "source/integrity.kt",
    "ui/fonts.kt",
    "ui/settings-dialog.kt",
    "ui/ui.kt",
)

val generatedCore = layout.buildDirectory.dir("generated/sharedCore/kotlin")

val generateSharedCore = tasks.register<Sync>("generateSharedCore") {
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
    from(rootProject.file("shared/src/$coreVariant/main/kotlin"))
    from(rootProject.file("shared/src/eclipsia/main/kotlin/com/eclipsia/core")) {
        include(commonCore)
        filter { it.replace("com.eclipsia", "com.$corePackage") }
        into("com/$corePackage/core")
    }
    into(generatedCore)
}

@Suppress("UNCHECKED_CAST")
val addKotlinSrcDir = rootProject.extra["addKotlinSrcDir"] as (Project, Any) -> Unit
addKotlinSrcDir(project, generatedCore.get().asFile)

tasks.configureEach {
    val n = name
    if (n != "generateSharedCore" &&
        ((n.startsWith("compile") && n.endsWith("Kotlin")) ||
            n.startsWith("ksp") || n.startsWith("kapt") ||
            n.startsWith("lint") || n.endsWith("LintModel") ||
            n.contains("SourcesJar", ignoreCase = true))
    ) {
        dependsOn(generateSharedCore)
    }
}
