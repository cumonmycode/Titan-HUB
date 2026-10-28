'use client'
/**
 * ТВ в кабинке (Titan TV) в «Экранах»: что на нём сейчас, пульт и реклама.
 *
 * Пульт — команды уходят на ТВ сразу, по открытому потоку: вернуть на главный экран,
 * включить заставку, сбросить после гостей (главный экран, приложения закрыты, обычная
 * громкость), громкость и сообщение гостям поверх фильма. Персонал тоже может.
 * Реклама — блок справа от плиток на главном экране и в углу заставки: та же лента
 * картинок и карточек с QR, что на ТВ с меню, или своя. Правит владелец.
 */
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Icon } from '@/components/Icon'
import { useToast } from '@/components/Toast'
import { Button, Chip, ToggleRow, INP, LBL } from '@/components/manage/DesignSystem'
import { ScreenSlides } from './ScreenSlides'
import {
  HA_STATE, MESSAGE_PRESETS, MESSAGE_SECONDS, SCREENS_KEY, nowOnScreen, screenKey, volumePercent,
  type Screen, type ScreenCommand, type ScreenSlide,
} from '@/lib/screens'

const CARD: React.CSSProperties = { borderRadius: 18, padding: 16, border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 14 }
const SEL: React.CSSProperties = { padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: 'var(--on-surface)', fontSize: 13 }
const NOTE: React.CSSProperties = { fontSize: 12.5, color: 'var(--on-surface-variant)', margin: 0, lineHeight: 1.5 }
/** ТВ присылает новое состояние вскоре после команды; чуть позже перечитываем экран. */
const STATE_AFTER_COMMAND_MS = 3000
const VOLUME_STEP = 5

function Title({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Icon name={icon} size={16} color="#a78bfa" />
      <span style={{ ...LBL, marginBottom: 0, color: '#a78bfa' }}>{children}</span>
    </div>
  )
}

function Fact({ icon, children, color }: { icon: string; children: React.ReactNode; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: color ?? 'var(--on-surface)' }}>
      <Icon name={icon} size={18} color={color ?? 'var(--on-surface-variant)'} />
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
    </div>
  )
}

function useCommand(screen: Screen) {
  const qc = useQueryClient()
  const { show } = useToast()
  return useMutation({
    mutationFn: (command: ScreenCommand) => api.post(`/screens/${screen.id}/command`, command),
    onSuccess: () => {
      setTimeout(() => qc.invalidateQueries({ queryKey: screenKey(screen.id) }), STATE_AFTER_COMMAND_MS)
    },
    onError: (e: Error) => show(e.message || 'Команда не дошла до ТВ', 'error'),
  })
}

/** Что на ТВ сейчас: экран или приложение, музыка по AirPlay, громкость, свет и климат. */
function NowSection({ screen }: { screen: Screen }) {
  const state = screen.deviceState
  const ha = state?.ha ? HA_STATE[state.ha] : null
  return (
    <section className="glass-l2" style={CARD}>
      <Title icon="live_tv">Сейчас на ТВ</Title>
      {!state ? (
        <p style={NOTE}>{screen.online ? 'ТВ на связи, состояние придёт в течение 20 секунд.' : 'ТВ не на связи — состояние появится, когда он вернётся в сеть.'}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Fact icon={state.screen === 'input' ? 'input' : state.screen === 'app' ? 'apps' : 'tv'}>{nowOnScreen(state)}</Fact>
          {state.airplay && (
            <Fact icon={state.airplay.playing ? 'music_note' : 'pause'}>
              {[state.airplay.title || 'Без названия', state.airplay.artist].filter(Boolean).join(' — ')}
              {state.airplay.client ? ` · ${state.airplay.client}` : ''}
            </Fact>
          )}
          {state.volume && (
            <Fact icon={state.volume.muted ? 'volume_off' : 'volume_up'}>
              {state.volume.muted ? 'Звук выключен' : `Громкость ${volumePercent(state.volume)}%`}
            </Fact>
          )}
          {ha && <Fact icon="lightbulb" color={ha.color}>{ha.label}</Fact>}
        </div>
      )}
    </section>
  )
}

