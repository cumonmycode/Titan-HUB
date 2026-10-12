'use client'
/**
 * Небо темы «Город засыпает»: фиксированный задник, который светлеет по мере
 * прокрутки — ночь → кобальт → рассвет. Прогресс пишется в --sky (0…1) на корне
 * .site; разделы с классом .is-day сами переключаются на дневную палитру.
 */
import { useEffect } from 'react'

export function NightSky() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.site')
    if (!root) return
    let frame = 0
    const update = () => {
      frame = 0
      const max = document.documentElement.scrollHeight - window.innerHeight
      root.style.setProperty('--sky', (max > 0 ? Math.min(1, window.scrollY / max) : 0).toFixed(3))
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); cancelAnimationFrame(frame) }
  }, [])
  return <div className="sky" aria-hidden="true"><div className="sky-horizon" /><div className="sky-dawn" /></div>
}
