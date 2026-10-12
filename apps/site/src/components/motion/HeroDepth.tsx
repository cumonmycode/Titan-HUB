'use client'
/**
 * Первый экран в духе страниц Apple Keynote: крупный заголовок по центру, под ним
 * фото во всю ширину. Фото «приближается» при прокрутке (0.88 → 1), текст уходит
 * вверх и гаснет. При reduced motion — без движения.
 */
import { useRef, type ReactNode } from 'react'
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'

export function HeroDepth({ copy, media, className }: { copy: ReactNode; media: ReactNode; className: string }) {
  const ref = useRef<HTMLElement>(null)
  const mediaRef = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const { scrollYProgress: leave } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const copyY = useTransform(leave, [0, 1], reduce ? [0, 0] : [0, -80])
  const copyO = useTransform(leave, [0, 0.55], reduce ? [1, 1] : [1, 0])
  const { scrollYProgress: enter } = useScroll({ target: mediaRef, offset: ['start end', 'center center'] })
  const mediaS = useTransform(enter, [0, 1], reduce ? [1, 1] : [0.88, 1])
  return (
    <section ref={ref} className={className}>
      <motion.div className="k-hero-copy" style={{ y: copyY, opacity: copyO }}>{copy}</motion.div>
      <motion.div ref={mediaRef} className="k-hero-media" style={{ scale: mediaS }}>{media}</motion.div>
    </section>
  )
}
