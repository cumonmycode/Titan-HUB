package ru.titan.tv.ui.motion

import org.junit.Assert.assertEquals
import org.junit.Test

class SpringTest {

    @Test
    fun `apple response becomes compose stiffness`() {
        val spring = appleSpring(damping = 0.74f, response = 0.42f)

        assertEquals(0.74f, spring.dampingRatio, 0.0001f)
        assertEquals(223.8f, spring.stiffness, 0.1f)
    }

    @Test
    fun `faster response means a stiffer spring`() {
        val fast = appleSpring(damping = 1f, response = 0.3f)
        val slow = appleSpring(damping = 1f, response = 0.6f)

        assertEquals(4f, fast.stiffness / slow.stiffness, 0.001f)
    }
}
