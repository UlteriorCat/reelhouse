package com.eclipsia.core.net

import java.net.InetAddress

object AddressPolicy {
    @Volatile
    var allowPrivateNetworks: Boolean = false

    private class Cidr(text: String) {
        private val base: ByteArray
        private val bits: Int

        init {
            val slash = text.indexOf('/')
            base = InetAddress.getByName(text.substring(0, slash)).address
            bits = text.substring(slash + 1).toInt()
        }

        fun contains(address: ByteArray): Boolean {
            if (address.size != base.size) return false
            var remaining = bits
            var i = 0
            while (remaining > 0) {
                val mask = if (remaining >= 8) 0xFF else (0xFF shl (8 - remaining)) and 0xFF
                if ((address[i].toInt() and mask) != (base[i].toInt() and mask)) return false
                remaining -= 8
                i++
            }
            return true
        }
    }

    private val V4 = listOf(
        "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16",
        "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "192.168.0.0/16",
        "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4",
    ).map(::Cidr)

    private val V6 = listOf(
        "::/96", "100::/64", "64:ff9b:1::/48", "2001::/32", "2001:db8::/32", "fc00::/7",
        "fe80::/10", "fec0::/10", "ff00::/8",
    ).map(::Cidr)

    private val PRIVATE_V4 = listOf("10.0.0.0/8", "100.64.0.0/10", "172.16.0.0/12", "192.168.0.0/16").map(::Cidr)

    private val UNIQUE_LOCAL_V6 = Cidr("fc00::/7")

    private val NAT64 = Cidr("64:ff9b::/96")
    private val SIX_TO_FOUR = Cidr("2002::/16")

    private fun blockedV4(bytes: ByteArray): Boolean {
        if (allowPrivateNetworks && PRIVATE_V4.any { it.contains(bytes) }) return false
        return V4.any { it.contains(bytes) }
    }

    private fun isMapped(b: ByteArray): Boolean {
        for (i in 0 until 10) if (b[i].toInt() != 0) return false
        return (b[10].toInt() and 0xFF) == 0xFF && (b[11].toInt() and 0xFF) == 0xFF
    }

    fun isBlocked(address: InetAddress): Boolean {
        val b = address.address
        return when (b.size) {
            4 -> blockedV4(b)
            16 -> when {
                isMapped(b) -> blockedV4(b.copyOfRange(12, 16))
                NAT64.contains(b) -> blockedV4(b.copyOfRange(12, 16))
                SIX_TO_FOUR.contains(b) -> blockedV4(b.copyOfRange(2, 6))
                allowPrivateNetworks && UNIQUE_LOCAL_V6.contains(b) -> false
                else -> V6.any { it.contains(b) }
            }
            else -> true
        }
    }

    private val DOTTED = Regex("""^[0-9.]+$""")

    fun literalAllowed(host: String): Boolean {
        val h = host.trim('[', ']')
        if (h.isEmpty()) return false
        if (h.contains(':') || DOTTED.matches(h)) {
            return try {
                !isBlocked(InetAddress.getByName(h))
            } catch (_: Exception) {
                false
            }
        }
        return true
    }
}
