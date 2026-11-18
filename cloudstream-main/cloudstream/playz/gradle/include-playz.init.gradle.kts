gradle.settingsEvaluated {
    val dir = File(rootDir, "playz")
    if (File(dir, "build.gradle.kts").exists()) {
        include(":playz")
        project(":playz").projectDir = dir
    }
}
