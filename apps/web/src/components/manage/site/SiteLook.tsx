'use client'
/**
 * «Сайт → Оформление»: какая из четырёх тем включена на titanmafia.ru и расписание
 * игровых вечеров. Сайт подхватывает изменения в течение минуты.
 */
import React, { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Icon } from '@/components/Icon'
import { StateView } from '@/components/StateView'
import { useToast } from '@/components/Toast'
import { Button, INP, LBL, SEL } from '@/components/manage/DesignSystem'
import { DAYS, DEFAULT_SCHEDULE, EVENING_TITLES, SITE_MIRROR, SITE_THEMES, type ScheduleDay, type SiteConfig, type SiteTheme } from '@/lib/site'

const CARD: React.CSSProperties = { borderRadius: 18, padding: 16, border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 12 }

export function SiteLook() {
  const qc = useQueryClient()
  const { show } = useToast()
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['site-config'], queryFn: () => api.get<SiteConfig>('/system/site-config') })
  const [schedule, setSchedule] = useState<ScheduleDay[]>([])
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (data) { setSchedule(data.schedule ?? DEFAULT_SCHEDULE); setDirty(false) }
  }, [data])

  const saveTheme = useMutation({
    mutationFn: (theme: SiteTheme) => api.put('/system/site-config', { theme }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['site-config'] }); show('Тема включена — сайт обновится в течение минуты', 'success') },
    onError: (e: Error) => show(e.message || 'Не удалось сменить тему', 'error'),
  })
  const saveSchedule = useMutation({
    mutationFn: () => api.put('/system/site-config', { schedule }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['site-config'] }); setDirty(false); show('Расписание сохранено', 'success') },
    onError: (e: Error) => show(e.message || 'Не удалось сохранить расписание', 'error'),
  })

  if (isLoading) return <StateView state="loading" />
  if (isError || !data) return <StateView state="error" title="Настройки сайта не загрузились" action={{ label: 'Повторить', onClick: () => void refetch() }} />

  const edit = (i: number, patch: Partial<ScheduleDay>) => { setSchedule((s) => s.map((d, j) => (j === i ? { ...d, ...patch } : d))); setDirty(true) }
  const remove = (i: number) => { setSchedule((s) => s.filter((_, j) => j !== i)); setDirty(true) }
  const add = () => { setSchedule((s) => [...s, { day: 1, title: 'Городская мафия', time: '19:00' }]); setDirty(true) }

  return (
    <>
      <section className="glass-l2" style={CARD}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="palette" size={18} color="#a78bfa" />
          <p style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>Тема сайта</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>
          {SITE_THEMES.map((t) => {
            const active = data.theme === t.id
            return (
              <div key={t.id} style={{ borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, border: active ? '1.5px solid var(--primary-violet)' : '1px solid rgba(255,255,255,0.1)', background: active ? 'rgba(139,92,246,0.10)' : 'rgba(255,255,255,0.03)' }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  {t.colors.map((c) => <span key={c} style={{ width: 22, height: 22, borderRadius: 6, background: c, border: '1px solid rgba(255,255,255,0.15)' }} />)}
                  {active && <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.05em' }}>На сайте</span>}
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>{t.label}</p>
                  <p style={{ margin: '4px 0 0', fontSize: 12.5, lineHeight: 1.45, color: 'var(--on-surface-variant)' }}>{t.text}</p>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                  <a href={`${SITE_MIRROR}/preview/${t.id}`} target="_blank" rel="noopener noreferrer" style={{ flex: 1, textDecoration: 'none' }}>
                    <Button size="sm" variant="secondary" fullWidth>Посмотреть</Button>
                  </a>
                  <div style={{ flex: 1 }}>
                    <Button size="sm" fullWidth disabled={active} loading={saveTheme.isPending && saveTheme.variables === t.id} onClick={() => saveTheme.mutate(t.id)}>{active ? 'Включена' : 'Включить'}</Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="glass-l2" style={CARD}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="calendar_month" size={18} color="#a78bfa" />
          <p style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>Расписание вечеров</p>
        </div>
        <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--on-surface-variant)' }}>
          По нему сайт показывает ближайшие игры, а гости выбирают вечер в заявке. {data.schedule ? '' : 'Сейчас показано расписание по сменам клуба — сохраните, чтобы закрепить своё.'}
        </p>
        {schedule.map((d, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1.4fr) 92px 40px', gap: 8, alignItems: 'end' }}>
            <div>
              {i === 0 && <label style={LBL}>День</label>}
              <select style={SEL} value={d.day} onChange={(e) => edit(i, { day: Number(e.target.value) })}>
                {DAYS.map((name, k) => <option key={name} value={k + 1}>{name}</option>)}
              </select>
            </div>
            <div>
              {i === 0 && <label style={LBL}>Вечер</label>}
              <input style={INP} list="site-evening-titles" value={d.title} maxLength={60} onChange={(e) => edit(i, { title: e.target.value })} />
            </div>
            <div>
              {i === 0 && <label style={LBL}>Начало</label>}
              <input style={INP} type="time" value={d.time ?? '19:00'} onChange={(e) => edit(i, { time: e.target.value })} />
            </div>
            <button type="button" aria-label="Убрать вечер" onClick={() => remove(i)} style={{ height: 44, borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'var(--on-surface-variant)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
        <datalist id="site-evening-titles">{EVENING_TITLES.map((t) => <option key={t} value={t} />)}</datalist>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button size="sm" variant="secondary" onClick={add}>Добавить вечер</Button>
          <Button size="sm" disabled={!dirty || schedule.some((d) => !d.title.trim())} loading={saveSchedule.isPending} onClick={() => saveSchedule.mutate()}>Сохранить расписание</Button>
        </div>
      </section>
    </>
  )
}
