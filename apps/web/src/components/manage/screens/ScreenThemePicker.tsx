'use client'
/**
 * Тема оформления экрана-меню (раздел «Экраны»). Сохраняется сразу; ТВ сам
 * переключится в течение 20 секунд. Миниатюры — public/tv-themes/<тема>.jpg,
 * предпросмотр — /screen/<id>?theme=<тема> (не меняя выбор).
 */
import React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Icon } from '@/components/Icon'
import { useToast } from '@/components/Toast'
import { LBL } from '@/components/manage/DesignSystem'
import { THEMES, screenKey, type Screen, type ScreenSlide } from '@/lib/screens'

type Detail = { screen: Screen; slides: ScreenSlide[] }

export function ScreenThemePicker({ screen, isOwner }: { screen: Screen; isOwner: boolean }) {
  const qc = useQueryClient()
  const { show } = useToast()
  const key = screenKey(screen.id)

  const choose = useMutation({
    mutationFn: (theme: string) => api.patch(`/screens/${screen.id}`, { theme }),
    onMutate: (theme) => {
      const prev = qc.getQueryData<Detail>(key)
      qc.setQueryData<Detail>(key, (old) => (old ? { ...old, screen: { ...old.screen, theme } } : old))
      return { prev }
    },
    onSuccess: (_d, theme) => show(`Тема «${THEMES.find((t) => t.key === theme)?.name ?? theme}» — ТВ переключится в течение 20 секунд`, 'success'),
    onError: (_e, _theme, ctx) => {
      qc.setQueryData(key, ctx?.prev)
      show('Не удалось сменить тему', 'error')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['screens'] }),
  })

  return (
    <div>
      <span style={LBL}>Тема</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))', gap: 12, marginTop: 10 }}>
        {THEMES.map((t) => {
          const active = screen.theme === t.key
          return (
            <div key={t.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => { if (isOwner && !active) choose.mutate(t.key) }}
                  disabled={!isOwner}
                  aria-pressed={active}
                  aria-label={`Тема «${t.name}»`}
                  style={{
                    position: 'relative', display: 'block', width: '100%', padding: 0, borderRadius: 14, overflow: 'hidden', cursor: isOwner ? 'pointer' : 'default',
                    border: active ? '2px solid #a78bfa' : '2px solid rgba(255,255,255,0.08)',
                    boxShadow: active ? '0 6px 22px rgba(139,92,246,0.35)' : 'none',
                    background: '#0f0b17', aspectRatio: '9 / 16', transition: 'border-color .15s, box-shadow .15s',
                  }}
                >
                  <img src={`/tv-themes/${t.key}.jpg`} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  {active && (
                    <span style={{ position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 12, background: '#8B5CF6', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }}>
                      <Icon name="check" size={15} color="#fff" />
                    </span>
                  )}
                </button>
                <a
                  href={`/screen/${screen.id}?theme=${t.key}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Предпросмотр «${t.name}»`}
                  title="Предпросмотр"
                  style={{ position: 'absolute', right: 8, bottom: 8, width: 28, height: 28, borderRadius: 9, background: 'rgba(15,11,23,0.78)', border: '1px solid rgba(255,255,255,0.18)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Icon name="open_in_new" size={14} />
                </a>
              </div>
              <div>
                <p style={{ fontSize: 12.5, fontWeight: 700, margin: 0, color: active ? '#c4b5fd' : 'var(--on-surface)', overflowWrap: 'anywhere' }}>{t.name}</p>
                <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '1px 0 0', lineHeight: 1.3 }}>{t.note}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
