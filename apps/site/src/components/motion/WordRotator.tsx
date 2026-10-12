'use client'
/** Слово в заголовке сменяется по кругу с размытием — без анимации при reduced motion. */
import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

const INTERVAL_MS = 2400

export function WordRotator({ words }: { words: string[] }) {
  const reduce = useReducedMotion()
  const [i, setI] = useState(0)
  useEffect(() => {
    if (reduce || words.length < 2) return
    const id = setInterval(() => setI((n) => (n + 1) % words.length), INTERVAL_MS)
    return () => clearInterval(id)
  }, [reduce, words.length])
  return (
    <span className="g-rotator" aria-live="off">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={words[i]}
          className="g-rotator-word"
          initial={{ opacity: 0, y: '0.45em', filter: 'blur(10px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: '-0.45em', filter: 'blur(10px)' }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        >
          {words[i]}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
