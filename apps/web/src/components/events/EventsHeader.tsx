'use client'
/**
 * Шапка «Мероприятий» во всю ширину: заголовок у левого края и ОДНА кнопка
 * «Создать». В сплите «Управления» — общий PageHeader (назад / закрыть раздел);
 * на вкладке нижней навигации кнопки «назад» нет.
 */
import React from 'react'
import { Button, PageHeader } from '@/components/manage/DesignSystem'

const TITLE = 'Мероприятия'

export function EventsHeader({ inManageSplit, onCreate }: { inManageSplit: boolean; onCreate: () => void }) {
  if (inManageSplit) {
    return (
      <div style={{ flexShrink: 0, zIndex: 20 }}>
        <PageHeader title={TITLE} action={{ label: 'Создать', icon: 'add', onClick: onCreate }} />
      </div>
    )
  }
  return (
    <div style={{ flexShrink: 0, zIndex: 20, background: 'rgba(21,18,27,0.95)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
        <h1 style={{ flex: 1, minWidth: 0, margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{TITLE}</h1>
        <Button icon="add" onClick={onCreate}>Создать</Button>
      </div>
    </div>
  )
}
