/**
 * Вики для разработчиков (titanpos.ru/wiki): как встроить данные клиентов Titan в свой
 * проект через Titan Connect. Публичная, без входа и без меню кассы (lib/publicRoutes).
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { WikiNav } from './_components/WikiNav'
import s from './wiki.module.css'

export const metadata: Metadata = {
  title: { default: 'Titan Connect — вики для разработчиков', template: '%s · Titan Connect' },
  description: 'Как подключить свой сервис к Titan HUB: одноразовый код, ключ доступа, клиенты клуба, синхронизация, ошибки и примеры кода.',
}

export default function WikiLayout({ children }: { children: ReactNode }) {
  return (
    <div className={s.page}>
      <header className={s.header}>
        <Link href="/wiki" className={s.brand}>
          <span className={s.brandTag}>Titan</span>
          <span className={s.brandName}>Connect для разработчиков</span>
        </Link>
        <span className={s.version}>API v1</span>
      </header>
      <div className={s.body}>
        <WikiNav />
        <main className={s.content}>{children}</main>
      </div>
    </div>
  )
}
