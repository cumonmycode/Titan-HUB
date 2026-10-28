package ru.titan.tv.ui.motion

import kotlin.math.PI

/** Compose spring parameters for unit mass. */
data class SpringParams(val dampingRatio: Float, val stiffness: Float)

/**
 * Converts Apple's designer-facing spring (damping ratio + response in seconds)
 * into Compose terms: stiffness = (2π / response)² for a unit mass.
 */
fun appleSpring(damping: Float, response: Float): SpringParams {
    val omega = (2 * PI / response).toFloat()
    return SpringParams(dampingRatio = damping, stiffness = omega * omega)
}

// TITAN moves quickly and never bounces: every spring is critically damped and settles in about 0.2–0.3 s

/** Focus pop on tiles. */
val FOCUS_SPRING = appleSpring(damping = 1f, response = 0.26f)

/** Sheets and large surfaces. */
val PANEL_SPRING = appleSpring(damping = 1f, response = 0.32f)

/** Background moves. */
val SOFT_SPRING = appleSpring(damping = 1f, response = 0.45f)
