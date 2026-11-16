/**
 * Строительные блоки страниц вики: код, выноски, таблицы, эндпоинты, шаги, «Назад / Далее».
 * Серверные компоненты без состояния — страницы вики статические.
 */
import Link from 'next/link'
import type { ReactNode } from 'react'
import { neighbours, type WikiHref } from './nav'
import s from '../wiki.module.css'

export function Lead({ children }: { children: ReactNode }) {
  return <p className={s.lead}>{children}</p>
}

export function Code({ title, children }: { title?: string; children: string }) {
  return (
    <div className={s.codeBlock}>
      {title ? <div className={s.codeTitle}>{title}</div> : null}
      <pre>
        <code>{children.replace(/^\n/, '').replace(/\n\s*$/, '')}</code>
      </pre>
    </div>
  )
}

export function Callout({ children, warn }: { children: ReactNode; warn?: boolean }) {
  return (
    <div className={`${s.callout} ${warn ? s.calloutWarn : ''}`} role="note">
      <span className={s.calloutMark} aria-hidden>{warn ? '!' : 'i'}</span>
      <div>{children}</div>
    </div>
  )
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className={s.tableWrap}>
      <table>
        <thead>
          <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const METHOD_CLASS = { GET: s.get, POST: s.post, DELETE: s.delete } as const

export function Endpoint({ method, path, auth = true }: { method: keyof typeof METHOD_CLASS; path: string; auth?: boolean }) {
  return (
    <div className={s.endpoint}>
      <span className={`${s.method} ${METHOD_CLASS[method]}`}>{method}</span>
      <span>{path}</span>
      <span className={s.auth}>{auth ? 'Bearer tcn_…' : 'без ключа'}</span>
    </div>
  )
}

export function Steps({ items }: { items: { title: string; text: ReactNode }[] }) {
  return (
    <ol className={s.steps}>
      {items.map((item) => (
        <li key={item.title} className={s.step}>
          <strong>{item.title}</strong>
          {item.text}
        </li>
      ))}
    </ol>
  )
}

export function Cards({ items }: { items: readonly { href: string; title: string; blurb: string }[] }) {
  return (
    <div className={s.cards}>
      {items.map((c) => (
        <Link key={c.href} href={c.href} className={s.card}>
          <strong>{c.title}</strong>
          <span>{c.blurb}</span>
        </Link>
      ))}
    </div>
  )
}

export function Pager({ current }: { current: WikiHref }) {
  const { prev, next } = neighbours(current)
  return (
    <nav className={s.pager} aria-label="Соседние разделы">
      {prev ? <Link href={prev.href}>← {prev.title}</Link> : <span />}
      {next ? <Link href={next.href}>{next.title} →</Link> : <span />}
    </nav>
  )
}
