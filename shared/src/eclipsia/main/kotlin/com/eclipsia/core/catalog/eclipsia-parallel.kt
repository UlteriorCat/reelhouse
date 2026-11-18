package com.eclipsia.core.catalog

import com.lagradost.cloudstream3.HomePageResponse
import com.lagradost.cloudstream3.MainAPI
import com.lagradost.cloudstream3.MainPageData
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import java.util.concurrent.ConcurrentHashMap

@OptIn(ExperimentalCoroutinesApi::class)
internal object EclipsiaParallel {
    private const val TTL_MS = 3 * 60 * 1000L
    private const val STALE_MS = 30 * 60 * 1000L
    private const val MAX_SLOTS = 64

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private class Slot(val deferred: Deferred<HomePageResponse>, val at: Long)
    private class Good(val value: HomePageResponse, val at: Long)

    private val slots = ConcurrentHashMap<String, Slot>()
    private val lastGood = ConcurrentHashMap<String, Good>()

    private fun usable(slot: Slot?, now: Long): Boolean =
        slot != null && now - slot.at < TTL_MS && !slot.deferred.isCancelled &&
            !(slot.deferred.isCompleted && slot.deferred.getCompletionExceptionOrNull() != null)

    private fun sweep(now: Long) {
        if (slots.size <= MAX_SLOTS) return
        slots.entries.removeIf { now - it.value.at >= TTL_MS }
        lastGood.entries.removeIf { now - it.value.at >= STALE_MS }
    }

    suspend fun page(
        api: MainAPI,
        page: Int,
        name: String,
        data: String,
        rows: List<MainPageData>,
        variant: String = "",
        loader: suspend (Int, String, String) -> HomePageResponse,
    ): HomePageResponse {
        if (page > 1) return loader(page, name, data)

        val now = System.currentTimeMillis()
        sweep(now)
        fun key(rowData: String) = "${api.name}|$variant|$rowData"

        fun slotFor(rowName: String, rowData: String, after: Deferred<HomePageResponse>?): Slot {
            val k = key(rowData)
            return slots.compute(k) { _, old ->
                if (usable(old, now)) old
                else Slot(
                    scope.async {
                        if (after != null) runCatching { after.await() }
                        val response = loader(1, rowName, rowData)
                        lastGood[k] = Good(response, System.currentTimeMillis())
                        response
                    },
                    now,
                )
            }!!
        }

        val first = slotFor(name, data, null)
        for (row in rows) {
            if (row.data != data) slotFor(row.name, row.data, first.deferred)
        }

        val k = key(data)
        val mine = slots.getValue(k)
        return try {
            mine.deferred.await()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            slots.remove(k, mine)
            lastGood[k]?.takeIf { System.currentTimeMillis() - it.at < STALE_MS }?.let { return it.value }
            throw e
        }
    }
}
