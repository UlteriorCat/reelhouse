package com.eclipsia.core

import com.eclipsia.core.net.AddressPolicy
import java.net.InetAddress
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AddressPolicyTest {
    private fun blocked(ip: String) = AddressPolicy.isBlocked(InetAddress.getByName(ip))

    @Test
    fun blocksPrivateAndSpecialV4() {
        listOf(
            "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1",
            "172.31.255.255", "192.0.0.8", "192.168.1.1", "198.18.0.1", "224.0.0.1", "255.255.255.255",
        ).forEach { assertTrue(it, blocked(it)) }
    }

    @Test
    fun allowsPublicV4() {
        listOf("1.1.1.1", "8.8.8.8", "172.32.0.1", "100.128.0.1", "198.20.0.1", "93.184.216.34")
            .forEach { assertFalse(it, blocked(it)) }
    }

    @Test
    fun blocksSpecialV6() {
        listOf("::", "::1", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "2001:db8::1", "fec0::1", "2001::1")
            .forEach { assertTrue(it, blocked(it)) }
    }

    @Test
    fun allowsPublicV6() {
        listOf("2606:4700:4700::1111", "2a00:1450:4001::200e").forEach { assertFalse(it, blocked(it)) }
    }

    @Test
    fun mappedAndTranslatedAddressesFollowEmbeddedV4() {
        assertTrue(blocked("::ffff:127.0.0.1"))
        assertTrue(blocked("::ffff:10.0.0.1"))
        assertFalse(blocked("::ffff:8.8.8.8"))
        assertTrue(blocked("64:ff9b::7f00:1"))
        assertFalse(blocked("64:ff9b::808:808"))
        assertTrue(blocked("2002:7f00:1::1"))
        assertFalse(blocked("2002:808:808::1"))
    }

    @Test
    fun literalHostChecks() {
        assertFalse(AddressPolicy.literalAllowed("127.0.0.1"))
        assertFalse(AddressPolicy.literalAllowed("[::1]"))
        assertFalse(AddressPolicy.literalAllowed(""))
        assertTrue(AddressPolicy.literalAllowed("example.com"))
        assertTrue(AddressPolicy.literalAllowed("8.8.8.8"))
    }
}