function RemoteSection({ screen }: { screen: Screen }) {
  const command = useCommand(screen)
  const { show } = useToast()
  const volume = screen.deviceState?.volume ?? null
  const [percent, setPercent] = useState<number | null>(null)
  // Ползунок держит своё значение, пока его двигают; потом снова показывает то, что прислал ТВ.
  useEffect(() => { setPercent(null) }, [volume?.level, volume?.max])
  const shown = percent ?? (volume ? volumePercent(volume) : 50)
  const send = (cmd: ScreenCommand, done?: string) => command.mutate(cmd, { onSuccess: () => { if (done) show(done, 'success') } })
  const disabled = !screen.online || command.isPending

  return (
    <section className="glass-l2" style={CARD}>
      <Title icon="settings_remote">Пульт</Title>
      {!screen.online && <p style={NOTE}>ТВ не на связи — команды не дойдут.</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Button size="sm" variant="secondary" icon="home" disabled={disabled} onClick={() => send({ action: 'home' }, 'ТВ на главном экране')}>На главный экран</Button>
        <Button size="sm" variant="secondary" icon="wallpaper" disabled={disabled} onClick={() => send({ action: 'screensaver' }, 'Заставка включена')}>Заставка</Button>
        <Button size="sm" variant="secondary" icon="cleaning_services" disabled={disabled} onClick={() => send({ action: 'reset' }, 'ТВ сброшен после гостей')}>Сбросить после гостей</Button>
      </div>
      <p style={NOTE}>«Сбросить после гостей» — главный экран, приложения гостей закрыты, громкость 30%.</p>
      <div>
        <label style={LBL}>Громкость</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            aria-label={volume?.muted ? 'Включить звук' : 'Выключить звук'}
            disabled={disabled}
            onClick={() => send({ action: 'mute', muted: !volume?.muted })}
            style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, border: '1px solid rgba(255,255,255,0.1)', background: volume?.muted ? 'rgba(248,113,113,0.14)' : 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <Icon name={volume?.muted ? 'volume_off' : 'volume_up'} size={20} color={volume?.muted ? '#F87171' : 'var(--on-surface)'} />
          </button>
          <input
            type="range" min={0} max={100} step={VOLUME_STEP} value={shown} disabled={disabled}
            aria-label="Громкость ТВ"
            onChange={(e) => setPercent(Number(e.target.value))}
            onPointerUp={() => percent != null && send({ action: 'volume', percent })}
            onKeyUp={() => percent != null && send({ action: 'volume', percent })}
            style={{ flex: 1, accentColor: '#8B5CF6' }}
          />
          <span style={{ width: 44, textAlign: 'right', fontSize: 13.5, fontVariantNumeric: 'tabular-nums', color: 'var(--on-surface-variant)' }}>{shown}%</span>
        </div>
      </div>
    </section>
  )
}

function MessageSection({ screen }: { screen: Screen }) {
  const command = useCommand(screen)
  const { show } = useToast()
  const [text, setText] = useState('')
  const [seconds, setSeconds] = useState(20)
  const send = () => {
    const message = text.trim()
    if (!message) return
    command.mutate({ action: 'message', text: message, seconds }, {
      onSuccess: () => { setText(''); show('Сообщение на экране ТВ', 'success') },
    })
  }
  return (
    <section className="glass-l2" style={CARD}>
      <Title icon="chat">Сообщение на экран</Title>
      <p style={NOTE}>Появится вверху экрана поверх фильма или игры и исчезнет само. Пульт у гостя продолжит работать.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {MESSAGE_PRESETS.map((preset) => (
          <Chip key={preset.label} active={text === preset.text} onClick={() => setText(preset.text)}>{preset.label}</Chip>
        ))}
      </div>
      <textarea
        style={{ ...INP, minHeight: 72, resize: 'vertical', fontFamily: 'inherit' }}
        value={text} maxLength={200} placeholder="Текст для гостей"
        onChange={(e) => setText(e.target.value)}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <select style={SEL} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} aria-label="Сколько держать на экране">
          {MESSAGE_SECONDS.map((s) => <option key={s} value={s}>{s} с</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <Button icon="send" loading={command.isPending} disabled={!screen.online || !text.trim()} onClick={send}>Показать на ТВ</Button>
      </div>
    </section>
  )
}

/** Реклама кабинки: включена ли и чья лента; своя лента редактируется здесь же. */
function AdsSection({ screen, slides, isOwner }: { screen: Screen; slides: ScreenSlide[]; isOwner: boolean }) {
  const qc = useQueryClient()
  const { show } = useToast()
  const { data } = useQuery({ queryKey: SCREENS_KEY, queryFn: () => api.get<{ screens: Screen[] }>('/screens') })
  const others = (data?.screens ?? []).filter((s) => s.id !== screen.id && s.deviceApp !== 'launcher')
  const own = screen.adsScreenId === screen.id
  const source = screen.adsScreenId && !own ? others.find((s) => s.id === screen.adsScreenId) : null
  // Без выбора — лента первого экрана с меню, как на сервере.
  const fallback = others.find((s) => s.show.menu)
  const editHref = `/manage/screens/${(source ?? fallback)?.id ?? ''}`

  const save = useMutation({
    mutationFn: (patch: Partial<Pick<Screen, 'adsEnabled' | 'adsScreenId'>>) => api.patch(`/screens/${screen.id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: screenKey(screen.id) }),
    onError: (e: Error) => show(e.message || 'Не удалось сохранить', 'error'),
  })

  return (
    <section className="glass-l2" style={CARD}>
      <Title icon="campaign">Реклама</Title>
      <p style={NOTE}>
        Блок справа от плиток на главном экране и в углу заставки: картинки и карточки с QR по очереди. Гость наводит камеру телефона на QR.
      </p>
      <ToggleRow
        label="Показывать рекламу"
        subtitle="На главном экране и заставке"
        value={screen.adsEnabled}
        onChange={(v) => isOwner && save.mutate({ adsEnabled: v })}
      />
      {screen.adsEnabled && (
        <>
          <div>
            <label style={LBL}>Какая реклама</label>
            <select
              style={{ ...SEL, width: '100%' }} disabled={!isOwner}
              value={own ? 'own' : screen.adsScreenId ?? ''}
              onChange={(e) => save.mutate({ adsScreenId: e.target.value === 'own' ? screen.id : e.target.value || null })}
            >
              <option value="">{fallback ? `Как на «${fallback.name}»` : 'Как на ТВ с меню'}</option>
              {others.filter((s) => s.id !== fallback?.id).map((s) => <option key={s.id} value={s.id}>Как на «{s.name}»</option>)}
              <option value="own">Своя для этого ТВ</option>
            </select>
          </div>
          {own ? (
            <ScreenSlides screen={screen} slides={slides} isOwner={isOwner} />
          ) : (
            (source ?? fallback) && (
              <Link href={editHref} style={{ textDecoration: 'none', alignSelf: 'flex-start' }}>
                <Button size="sm" variant="secondary" icon="edit">Изменить рекламу на «{(source ?? fallback)?.name}»</Button>
              </Link>
            )
          )}
        </>
      )}
    </section>
  )
}

export function BoothTvSections({ screen, slides, isOwner }: { screen: Screen; slides: ScreenSlide[]; isOwner: boolean }) {
  return (
    <>
      <NowSection screen={screen} />
      <RemoteSection screen={screen} />
      <MessageSection screen={screen} />
      <AdsSection screen={screen} slides={slides} isOwner={isOwner} />
    </>
  )
}
