'use client'
/** Шапка: логотип, разделы, телефон, «Записаться». На телефоне — меню на весь экран. */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Menu, Phone, X } from 'lucide-react'
import { NAV, SITE } from '@/content/site'
import { RequestButton } from '@/components/request/RequestButton'

export function Header({ ctaLabel }: { ctaLabel: string }) {
  const path = usePathname()
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [path])
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [open])

  const isActive = (href: string) => path === href || path.startsWith(`${href}/`)
  return (
    <header className="hdr">
      <a className="skip" href="#main">К содержанию</a>
      <Link href="/" className="hdr-brand" aria-label="TITAN KBR — на главную">
        <img src="/media/logo.webp" alt="" width={34} height={34} />
        <span>{SITE.name}</span>
      </Link>
      <nav className="hdr-nav" aria-label="Разделы">
        {NAV.map((n) => <Link key={n.href} href={n.href} aria-current={isActive(n.href) ? 'page' : undefined}>{n.label}</Link>)}
      </nav>
      <a className="hdr-phone" href={SITE.phoneHref}><Phone size={16} aria-hidden="true" />{SITE.phone}</a>
      <RequestButton preset={{ kind: 'game' }} className="btn btn-primary hdr-cta">{ctaLabel}</RequestButton>
      <button type="button" className="hdr-burger" aria-label={open ? 'Закрыть меню' : 'Открыть меню'} aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? <X size={24} /> : <Menu size={24} />}
      </button>
      {open && (
        <div className="mnav">
          <nav aria-label="Меню">
            <Link href="/">Главная</Link>
            {NAV.map((n) => <Link key={n.href} href={n.href} aria-current={isActive(n.href) ? 'page' : undefined}>{n.label}</Link>)}
          </nav>
          <div className="mnav-foot">
            <a href={SITE.phoneHref} className="btn btn-ghost"><Phone size={18} aria-hidden="true" />{SITE.phone}</a>
            <RequestButton preset={{ kind: 'game' }} className="btn btn-primary">{ctaLabel}</RequestButton>
          </div>
        </div>
      )}
    </header>
  )
}
