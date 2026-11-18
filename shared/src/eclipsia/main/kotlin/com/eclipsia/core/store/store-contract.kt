package com.eclipsia.core.store

import android.content.Context

interface StoreContract {
    val context: Context
    val hideLabels: Boolean
    val customPosterEnabled: Boolean
    val customPosterTemplate: String

    fun tmdbKey(): String
}
