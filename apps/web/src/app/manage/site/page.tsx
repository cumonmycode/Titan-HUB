'use client'
/**
 * «Сайт» — titanmafia.ru из HUB: тема оформления, расписание вечеров и публикации
 * (турниры, вечеринки с фото и папкой Google Drive). Заявки с сайта приходят в
 * «Мероприятия → Заявки с сайта» и уведомлением.
 */
import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Icon } from '@/components/Icon'
import { PageHeader } from '@/components/manage/DesignSystem'
import { SiteLook } from '@/components/manage/site/SiteLook'
import { SiteStories } from '@/components/manage/site/SiteStories'
import { SITE_URL } from '@/lib/site'

type Tab = 'look' | 'stories'
const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'look', label: 'Оформление', icon: 'palette' },
  { key: 'stories', label: 'Публикации', icon: 'photo_library' },
]

export default function SitePage() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('look')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    if (t === 'look' || t === 'stories') setTab(t)
  }, [])
  function changeTab(t: Tab) {
    setTab(t)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', t)
    window.history.replaceState(null, '', url.toString())
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <PageHeader title="Сайт" subtitle="titanmafia.ru — тема, расписание, публикации" onBack={() => router.push('/manage')}
        action={tab === 'stories' ? { label: 'Добавить', icon: 'add', onClick: () => setCreating(true) } : undefined} />
      <div style={{ padding: '16px 16px var(--bottom-nav-clear, 24px)', maxWidth: 'var(--content-narrow)', margin: '0 auto', width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 14, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
          {TABS.map((t) => {
            const active = tab === t.key
            return (
              <button key={t.key} onClick={() => changeTab(t.key)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 8px', borderRadius: 11, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, transition: 'all 0.15s', background: active ? 'var(--primary-violet)' : 'transparent', color: active ? '#fff' : 'var(--on-surface-variant)' }}>
                <Icon name={t.icon} size={17} color={active ? '#fff' : 'var(--on-surface-variant)'} />
                {t.label}
              </button>
            )
          })}
        </div>
        {tab === 'look' ? <SiteLook /> : <SiteStories creating={creating} onCreatingChange={setCreating} />}
        <a href={SITE_URL} target="_blank" rel="noopener noreferrer" style={{ alignSelf: 'center', fontSize: 13, color: 'var(--on-surface-variant)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="open_in_new" size={15} /> Открыть сайт
        </a>
      </div>
    </div>
  )
}
