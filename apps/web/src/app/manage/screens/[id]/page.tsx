'use client'
/**
 * Настройка одного экрана (Управление → Экраны → экран): как висит ТВ, показ (по
 * кругу меню и картинки со своими временем, анимацией и скоростью), а если в показе
 * есть меню — его тема, лента и реклама в ней; привязанная приставка. Всё сохраняется
 * сразу — приставка подхватывает изменения в течение 20 секунд.
 */
import React, { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Icon } from '@/components/Icon'
import { StateView } from '@/components/StateView'
import { useToast } from '@/components/Toast'
import { useAuthStore } from '@/store/auth.store'
import { PageHeader, Button, ConfirmDialog, Chip, INP, LBL } from '@/components/manage/DesignSystem'
import { ScreenThemePicker } from '@/components/manage/screens/ScreenThemePicker'
import { ScreenSlides } from '@/components/manage/screens/ScreenSlides'
import { ScreenShow } from '@/components/manage/screens/ScreenShow'
import {
  BAND_DURATIONS, ROTATIONS, SCREENS_KEY, deviceStatus, screenKey, showLabel, withCurrent,
  type Screen, type ScreenDetail,
} from '@/lib/screens'

type Detail = ScreenDetail
type ScreenPatch = Partial<Pick<Screen, 'name' | 'rotation' | 'bandSec'>>

const CARD: React.CSSProperties = { borderRadius: 18, padding: 16, border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 14 }
const SEL: React.CSSProperties = { padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: 'var(--on-surface)', fontSize: 13 }

function Title({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Icon name={icon} size={16} color="#a78bfa" />
      <span style={{ ...LBL, marginBottom: 0, color: '#a78bfa' }}>{children}</span>
    </div>
  )
}

