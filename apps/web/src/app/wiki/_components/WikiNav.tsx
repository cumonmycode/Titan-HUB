'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { WIKI_PAGES } from './nav'
import s from '../wiki.module.css'

/** Навигация по разделам: колонка слева на компьютере, лента сверху на телефоне. */
export function WikiNav() {
  const pathname = usePathname()
  return (
    <nav className={s.nav} aria-label="Разделы вики">
      <p className={s.navGroup}>Titan Connect API</p>
      {WIKI_PAGES.map((p) => {
        const active = pathname === p.href
        return (
          <Link key={p.href} href={p.href} className={`${s.navLink} ${active ? s.navActive : ''}`} aria-current={active ? 'page' : undefined}>
            {p.title}
          </Link>
        )
      })}
    </nav>
  )
}
