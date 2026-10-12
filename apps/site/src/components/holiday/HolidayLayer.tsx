'use client'
/**
 * Праздничный слой поверх сайта: частицы на canvas, декорации и стеклянное
 * поздравление (закрывается, помнится в браузере). Каркас и стекло не меняются.
 */
import { useEffect, useRef, useState } from 'react'
import { Cake, Flower2, Ghost, Heart, Leaf, Snowflake, Star, Sun, TreePine, X, type LucideIcon } from 'lucide-react'
import { HOLIDAY_DEFS, type HolidayIcon, type HolidayId } from '@/content/holidays'
import { runParticles } from './particles'
import { Decorations } from './Decorations'

const ICONS: Record<HolidayIcon, LucideIcon> = { snowflake: Snowflake, tree: TreePine, heart: Heart, star: Star, flower: Flower2, sun: Sun, leaf: Leaf, ghost: Ghost, cake: Cake }
const DISMISS_KEY = 'titan-holiday-greeting'

export function HolidayLayer({ holiday }: { holiday: HolidayId }) {
  const def = HOLIDAY_DEFS[holiday]
  const canvas = useRef<HTMLCanvasElement>(null)
  const [greet, setGreet] = useState(false)

  useEffect(() => {
    const el = canvas.current
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    return runParticles(el, def.particles.kind, def.particles.colors, def.particles.density)
  }, [def])

  useEffect(() => {
    let dismissed = false
    try { dismissed = localStorage.getItem(DISMISS_KEY) === holiday } catch { /* приватный режим */ }
    if (dismissed) return
    const id = setTimeout(() => setGreet(true), 1800)
    return () => clearTimeout(id)
  }, [holiday])

  const close = () => {
    setGreet(false)
    try { localStorage.setItem(DISMISS_KEY, holiday) } catch { /* приватный режим */ }
  }
  const Icon = ICONS[def.icon]
  return (
    <>
      <canvas ref={canvas} className={`hd-canvas hd-${def.particles.kind}`} aria-hidden="true" />
      <div className="hd-decor" aria-hidden="true"><Decorations decor={def.decor} /></div>
      {greet && (
        <div className="hd-greet glass" role="status">
          <span className="hd-greet-icon"><Icon size={20} /></span>
          <p>{def.greeting}</p>
          <button type="button" onClick={close} aria-label="Закрыть поздравление"><X size={16} /></button>
        </div>
      )}
    </>
  )
}
