package ru.titan.tv.ui.motion

import androidx.compose.animation.core.SpringSpec
import androidx.compose.animation.core.spring

fun <T> SpringParams.spec(): SpringSpec<T> = spring(dampingRatio = dampingRatio, stiffness = stiffness)
