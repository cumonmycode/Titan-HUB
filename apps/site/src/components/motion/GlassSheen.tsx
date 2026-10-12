'use client'
/**
 * Отклик на курсор, один обработчик на документ и один кадр rAF:
 *  • .glass — блик: --mx/--my (позиция курсора в процентах элемента);
 *  • [data-tilt] — 3D-наклон: --rx/--ry в градусах, сброс при уходе курсора;
 *  • [data-magnetic] — кнопка тянется к курсору: --tx/--ty в пикселях;
 *  • .site — пятно света подложки: --sx/--sy в процентах окна.
 * Только для мыши/трекпада и без reduced motion.
 */
import { useEffect } from 'react'

const TILT_DEG = 7
const MAGNET_PX = 10

export function GlassSheen() {
  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const site = document.querySelector<HTMLElement>('.site')
    let frame = 0
    let last: PointerEvent | null = null
    let tilted: HTMLElement | null = null
    let magnet: HTMLElement | null = null

    const reset = (el: HTMLElement | null, ...props: string[]) => { if (el) for (const p of props) el.style.removeProperty(p) }
    const apply = () => {
      frame = 0
      const e = last
      if (!e) return
      const target = e.target as Element | null
      site?.style.setProperty('--sx', `${((e.clientX / window.innerWidth) * 100).toFixed(1)}%`)
      site?.style.setProperty('--sy', `${((e.clientY / window.innerHeight) * 100).toFixed(1)}%`)

      const glass = target?.closest?.('.glass') as HTMLElement | null
      if (glass) {
        const r = glass.getBoundingClientRect()
        glass.style.setProperty('--mx', `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`)
        glass.style.setProperty('--my', `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`)
      }
      if (reduce) return

      const tilt = target?.closest?.('[data-tilt]') as HTMLElement | null
      if (tilted && tilted !== tilt) reset(tilted, '--rx', '--ry')
      tilted = tilt
      if (tilt) {
        const r = tilt.getBoundingClientRect()
        const x = (e.clientX - r.left) / r.width - 0.5
        const y = (e.clientY - r.top) / r.height - 0.5
        tilt.style.setProperty('--rx', `${(-y * TILT_DEG).toFixed(2)}deg`)
        tilt.style.setProperty('--ry', `${(x * TILT_DEG).toFixed(2)}deg`)
      }

      const mag = target?.closest?.('[data-magnetic], .btn-primary') as HTMLElement | null
      if (magnet && magnet !== mag) reset(magnet, '--tx', '--ty')
      magnet = mag
      if (mag) {
        const r = mag.getBoundingClientRect()
        mag.style.setProperty('--tx', `${(((e.clientX - r.left) / r.width - 0.5) * MAGNET_PX).toFixed(1)}px`)
        mag.style.setProperty('--ty', `${(((e.clientY - r.top) / r.height - 0.5) * MAGNET_PX).toFixed(1)}px`)
      }
    }
    const onMove = (e: PointerEvent) => { last = e; if (!frame) frame = requestAnimationFrame(apply) }
    const onLeave = () => { reset(tilted, '--rx', '--ry'); reset(magnet, '--tx', '--ty'); tilted = null; magnet = null }
    document.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerleave', onLeave)
    return () => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerleave', onLeave); cancelAnimationFrame(frame) }
  }, [])
  return null
}
