package com.eclipsiabdix

import com.eclipsia.core.net.AddressPolicy
import java.net.InetAddress
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AddressPolicyLanTest {
    private fun blocked(ip: String) = AddressPolicy.isBlocked(InetAddress.getByName(ip))

    @Test
    fun lanSwitchOnlyOpensPrivateRanges() {
        AddressPolicy.allowPrivateNetworks = true
        try {
            listOf("10.1.2.3", "172.16.50.12", "172.31.255.255", "192.168.1.1", "100.64.0.1", "fd12:3456::1")
                .forEach { assertFalse(it, blocked(it)) }
            listOf("127.0.0.1", "169.254.169.254", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "::ffff:127.0.0.1")
                .forEach { assertTrue(it, blocked(it)) }
            assertTrue(AddressPolicy.literalAllowed("172.16.50.14"))
        } finally {
            AddressPolicy.allowPrivateNetworks = false
        }
        assertTrue(blocked("172.16.50.12"))
    }
}
