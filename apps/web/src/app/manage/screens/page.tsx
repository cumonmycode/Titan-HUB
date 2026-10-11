'use client'
/**
 * «Экраны» — телевизоры клуба с приложением Titan Menu. Каждый экран настраивается
 * отдельно: как висит ТВ, показ (меню и картинки по кругу), тема и реклама меню;
 * приставка просто показывает то, что задано здесь. Подключение ТВ — с телефона: Titan HUB находит
 * приставку в локальной сети (Управление → Экраны → «Подключить ТВ»).
 */
import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Icon } from '@/components/Icon'
import { StateView } from '@/components/StateView'
import { useToast } from '@/components/Toast'
import { useAuthStore } from '@/store/auth.store'
import { PageHeader, Sheet, Button, INP, LBL } from '@/components/manage/DesignSystem'
import { ROTATIONS, SCREENS_KEY, deviceStatus, showLabel, type Screen } from '@/lib/screens'
import { TabletsSection } from '@/components/manage/screens/TabletsSection'

function ScreenCard({ s }: { s: Screen }) {
  const status = deviceStatus(s)
  const rotation = ROTATIONS.find((r) => r.key === s.rotation)
  return (
    <Link href={`/manage/screens/${s.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="glass-l2" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 18, border: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ width: 44, height: 44, borderRadius: 13, flexShrink: 0, background: 'rgba(139,92,246,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={s.show.menu ? 'tv' : 'slideshow'} size={21} color="#a78bfa" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</p>
          <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: '2px 0 0' }}>{showLabel(s.show)} · {rotation?.short}</p>
          <p style={{ fontSize: 12, margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: 6, color: status.color }}>
            <span style={{ width: 7, height: 7, borderRadius: 4, background: status.color, flexShrink: 0 }} />
            {status.label}
          </p>
        </div>
        <Icon name="chevron_right" size={18} color="var(--on-surface-variant)" />
      </div>
    </Link>
  )
}

export default function ScreensPage() {
  const router = useRouter()
  const qc = useQueryClient()
  const { show } = useToast()
  const isOwner = (useAuthStore((s) => s.user)?.role ?? 'staff') === 'owner'
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: SCREENS_KEY,
    queryFn: () => api.get<{ screens: Screen[] }>('/screens'),
    refetchInterval: 20_000, // статус «в сети» приставок
  })
  const screens = data?.screens ?? []

  const create = useMutation({
    mutationFn: () => api.post<{ screen: Screen }>('/screens', { name: name.trim() }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: SCREENS_KEY })
      setAdding(false)
      setName('')
      router.push(`/manage/screens/${r.screen.id}`)
    },
    onError: (e: Error) => show(e.message || 'Экран не создан', 'error'),
  })

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <PageHeader
        title="Экраны"
        subtitle="Телевизоры с приложением Titan Menu"
        onBack={() => router.push('/manage')}
        action={isOwner ? { label: 'Добавить', icon: 'add', onClick: () => setAdding(true) } : undefined}
      />
      <div style={{ padding: '16px 16px var(--bottom-nav-clear, 24px)', maxWidth: 'var(--content-narrow)', margin: '0 auto', width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {isLoading ? (
          <StateView state="loading" />
        ) : isError ? (
          <StateView state="error" title="Экраны не загрузились" action={{ label: 'Повторить', onClick: () => void refetch() }} />
        ) : screens.length === 0 ? (
          <StateView state="empty" icon="tv" title="Экранов пока нет" description="Добавьте экран, соберите показ из меню и картинок и подключите к нему телевизор с телефона." />
        ) : (
          screens.map((s) => <ScreenCard key={s.id} s={s} />)
        )}

        <TabletsSection />

        <section className="glass-l2" style={{ borderRadius: 18, padding: 16, border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="tv" size={16} color="#a78bfa" />
            <span style={{ ...LBL, marginBottom: 0, color: '#a78bfa' }}>Как подключить телевизор</span>
          </div>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.55, color: 'var(--on-surface-variant)' }}>
            <li>Установите на ТВ-приставку приложение Titan Menu и откройте его — на экране появится код.</li>
            <li>На телефоне в той же Wi-Fi сети откройте Titan HUB → Управление → Экраны → «Подключить ТВ».</li>
            <li>Выберите приставку с тем же кодом и экран, который она будет показывать.</li>
          </ol>
          <p style={{ fontSize: 12, margin: 0, color: 'var(--on-surface-variant)' }}>
            Дальше всё настраивается здесь: как висит ТВ, показ из меню и картинок, тема и реклама. Приставка подхватывает изменения в течение 20 секунд.
          </p>
        </section>
      </div>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Новый экран" desktopSize="md">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 8 }}>
          <div>
            <label style={LBL}>Название</label>
            <input style={INP} value={name} maxLength={60} placeholder="Например: ТВ у бара" autoFocus onChange={(e) => setName(e.target.value)} />
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--on-surface-variant)', margin: 0, lineHeight: 1.5 }}>
            Новый экран сразу показывает меню. Картинки, их порядок, время и анимации добавите в его настройках.
          </p>
          <Button fullWidth loading={create.isPending} disabled={!name.trim()} onClick={() => create.mutate()}>Создать экран</Button>
        </div>
      </Sheet>
    </div>
  )
}
