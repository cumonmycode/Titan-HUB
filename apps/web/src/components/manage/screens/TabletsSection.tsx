'use client'
/**
 * Планшеты Titan Home в кабинках: жив ли планшет, какая версия приложения и есть
 * ли у него связь со «Светом и климатом» (Home Assistant) и с кассой (поток
 * событий). Планшет присылает сигнал раз в 5 минут.
 */
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Icon } from '@/components/Icon'
import { LBL } from '@/components/manage/DesignSystem'

type Tablet = {
  spaceId: string
  name: string
  lastSeenAt: string | null
  app: string | null
  ha: 'idle' | 'connecting' | 'connected' | 'auth_failed' | 'offline' | null
  stream: boolean | null
  orientation: 'portrait' | 'landscape' | null
  model: string | null
}

/** Сигнал раз в 5 минут: дольше 7 минут тишины — планшет не в сети. */
const ONLINE_MS = 7 * 60_000

function ago(iso: string): string {
  const min = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  return min < 60 ? `${min} мин` : min < 48 * 60 ? `${Math.round(min / 60)} ч` : `${Math.round(min / 1440)} дн`
}

const HA_TEXT: Record<string, { label: string; color: string }> = {
  connected: { label: 'свет и климат на связи', color: '#22C55E' },
  connecting: { label: 'свет и климат подключается', color: '#F59E0B' },
  offline: { label: 'нет связи с Home Assistant', color: '#F87171' },
  auth_failed: { label: 'Home Assistant не принял токен', color: '#F87171' },
  idle: { label: 'свет и климат не настроены', color: 'var(--on-surface-variant)' },
}

function TabletRow({ t }: { t: Tablet }) {
  const online = !!t.lastSeenAt && Date.now() - new Date(t.lastSeenAt).getTime() < ONLINE_MS
  const status = online
    ? { label: 'В сети', color: '#22C55E' }
    : { label: t.lastSeenAt ? `Нет сигнала · был ${ago(t.lastSeenAt)} назад` : 'Ещё не выходил на связь', color: '#F59E0B' }
  const ha = t.ha ? HA_TEXT[t.ha] : null
  return (
    <div className="glass-l2" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 18, border: '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ width: 44, height: 44, borderRadius: 13, flexShrink: 0, background: 'rgba(139,92,246,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="tablet_mac" size={21} color="#a78bfa" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 15, fontWeight: 700, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</p>
        <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: '2px 0 0' }}>
          {t.app ? `Titan Home ${t.app}` : 'Titan Home'}{t.model ? ` · ${t.model}` : ''}
        </p>
        <p style={{ fontSize: 12, margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', color: status.color }}>
          <span style={{ width: 7, height: 7, borderRadius: 4, background: status.color, flexShrink: 0 }} />
          {status.label}
          {online && ha ? <span style={{ color: ha.color }}>· {ha.label}</span> : null}
          {online && t.stream === false ? <span style={{ color: '#F59E0B' }}>· события кассы с задержкой</span> : null}
        </p>
      </div>
    </div>
  )
}

export function TabletsSection() {
  const { data } = useQuery({
    queryKey: ['tablets'],
    queryFn: () => api.get<{ tablets: Tablet[] }>('/tablets'),
    refetchInterval: 60_000,
  })
  const tablets = data?.tablets ?? []
  if (!tablets.length) return null
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
      <span style={{ ...LBL, marginBottom: 0 }}>Планшеты Titan Home в кабинках</span>
      {tablets.map((t) => <TabletRow key={t.spaceId} t={t} />)}
    </section>
  )
}
