'use client'
/**
 * «Сайт → Оформление» (праздничное оформление titanmafia.ru поверх Liquid Glass)
 * и «Сайт → Расписание» (игровые вечера по дням недели). Сайт подхватывает
 * изменения в течение минуты.
 */
import React, { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Icon } from '@/components/Icon'
import { StateView } from '@/components/StateView'
import { useToast } from '@/components/Toast'
import { Button, INP, LBL, SEL } from '@/components/manage/DesignSystem'
import { DAYS, DEFAULT_SCHEDULE, EVENING_TITLES, SITE_HOLIDAYS, SITE_MIRROR, type ScheduleDay, type SiteConfig, type SiteHoliday } from '@/lib/site'

const CARD: React.CSSProperties = { borderRadius: 18, padding: 16, border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 12 }
const PLAIN_COLORS = ['#07060E', '#7C4DFF', '#3B5BFF']

function useSiteConfig() {
  return useQuery({ queryKey: ['site-config'], queryFn: () => api.get<SiteConfig>('/system/site-config') })
}

interface HolidayCardProps {
  id: SiteHoliday | null
  label: string
  text: string
  colors: string[]
  active: boolean
  saving: boolean
  onEnable: () => void
}

function HolidayCard({ id, label, text, colors, active, saving, onEnable }: HolidayCardProps) {
  return (
    <div style={{ borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, border: active ? '1.5px solid var(--primary-violet)' : '1px solid rgba(255,255,255,0.1)', background: active ? 'rgba(139,92,246,0.10)' : 'rgba(255,255,255,0.03)' }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {colors.map((c) => <span key={c} style={{ width: 22, height: 22, borderRadius: 6, background: c, border: '1px solid rgba(255,255,255,0.15)' }} />)}
        {active && <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.05em' }}>На сайте</span>}
      </div>
      <div>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>{label}</p>
        <p style={{ margin: '4px 0 0', fontSize: 12.5, lineHeight: 1.45, color: 'var(--on-surface-variant)' }}>{text}</p>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
        <a href={`${SITE_MIRROR}/preview/${id ?? 'none'}`} target="_blank" rel="noopener noreferrer" style={{ flex: 1, textDecoration: 'none' }}>
          <Button size="sm" variant="secondary" fullWidth>Посмотреть</Button>
        </a>
        <div style={{ flex: 1 }}>
          <Button size="sm" fullWidth disabled={active} loading={saving} onClick={onEnable}>{active ? 'Включено' : 'Включить'}</Button>
        </div>
      </div>
    </div>
  )
}

/** Праздник на сайте: снег, сердца, тыквы… поверх обычного вида; «Без праздника» — снять. */
export function SiteHolidays() {
  const qc = useQueryClient()
  const { show } = useToast()
  const { data, isLoading, isError, refetch } = useSiteConfig()

  const saveHoliday = useMutation({
    mutationFn: (holiday: SiteHoliday | null) => api.put('/system/site-config', { holiday }),
    onSuccess: (_r, holiday) => {
      qc.invalidateQueries({ queryKey: ['site-config'] })
      show(holiday ? 'Праздник включён — сайт обновится в течение минуты' : 'Праздник снят — сайт обновится в течение минуты', 'success')
    },
    onError: (e: Error) => show(e.message || 'Не удалось сменить оформление', 'error'),
  })
  if (isLoading) return <StateView state="loading" />
  if (isError || !data) return <StateView state="error" title="Настройки сайта не загрузились" action={{ label: 'Повторить', onClick: () => void refetch() }} />

  const savingId = saveHoliday.isPending ? saveHoliday.variables : undefined
  return (
    <section className="glass-l2" style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="palette" size={18} color="#a78bfa" />
        <p style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>Праздничное оформление</p>
      </div>
      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--on-surface-variant)' }}>
        Каркас и стекло сайта остаются прежними — сверху добавляются частицы, декорации, оттенок и поздравление. «Посмотреть» открывает превью, не меняя сайт.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 10 }}>
        <HolidayCard id={null} label="Без праздника" text="Обычный вид Liquid Glass" colors={PLAIN_COLORS}
          active={data.holiday === null} saving={savingId === null} onEnable={() => saveHoliday.mutate(null)} />
        {SITE_HOLIDAYS.map((h) => (
          <HolidayCard key={h.id} id={h.id} label={h.label} text={h.text} colors={h.colors}
            active={data.holiday === h.id} saving={savingId === h.id} onEnable={() => saveHoliday.mutate(h.id)} />
        ))}
      </div>
    </section>
  )
}

export function SiteSchedule() {
  const qc = useQueryClient()
  const { show } = useToast()
  const { data, isLoading, isError, refetch } = useSiteConfig()
  const [schedule, setSchedule] = useState<ScheduleDay[]>([])
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (data) { setSchedule(data.schedule ?? DEFAULT_SCHEDULE); setDirty(false) }
  }, [data])

  const saveSchedule = useMutation({
    mutationFn: () => api.put('/system/site-config', { schedule }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['site-config'] }); setDirty(false); show('Расписание сохранено', 'success') },
    onError: (e: Error) => show(e.message || 'Не удалось сохранить расписание', 'error'),
  })

  if (isLoading) return <StateView state="loading" />
  if (isError || !data) return <StateView state="error" title="Расписание не загрузилось" action={{ label: 'Повторить', onClick: () => void refetch() }} />

  const edit = (i: number, patch: Partial<ScheduleDay>) => { setSchedule((s) => s.map((d, j) => (j === i ? { ...d, ...patch } : d))); setDirty(true) }
  const remove = (i: number) => { setSchedule((s) => s.filter((_, j) => j !== i)); setDirty(true) }
  const add = () => { setSchedule((s) => [...s, { day: 1, title: 'Городская мафия', time: '19:00' }]); setDirty(true) }

  return (
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
  )
}
