'use client'
/**
 * Появление блока при прокрутке: подъём, проявление и снятие размытия. Дети с
 * классом .reveal-item появляются лесенкой. Без анимации при reduced motion —
 * контент виден сразу.
 */
import type { ReactNode } from 'react'
import { motion, useReducedMotion, type Variants } from 'framer-motion'

const EASE = [0.16, 1, 0.3, 1] as const

const container: Variants = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
}
export const revealItem: Variants = {
  hidden: { opacity: 0, y: 28, filter: 'blur(10px)' },
  shown: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.9, ease: EASE } },
}

export function Reveal({ children, className, as = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'section' }) {
  const reduce = useReducedMotion()
  if (reduce) return as === 'section' ? <section className={className}>{children}</section> : <div className={className}>{children}</div>
  const Tag = as === 'section' ? motion.section : motion.div
  return (
    <Tag className={className} variants={container} initial="hidden" whileInView="shown" viewport={{ once: true, amount: 0.15 }}>
      {children}
    </Tag>
  )
}

/** Элемент лесенки внутри <Reveal>. */
export function RevealItem({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion()
  if (reduce) return <div className={className}>{children}</div>
  return <motion.div className={className} variants={revealItem}>{children}</motion.div>
}
