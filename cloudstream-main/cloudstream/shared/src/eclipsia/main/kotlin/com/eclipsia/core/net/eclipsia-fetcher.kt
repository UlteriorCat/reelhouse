package com.eclipsia.core.net

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

internal class RawResponse(val code: Int, val text: String?, val retryAfter: String?)

internal class FetchTuning(
    val parallel: Int,
    val maxEntries: Int,
    val attemptTimeoutMs: Long = 7_000L,
    val attempts: Int = 3,
    val backoffMs: Long = 300L,
    val maxRetryAfterMs: Long = 4_000L,
    val breakerThreshold: Int = 5,
    val breakerOpenMs: Long = 10_000L,
    val missTtlMs: Long = 5 * 60 * 1000L,
    val fatalTtlMs: Long = 60_000L,
    val staleMs: Long = 24 * 60 * 60 * 1000L,
    val maxWeight: Long = Long.MAX_VALUE,
    val backgroundParallel: Int = 0,
)

internal class EclipsiaFetcher<T : Any>(
    private val tuning: FetchTuning,
    private val parse: (String) -> T?,
    private val weigh: (T) -> Long = { 0L },
) {
    private class Entry<V>(val value: V?, val at: Long, val missTtlMs: Long = 0L)

    private class Breaker {
        val failures = AtomicInteger(0)
        val openUntil = AtomicLong(0L)
    }

    private sealed interface Outcome<out V> {
        class Ok<V>(val value: V) : Outcome<V>
        object Missing : Outcome<Nothing>
        class Fatal(val auth: Boolean) : Outcome<Nothing>
        class Retry(val afterMs: Long) : Outcome<Nothing>
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val gate = Semaphore(tuning.parallel)
    private val backgroundGate = if (tuning.backgroundParallel > 0) Semaphore(tuning.backgroundParallel) else gate
    private val inflight = ConcurrentHashMap<String, Deferred<T?>>()
    private val breakers = ConcurrentHashMap<String, Breaker>()
    private val cache = LinkedHashMap<String, Entry<T>>(64, 0.75f, true)
    private var cachedWeight = 0L

    private fun lookup(key: String): Entry<T>? = synchronized(cache) { cache[key] }

    private fun keep(key: String, value: T?, missTtlMs: Long = tuning.missTtlMs) = synchronized(cache) {
        cache.put(key, Entry(value, System.currentTimeMillis(), missTtlMs))?.value?.let { cachedWeight -= weigh(it) }
        value?.let { cachedWeight += weigh(it) }
        val it = cache.entries.iterator()
        while ((cachedWeight > tuning.maxWeight || cache.size > tuning.maxEntries) && it.hasNext()) {
            val eldest = it.next()
            eldest.value.value?.let { v -> cachedWeight -= weigh(v) }
            it.remove()
        }
    }

    suspend fun get(
        key: String,
        ttlMs: Long,
        lane: String = "",
        attempts: Int = tuning.attempts,
        accept: (T) -> Boolean = { true },
        background: Boolean = false,
        request: suspend () -> RawResponse,
    ): T? {
        val cached = lookup(key)
        if (cached != null) {
            val age = System.currentTimeMillis() - cached.at
            if (cached.value == null) {
                if (age < cached.missTtlMs) return null
            } else if (age < ttlMs) {
                return cached.value
            } else if (age < tuning.staleMs) {
                scope.launch { flight(key, lane, attempts, accept, background, request) }
                return cached.value
            }
        }
        flight(key, lane, attempts, accept, background, request)?.let { return it }
        return cached?.value?.takeIf { System.currentTimeMillis() - cached.at < tuning.staleMs }
    }

    private suspend fun flight(
        key: String,
        lane: String,
        attempts: Int,
        accept: (T) -> Boolean,
        background: Boolean,
        request: suspend () -> RawResponse,
    ): T? {
        val job = inflight.computeIfAbsent(key) { k ->
            scope.async(start = CoroutineStart.LAZY) {
                try {
                    run(k, lane, attempts, accept, background, request)
                } finally {
                    inflight.remove(k)
                }
            }
        }
        return job.await()
    }

    private suspend fun run(
        key: String,
        lane: String,
        attempts: Int,
        accept: (T) -> Boolean,
        background: Boolean,
        request: suspend () -> RawResponse,
    ): T? {
        val breaker = breakers.getOrPut(lane) { Breaker() }
        if (System.currentTimeMillis() < breaker.openUntil.get()) return null
        var backoff = tuning.backoffMs
        for (attempt in 1..attempts) {
            when (val outcome = once(accept, background, request)) {
                is Outcome.Ok -> {
                    breaker.failures.set(0)
                    keep(key, outcome.value)
                    return outcome.value
                }
                Outcome.Missing -> {
                    breaker.failures.set(0)
                    keep(key, null, tuning.missTtlMs)
                    return null
                }
                is Outcome.Fatal -> {
                    trip(breaker)
                    keep(key, null, tuning.fatalTtlMs)
                    return null
                }
                is Outcome.Retry -> {
                    if (attempt == attempts) break
                    delay(maxOf(backoff, outcome.afterMs) + (0..120).random())
                    backoff *= 2
                }
            }
        }
        trip(breaker)
        return null
    }

    private fun trip(breaker: Breaker) {
        if (breaker.failures.incrementAndGet() >= tuning.breakerThreshold) {
            breaker.openUntil.set(System.currentTimeMillis() + tuning.breakerOpenMs)
            breaker.failures.set(tuning.breakerThreshold - 1)
        }
    }

    private suspend fun once(accept: (T) -> Boolean, background: Boolean, request: suspend () -> RawResponse): Outcome<T> {
        return try {
            val raw = (if (background) backgroundGate else gate).withPermit { withTimeoutOrNull(tuning.attemptTimeoutMs) { request() } } ?: return Outcome.Retry(0)
            when (raw.code) {
                in 200..299 -> {
                    val parsed = raw.text?.takeIf { it.isNotBlank() }?.let { runCatching { parse(it) }.getOrNull() }
                    if (parsed != null && accept(parsed)) Outcome.Ok(parsed) else Outcome.Retry(0)
                }
                404 -> Outcome.Missing
                429 -> Outcome.Retry(((raw.retryAfter?.toLongOrNull() ?: 1L) * 1000L).coerceIn(0L, tuning.maxRetryAfterMs))
                in 500..599 -> Outcome.Retry(0)
                401, 403 -> Outcome.Fatal(true)
                else -> Outcome.Fatal(false)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            Outcome.Retry(0)
        }
    }
}

internal fun jsonFetcher(tuning: FetchTuning): EclipsiaFetcher<JSONObject> =
    EclipsiaFetcher(tuning, parse = { JSONObject(it) })

internal fun textFetcher(tuning: FetchTuning): EclipsiaFetcher<String> =
    EclipsiaFetcher(tuning, parse = { it }, weigh = { it.length.toLong() })
