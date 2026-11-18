package com.eclipsia.core.json

import org.json.JSONArray
import org.json.JSONObject

internal fun JSONObject.text(key: String): String? =
    optString(key, "").takeIf { it.isNotBlank() && it != "null" }

internal fun JSONArray?.objects(): List<JSONObject> =
    if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }

internal fun JSONArray?.strings(): List<String> =
    if (this == null) emptyList() else (0 until length()).mapNotNull { optString(it, "").takeIf { s -> s.isNotBlank() && s != "null" } }
