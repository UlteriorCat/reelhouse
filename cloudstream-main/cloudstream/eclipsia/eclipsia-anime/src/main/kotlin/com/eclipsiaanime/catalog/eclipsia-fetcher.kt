package com.eclipsiaanime

internal fun normTitle(s: String?): String = s.orEmpty().lowercase().filter { it.isLetterOrDigit() }

internal fun currentAnimeSeason(): Pair<String, Int> {
    val c = java.util.Calendar.getInstance()
    val name = when (c.get(java.util.Calendar.MONTH)) {
        in 0..2 -> "WINTER"; in 3..5 -> "SPRING"; in 6..8 -> "SUMMER"; else -> "FALL"
    }
    return name to c.get(java.util.Calendar.YEAR)
}

internal class MetaEntry(val id: String, val synopsis: String?, val episodeCount: Int?, val poster: String?)
internal class MetaEp(val title: String?, val synopsis: String?, val thumb: String?, val airdate: String?, val minutes: Int?)

internal fun cleanSynopsis(s: String?, html: Boolean = false): String? {
    var t = s?.replace("\r", "") ?: return null
    if (html) {
        t = t.replace(BR, "\n").replace(TAGS, "")
    }
    return t.replace(CREDIT, "").replace(BLANKS, "\n\n").trim().takeIf { it.isNotBlank() }
}

private val BR = Regex("""(?i)<br\s*/?>""")
private val TAGS = Regex("""<[^>]+>""")
private val CREDIT = Regex("""\s*[(\[]\s*(Source|Written by)[^)\]]*[)\]]\s*$""", RegexOption.IGNORE_CASE)
private val BLANKS = Regex("""\n{3,}""")
