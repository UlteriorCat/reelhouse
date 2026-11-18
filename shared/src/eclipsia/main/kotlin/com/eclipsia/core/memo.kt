package com.eclipsia.core

class Memo<T : Any>(private val load: () -> T?) {
    @Volatile
    private var value: T? = null

    fun get(): T? = value ?: synchronized(this) {
        value ?: load()?.also { value = it }
    }
}
