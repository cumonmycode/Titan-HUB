'use client'
/**
 * Заявка с любой страницы: кнопки зовут open(preset), форма выезжает шторкой
 * (справа на компьютере, снизу на телефоне). Данные клуба (расписание, тарифы,
 * зоны) приходят с сервера один раз и живут в контексте.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { X } from 'lucide-react'
import type { RequestPreset, SiteConfig } from '@/lib/types'
import { RequestForm } from './RequestForm'

interface RequestApi { open: (preset: RequestPreset) => void; config: SiteConfig }
const RequestContext = createContext<RequestApi | null>(null)

export function useRequest(): RequestApi {
  const ctx = useContext(RequestContext)
  if (!ctx) throw new Error('useRequest вне RequestProvider')
  return ctx
}

const EASE_OUT = [0.16, 1, 0.3, 1] as const
const NARROW_QUERY = '(max-width: 720px)'

export function RequestProvider({ config, children }: { config: SiteConfig; children: ReactNode }) {
  const [preset, setPreset] = useState<RequestPreset | null>(null)
  const open = useCallback((p: RequestPreset) => setPreset(p), [])
  const close = useCallback(() => setPreset(null), [])
  const value = useMemo(() => ({ open, config }), [open, config])
  return (
    <RequestContext.Provider value={value}>
      {children}
      <AnimatePresence>{preset && <Sheet key="sheet" onClose={close}><RequestForm config={config} preset={preset} variant="sheet" onClose={close} /></Sheet>}</AnimatePresence>
    </RequestContext.Provider>
  )
}

function Sheet({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  // Шторка рендерится только после клика, поэтому window уже есть: направление
  // выезда известно с первого кадра (иначе анимация начиналась вбок и застревала).
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches)

  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY)
    const sync = () => setNarrow(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const restoreFocus = document.activeElement as HTMLElement | null
    requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('input, button, textarea, select')?.focus())
    return () => {
      mq.removeEventListener('change', sync)
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
      restoreFocus?.focus?.()
    }
  }, [onClose])

  const hidden = reduce ? { opacity: 0 } : narrow ? { x: 0, y: '100%' } : { x: '100%', y: 0 }
  const shown = reduce ? { opacity: 1 } : { x: 0, y: 0 }
  return (
    <div className="sheet-root">
      <motion.div className="sheet-backdrop" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} />
      <motion.div
        ref={panel}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Заявка"
        initial={hidden}
        animate={shown}
        exit={hidden}
        transition={{ duration: 0.45, ease: EASE_OUT }}
      >
        <button type="button" className="sheet-close" onClick={onClose} aria-label="Закрыть"><X size={22} strokeWidth={2} /></button>
        {children}
      </motion.div>
    </div>
  )
}
