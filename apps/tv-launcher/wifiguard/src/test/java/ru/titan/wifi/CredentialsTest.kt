package ru.titan.wifi

import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class CredentialsTest {

    @Test
    fun `a normal home network is accepted`() {
        assertNull(credentialsProblem("HomeNet", "correct-horse"))
    }

    @Test
    fun `an empty network name is rejected`() {
        assertNotNull(credentialsProblem("", "correct-horse"))
    }

    @Test
    fun `a network name over 32 bytes is rejected`() {
        // 17 Cyrillic letters are 34 bytes in UTF-8
        assertNotNull(credentialsProblem("Ж".repeat(17), "correct-horse"))
    }

    @Test
    fun `passphrases must be 8 to 63 characters`() {
        assertNotNull(credentialsProblem("HomeNet", "1234567"))
        assertNotNull(credentialsProblem("HomeNet", "a".repeat(64)))
        assertNull(credentialsProblem("HomeNet", "12345678"))
    }

    @Test
    fun `passphrases must be plain ASCII`() {
        assertNotNull(credentialsProblem("HomeNet", "пароль-пароль"))
    }
}
