'use client'
/**
 * Компьютер с Windows (Titan Screen) в «Экранах».
 *
 * DesktopMonitorSection — на какой монитор компьютера выводить показ. Список мониторов
 * компьютер присылает сам; выбор хранится на сервере (screens.display_id), тот же, что
 * в самом приложении: поменяли здесь — компьютер переносит показ сразу, и наоборот.
 * «Показать номера» — крупные цифры на всех мониторах, чтобы понять, какой из них ТВ.
 *
 * PairPcCode — привязка без телефона: HUB выдаёт код из 8 знаков на 10 минут, его
 * вводят в Titan Screen на компьютере.
 */
import React, { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import { Button, Chip } from '@/components/manage/DesignSystem'
import { SCREENS_KEY, displayLabel, screenKey, type Screen, type ScreenDetail } from '@/lib/screens'

/** Установщик Titan Screen для Windows (scripts/publish-screen-pc.sh). */
const PC_INSTALLER_URL = 'https://titanpos.ru/apps/screen/TitanScreen-Setup.exe'

const NOTE: React.CSSProperties = { fontSize: 12.5, color: 'var(--on-surface-variant)', margin: 0, lineHeight: 1.5 }

export function DesktopMonitorSection({ screen, isOwner }: { screen: Screen; isOwner: boolean }) {
  const qc = useQueryClient()
  const { show } = useToast()
  const key = screenKey(screen.id)
  const displays = screen.deviceState?.displays ?? []
  const output = screen.deviceState?.output ?? null
  const chosen = screen.displayId ?? null

  const save = useMutation({
    mutationFn: (displayId: string | null) => api.patch(`/screens/${screen.id}`, { displayId }),
    onMutate: (displayId) => {
      const prev = qc.getQueryData<ScreenDetail>(key)
      qc.setQueryData<ScreenDetail>(key, (old) => (old ? { ...old, screen: { ...old.screen, displayId } } : old))
      return { prev }
    },
    onError: (e: Error, _v, ctx) => { qc.setQueryData(key, ctx?.prev); show(e.message || 'Не удалось сохранить', 'error') },
    onSettled: () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: SCREENS_KEY, exact: true }) },
  })
  const identify = useMutation({
    mutationFn: () => api.post(`/screens/${screen.id}/command`, { action: 'identify' }),
    onSuccess: () => show('Номера на мониторах — 5 секунд', 'success'),
    onError: (e: Error) => show(e.message || 'Команда не дошла', 'error'),
  })

  const choose = (id: string | null) => { if (isOwner && id !== chosen) save.mutate(id) }
  const outputIndex = displays.findIndex((d) => d.id === output)
  const outputText = !screen.online ? 'Компьютер не в сети — выбор применится, когда он появится'
    : displays.length < 2 ? 'Подключён один монитор — показ ждёт телевизор по HDMI'
    : outputIndex >= 0 ? `Сейчас показ на мониторе ${outputIndex + 1}` : 'Показ сейчас никуда не выводится'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Chip icon="auto_awesome" active={chosen === null} onClick={() => choose(null)}>Сам выберет</Chip>
        {displays.map((d, i) => (
          <Chip key={d.id} icon={d.primary ? 'laptop' : 'tv'} active={chosen === d.id} onClick={() => choose(d.id)}>
            {displayLabel(d, i)}
          </Chip>
        ))}
        {chosen && !displays.some((d) => d.id === chosen) && (
          <Chip icon="tv_off" active onClick={() => choose(null)}>Выбранный монитор отключён</Chip>
        )}
      </div>
      <p style={NOTE}>{outputText}. «Сам выберет» — первый монитор, который не основной. На основном мониторе остаётся окно управления.</p>
      {screen.online && displays.length > 0 && (
        <div>
          <Button size="sm" variant="secondary" icon="pin" loading={identify.isPending} onClick={() => identify.mutate()}>Показать номера на мониторах</Button>
        </div>
      )}
    </div>
  )
}

type Code = { secret: string; host: string; expiresAt: string }

/** «K7QF2M9X» → «K7QF-2M9X». */
const formatCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`

export function PairPcCode({ screen }: { screen: Screen }) {
  const qc = useQueryClient()
  const { show } = useToast()
  const [code, setCode] = useState<Code | null>(null)
  const [left, setLeft] = useState(0)

  const issue = useMutation({
    mutationFn: () => api.post<Code>(`/screens/${screen.id}/pairing?format=code`),
    onSuccess: (data) => setCode(data),
    onError: (e: Error) => show(e.message || 'Код не выдан', 'error'),
  })

  // Обратный отсчёт и проверка: привязался — экран перечитывается и код уходит.
  useEffect(() => {
    if (!code) return
    const tick = () => {
      const sec = Math.max(0, Math.round((new Date(code.expiresAt).getTime() - Date.now()) / 1000))
      setLeft(sec)
      if (sec === 0) setCode(null)
    }
    tick()
    const t = setInterval(tick, 1000)
    const poll = setInterval(() => { void qc.invalidateQueries({ queryKey: screenKey(screen.id) }) }, 4000)
    return () => { clearInterval(t); clearInterval(poll) }
  }, [code, qc, screen.id])

  useEffect(() => { if (screen.paired) setCode(null) }, [screen.paired])

  if (!code) {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Button size="sm" variant="secondary" icon="computer" loading={issue.isPending} onClick={() => issue.mutate()}>Подключить компьютер с Windows</Button>
        <a href={PC_INSTALLER_URL} style={{ textDecoration: 'none' }}>
          <Button size="sm" variant="secondary" icon="download">Скачать Titan Screen</Button>
        </a>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 14, borderRadius: 14, background: 'rgba(139,92,246,0.10)', border: '1px solid rgba(139,92,246,0.3)' }}>
      <span style={{ fontSize: 12.5, color: 'var(--on-surface-variant)' }}>Введите в Titan Screen на компьютере</span>
      <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: 3, fontVariantNumeric: 'tabular-nums' }}>{formatCode(code.secret)}</span>
      <span style={{ fontSize: 12.5, color: 'var(--on-surface-variant)' }}>
        Адрес клуба — {code.host.replace(/^https?:\/\//, '')} · код действует ещё {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
      </span>
    </div>
  )
}