export default function ScreenEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const qc = useQueryClient()
  const { show } = useToast()
  const isOwner = (useAuthStore((s) => s.user)?.role ?? 'staff') === 'owner'
  const key = screenKey(id)
  const [name, setName] = useState('')
  const [confirm, setConfirm] = useState<'unpair' | 'delete' | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: key,
    queryFn: () => api.get<Detail>(`/screens/${id}`),
    refetchInterval: 20_000, // статус приставки
  })
  const screen = data?.screen
  useEffect(() => { if (screen) setName(screen.name) }, [screen?.name]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (patch: ScreenPatch) => api.patch(`/screens/${id}`, patch),
    onMutate: (patch) => {
      const prev = qc.getQueryData<Detail>(key)
      qc.setQueryData<Detail>(key, (old) => (old ? { ...old, screen: { ...old.screen, ...patch } } : old))
      return { prev }
    },
    onError: (e: Error, _p, ctx) => { qc.setQueryData(key, ctx?.prev); show(e.message || 'Не удалось сохранить', 'error') },
    onSettled: () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: SCREENS_KEY, exact: true }) },
  })
  const unpair = useMutation({
    mutationFn: () => api.post(`/screens/${id}/unpair`),
    onSuccess: () => { setConfirm(null); show('ТВ отвязан — на нём снова появится код для подключения', 'success') },
    onError: (e: Error) => show(e.message || 'Не удалось отвязать', 'error'),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`/screens/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SCREENS_KEY, exact: true })
      router.push('/manage/screens')
    },
    onError: (e: Error) => show(e.message || 'Экран не удалён', 'error'),
  })

  const saveName = () => {
    const next = name.trim()
    if (!screen || !next || next === screen.name) { if (screen) setName(screen.name); return }
    save.mutate({ name: next })
  }

  const back = () => router.push('/manage/screens')

  if (isLoading) return <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}><PageHeader title="Экран" onBack={back} /><StateView state="loading" /></div>
  if (isError || !screen || !data) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
        <PageHeader title="Экран" onBack={back} />
        <StateView state="error" title="Экран не найден" action={{ label: 'Повторить', onClick: () => void refetch() }} />
      </div>
    )
  }

  const status = deviceStatus(screen)
  // Оформление и лента нужны, только если меню есть в показе (пустой показ — тоже меню).
  const active = data.show.filter((x) => x.isActive)
  const hasMenu = active.length === 0 || active.some((x) => x.kind === 'menu')

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <PageHeader title={screen.name} subtitle={showLabel(screen.show)} onBack={back} />
      <div style={{ padding: '16px 16px var(--bottom-nav-clear, 24px)', maxWidth: 'var(--content-narrow)', margin: '0 auto', width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Приставка */}
        <section className="glass-l2" style={CARD}>
          <Title icon="tv">Телевизор</Title>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 9, height: 9, borderRadius: 5, background: status.color, flexShrink: 0 }} />
            <span style={{ fontSize: 14.5, fontWeight: 600, color: status.color }}>{status.label}</span>
          </div>
          {screen.paired ? (
            <p style={{ fontSize: 12.5, color: 'var(--on-surface-variant)', margin: 0, lineHeight: 1.5 }}>
              {[screen.deviceModel, screen.appVersion && `Titan Menu ${screen.appVersion}`, screen.deviceIp].filter(Boolean).join(' · ') || 'Приставка подключена'}
            </p>
          ) : (
            <p style={{ fontSize: 12.5, color: 'var(--on-surface-variant)', margin: 0, lineHeight: 1.5 }}>
              Подключите ТВ с телефона: Titan HUB → Управление → Экраны → «Подключить ТВ». Телефон найдёт приставку в той же Wi-Fi сети.
            </p>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <a href={`/screen/${screen.id}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
              <Button size="sm" variant="secondary" icon="open_in_new">Открыть экран</Button>
            </a>
            {isOwner && screen.paired && (
              <Button size="sm" variant="secondary" icon="link_off" onClick={() => setConfirm('unpair')}>Отвязать ТВ</Button>
            )}
          </div>
        </section>

        {/* Экран */}
        <section className="glass-l2" style={CARD}>
          <Title icon="tv">Экран</Title>
          <div>
            <label style={LBL}>Название</label>
            <input
              style={INP} value={name} maxLength={60} disabled={!isOwner}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            />
          </div>
          <div>
            <label style={LBL}>Как висит телевизор</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {ROTATIONS.map((r) => (
                <Chip key={r.key} icon={r.key === 0 ? 'tv' : 'rotate_right'} active={screen.rotation === r.key} onClick={() => isOwner && screen.rotation !== r.key && save.mutate({ rotation: r.key })}>{r.short}</Chip>
              ))}
            </div>
            <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: '8px 2px 0' }}>
              Поворачивает картинку на приставке. Меню на боку или вверх ногами — выберите другой вариант.
            </p>
          </div>
        </section>

        <section className="glass-l2" style={CARD}>
          <Title icon="slideshow">Показ</Title>
          <p style={{ fontSize: 12.5, color: 'var(--on-surface-variant)', margin: 0, lineHeight: 1.5 }}>
            Экран показывает элементы по кругу, сверху вниз. Картинка появляется поверх меню на весь экран, меню — из-под уходящей картинки. Нажмите на элемент, чтобы задать время, анимацию и её скорость.
          </p>
          <ScreenShow screen={screen} items={data.show} isOwner={isOwner} />
        </section>

        {hasMenu && (
          <>
            <section className="glass-l2" style={CARD}>
              <Title icon="restaurant_menu">Оформление</Title>
              <ScreenThemePicker screen={screen} isOwner={isOwner} />
              <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: 0 }}>
                Состав меню — кнопкой-телевизором на позициях в «Меню» и «Тарифах и аренде».
              </p>
            </section>
            <section className="glass-l2" style={CARD}>
              <Title icon="campaign">Реклама в ленте</Title>
              <p style={{ fontSize: 12.5, color: 'var(--on-surface-variant)', margin: 0, lineHeight: 1.5 }}>
                Слайды по очереди сменяют ленту «Игровой вечер / Кабинки» внизу экрана: панель переворачивается, меню остаётся на месте. Картинка лучше широкая, примерно 3:1.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 13.5 }}>Лента тарифов и кабинок на экране</span>
                <select style={SEL} value={screen.bandSec} disabled={!isOwner} onChange={(e) => save.mutate({ bandSec: Number(e.target.value) })} aria-label="Время ленты">
                  {withCurrent(BAND_DURATIONS, screen.bandSec).map((s) => <option key={s} value={s}>{s} с</option>)}
                </select>
              </div>
              <ScreenSlides screen={screen} slides={data.slides} isOwner={isOwner} />
            </section>
          </>
        )}

        {isOwner && (
          <Button variant="danger" icon="delete" onClick={() => setConfirm('delete')}>Удалить экран</Button>
        )}
      </div>

      <ConfirmDialog
        open={confirm === 'unpair'}
        onClose={() => setConfirm(null)}
        onConfirm={() => unpair.mutate()}
        title="Отвязать телевизор?"
        message="Приставка перестанет показывать этот экран и снова покажет код для подключения."
        confirmLabel="Отвязать"
        danger
        loading={unpair.isPending}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        onConfirm={() => remove.mutate()}
        title={`Удалить «${screen.name}»?`}
        message="Настройки, показ и реклама экрана удалятся, привязанная приставка вернётся к экрану подключения."
        confirmLabel="Удалить"
        danger
        loading={remove.isPending}
      />
    </div>
  )
}
