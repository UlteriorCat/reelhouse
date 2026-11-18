package com.eclipsia.core.js

import java.util.PriorityQueue
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

internal class EventLoop {
    private class Timer(val id: Int, val at: Long, val seq: Long)

    private val queue = LinkedBlockingQueue<Runnable>()
    private val timers = PriorityQueue<Timer>(compareBy<Timer>({ it.at }, { it.seq }))
    private var seq = 0L
    val inFlight = AtomicInteger(0)

    @Volatile
    private var closed = false

    fun post(task: Runnable) {
        if (!closed) queue.offer(task)
    }

    fun wake() = post(Runnable { })

    fun close() {
        closed = true
        queue.clear()
    }

    fun addTimer(id: Int, delayMs: Long) {
        timers.add(Timer(id, System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(delayMs.coerceAtLeast(0)), seq++))
    }

    fun cancelTimer(id: Int) {
        timers.removeAll { it.id == id }
    }

    fun dueTimers(): List<Int> {
        val now = System.nanoTime()
        val out = ArrayList<Int>()
        while (true) {
            val t = timers.peek() ?: break
            if (t.at > now) break
            timers.poll()
            out.add(t.id)
        }
        return out
    }

    fun nextTimerDelayNanos(): Long? = timers.peek()?.let { (it.at - System.nanoTime()).coerceAtLeast(0) }

    fun hasTimers() = timers.isNotEmpty()

    fun hasQueued() = queue.isNotEmpty()

    fun poll(maxWaitNanos: Long): Runnable? = queue.poll(maxWaitNanos, TimeUnit.NANOSECONDS)
}
