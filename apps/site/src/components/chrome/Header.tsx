'use client'
/** Шапка: логотип, разделы, телефон, «Записаться». На телефоне — меню на весь экран. */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Menu, Phone, X } from 'lucide-react'
import { NAV, SITE } from '@/content/site'
import { useContacts } from './ContactsContext'
import { RequestButton } from '@/components/request/RequestButton'

export function Header({ ctaLabel }: { ctaLabel: string }) {
  const path = usePathname()
  const contacts = useContacts()
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => setOpen(false), [path])
  // Шапка компактнее и плотнее, когда страница прокручена.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [open])

  const isActive = (href: string) => path === href || path.startsWith(`${href}/`)
  const links = NAV.map((n) => <Link key={n.href} href={n.href} aria-current={isActive(n.href) ? 'page' : undefined}>{n.label}</Link>)

  // Меню — соседом шапки, а не внутри: у стеклянной шапки backdrop-filter, и
  // fixed-потомок позиционировался бы от неё, а не от экрана.
  return (
    <>
      <header className={`hdr glass${scrolled ? ' is-scrolled' : ''}${open ? ' is-open' : ''}`}>
        <a className="skip" href="#main">К содержанию</a>
        <Link href="/" className="hdr-brand" aria-label="TITAN KBR — на главную">
          <img src="/media/logo.webp" alt="" width={34} height={34} />
          <span>{SITE.name}</span>
        </Link>
        <nav className="hdr-nav" aria-label="Разделы">{links}</nav>
        <a className="hdr-phone" href={contacts.phoneHref}><Phone size={16} aria-hidden="true" />{contacts.phone}</a>
        <RequestButton preset={{ kind: 'game' }} className="btn btn-primary hdr-cta">{ctaLabel}</RequestButton>
        <button type="button" className="hdr-burger" aria-label={open ? 'Закрыть меню' : 'Открыть меню'} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <X size={24} /> : <Menu size={24} />}
        </button>
      </header>
      {open && (
        <div className="mnav glass">
          <nav aria-label="Меню">
            <Link href="/">Главная</Link>
            {links}
          </nav>
          <div className="mnav-foot">
            <a href={contacts.phoneHref} className="btn btn-ghost"><Phone size={18} aria-hidden="true" />{contacts.phone}</a>
            <RequestButton preset={{ kind: 'game' }} className="btn btn-primary">{ctaLabel}</RequestButton>
          </div>
        </div>
      )}
    </>
  )
}
