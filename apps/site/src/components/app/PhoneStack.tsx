'use client'
/** Три телефона с экранами My Titan: при прокрутке боковые расходятся веером. */
import { useRef } from 'react'
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { MY_TITAN } from '@/content/app'

export function PhoneStack() {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const spread = useTransform(scrollYProgress, [0, 0.5], reduce ? [1, 1] : [0.35, 1])
  const leftX = useTransform(spread, (v) => `${-58 * v}%`)
  const rightX = useTransform(spread, (v) => `${58 * v}%`)
  const leftR = useTransform(spread, (v) => -9 * v)
  const rightR = useTransform(spread, (v) => 9 * v)
  const lift = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [40, -40])
  const [front, left, right] = MY_TITAN.screens
  return (
    <div className="phones" ref={ref} aria-label="Экраны приложения My Titan">
      <motion.div className="phone phone-side" style={{ x: leftX, rotate: leftR }}><img src={left.src} alt={left.alt} loading="lazy" /></motion.div>
      <motion.div className="phone phone-side" style={{ x: rightX, rotate: rightR }}><img src={right.src} alt={right.alt} loading="lazy" /></motion.div>
      <motion.div className="phone phone-front" style={{ y: lift }}><img src={front.src} alt={front.alt} loading="lazy" /></motion.div>
    </div>
  )
}
